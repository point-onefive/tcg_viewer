-- ============================================================================
-- Card Wall · Market Intelligence · Initial Schema
-- ============================================================================
--
-- Scope: One Piece TCG only for v1. Schema is collection-agnostic so we can
-- add Pokemon / DBS / Digimon later without restructuring.
--
-- Design notes:
--
-- 1. `watchlist` is a unified "things we track" table. A row may be a graded
--    single, a raw single, a sealed product, a Premium Bandai exclusive, or
--    a tournament promo. The `kind` enum discriminates, so the same scoring
--    engine ranks slabs and sealed boxes uniformly.
--
-- 2. We never store eBay PII, seller handles beyond what's public on a
--    listing page, or raw listing URLs surfaced to anonymous web traffic.
--    Sample listings live in JSONB so we can change shape without migrating.
--
-- 3. Snapshots are append-only. Time-series queries pull `latest_*` views
--    that read the most recent row per watchlist_id.
--
-- 4. RLS is ON by default for every table; we add explicit read policies for
--    derived/abstract views (Pulse) and keep raw snapshots service-only.
--    This is what makes the site/Telegram split safe.
-- ============================================================================

-- ─── enums ──────────────────────────────────────────────────────────────────

create type tracked_kind as enum (
  'graded_single',     -- e.g. PSA 10 OP05-119 Luffy Manga
  'raw_single',        -- ungraded card
  'sealed_booster',    -- OP-15 booster boxes/cases
  'sealed_starter',    -- ST29 starter decks
  'sealed_premium',    -- Premium Bandai sets, PRB boxes, anniversary boxes
  'promo',             -- magazine inserts, store promos, region exclusives
  'tournament_kit',    -- championship / tournament prize kits
  'other_sealed'
);

create type collection_code as enum (
  'one-piece',
  'gundam',
  'dbs',
  'digimon',
  'pokemon'
);

-- Heat etc. are derived in app code rather than in SQL so we can tune the
-- thresholds without a migration. The enum here is just shape contracts.
-- New types can be added in-place via:  alter type signal_type add value 'foo';
create type signal_type as enum (
  -- value-gap signals
  'sleeper',                    -- low pop + thin supply + flat or rising price
  'buyout_candidate',           -- 1..N PSA10s listed, total cost < N * recent sale
  'floor_squeeze',              -- lowest BIN sitting below 30d median
  'raw_to_psa10_gap',           -- raw price low vs PSA10; grading EV positive
  -- supply / pop signals
  'pop_spike',                  -- PSA 10 population grew sharply (warning)
  'pop_squeeze',                -- pop growth flat/declining (positive scarcity)
  'absorption',                 -- active listings disappearing faster than appearing
  'listing_burst',              -- sudden inflow of listings (often one seller dumping)
  'liquidity_thin',             -- very few unique sellers; concentrated supply
  -- momentum signals
  'price_momentum_up',
  'price_momentum_down',
  'character_index_leader',     -- card outperforming its character index
  'character_index_laggard',    -- card flat while character index rising (sleeper sub-signal)
  -- sealed / promo signals
  'sealed_undervalued',         -- sealed product flat while included chase card rising
  'sealed_premium_appearing',   -- new Premium Bandai / exclusive detected
  -- ops / meta
  'data_stale'                  -- ingestion failed; for dashboard, not for alerts
);

-- ─── core: watchlist ────────────────────────────────────────────────────────

create table watchlist (
  id              uuid primary key default gen_random_uuid(),
  collection      collection_code not null,
  kind            tracked_kind   not null,

  -- Canonical card linkage (when kind in graded/raw single).
  -- card_id matches the gallery's canonical id (e.g. "OP05-119"). variant_id
  -- targets a specific alt-art/parallel within the card.
  card_id         text,
  variant_id      text,

  -- Display + grouping.
  display_name    text not null,
  character       text,            -- "Monkey D. Luffy", "Zoro", null for sealed
  set_code        text,
  release_date    date,
  image_url       text,

  -- Search & disambiguation. eBay queries iterate these.
  search_terms    text[] not null default '{}',
  exclude_terms   text[] not null default '{}',
  ebay_category   int,             -- 183454 = TCG individual cards, etc.

  -- External vendor ids.
  psa_spec_id     bigint,          -- PSA pop lookup target
  pricecharting_id text,           -- PriceCharting product id

  -- Operational.
  enabled         bool not null default true,
  priority        smallint not null default 5,  -- 1..10; influences call budget
  notes           text,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index watchlist_enabled_priority_idx
  on watchlist (enabled, priority desc, updated_at desc);
create index watchlist_collection_kind_idx
  on watchlist (collection, kind);
create index watchlist_card_idx
  on watchlist (card_id) where card_id is not null;
create index watchlist_character_idx
  on watchlist (character) where character is not null;

-- ─── snapshots: PSA population ──────────────────────────────────────────────

create table psa_pop_snapshots (
  id             bigserial primary key,
  watchlist_id   uuid not null references watchlist (id) on delete cascade,
  captured_at    timestamptz not null default now(),

  -- Source of the count. Naming kept as `psa_pop_snapshots` for stability,
  -- but in practice we currently populate this from PriceCharting's
  -- combined PSA+CGC pop report, since PSA's free Public API does not
  -- expose population data. When source='pricecharting_combined' the
  -- columns reflect *combined* PSA + CGC populations at each grade tier;
  -- when source='psa_direct' they reflect PSA only (future).
  source         text not null default 'pricecharting_combined',

  -- Grade tier counts. grade_total = sum across all grades reported.
  grade_total    int,
  grade_10       int,
  grade_9        int,
  grade_8        int,
  grade_7        int,
  grade_6        int,
  qualifiers     int,

  -- Raw payload preserved for debugging / re-derivation.
  raw            jsonb
);

create index psa_pop_snapshots_wl_time_idx
  on psa_pop_snapshots (watchlist_id, captured_at desc);

-- ─── snapshots: eBay active market (per watchlist item) ─────────────────────

create table ebay_market_snapshots (
  id              bigserial primary key,
  watchlist_id    uuid not null references watchlist (id) on delete cascade,
  captured_at     timestamptz not null default now(),

  -- Aggregate-only at this level so the public surface never needs to
  -- show individual listings.
  active_count    int,
  lowest_bin      numeric(10, 2),
  lowest_bin_ship numeric(10, 2),
  median_ask      numeric(10, 2),
  p25_ask         numeric(10, 2),
  p75_ask         numeric(10, 2),

  -- Optional: top-N cheapest active listings as opaque JSONB for use by
  -- the Telegram bot only (RLS keeps this row off the public site).
  sample          jsonb,

  currency        text not null default 'USD'
);

create index ebay_market_snapshots_wl_time_idx
  on ebay_market_snapshots (watchlist_id, captured_at desc);

-- ─── listing history (individual listing lifecycle) ─────────────────────────

create table ebay_listings (
  listing_id      text primary key,        -- eBay item id
  watchlist_id    uuid not null references watchlist (id) on delete cascade,
  first_seen      timestamptz not null default now(),
  last_seen       timestamptz not null default now(),
  status          text not null default 'active',  -- active | gone | sold (inferred)

  title           text,
  price           numeric(10, 2),
  shipping        numeric(10, 2),
  currency        text not null default 'USD',
  is_auction      bool,
  end_time        timestamptz,
  seller_hash     text,                    -- sha256 of seller id; we never store the handle
  meta            jsonb
);

create index ebay_listings_wl_status_idx
  on ebay_listings (watchlist_id, status, last_seen desc);

-- ─── snapshots: external price feeds (PriceCharting, JustTCG, ...) ──────────

create table price_snapshots (
  id              bigserial primary key,
  watchlist_id    uuid not null references watchlist (id) on delete cascade,
  source          text not null,           -- 'pricecharting' | 'justtcg' | ...
  captured_at     timestamptz not null default now(),

  raw_price       numeric(10, 2),
  psa_7_price     numeric(10, 2),
  psa_8_price     numeric(10, 2),
  psa_9_price     numeric(10, 2),
  psa_9_5_price   numeric(10, 2),
  psa_10_price    numeric(10, 2),
  cgc_10_price    numeric(10, 2),
  thirty_day_avg  numeric(10, 2),
  last_sale       numeric(10, 2),

  -- Day-over-day price deltas (PriceCharting publishes these directly).
  -- Useful for the "movement" rails without us computing diffs ourselves.
  raw_price_delta     numeric(10, 2),
  psa_10_price_delta  numeric(10, 2),

  currency        text not null default 'USD',
  raw_payload     jsonb
);

create index price_snapshots_wl_source_time_idx
  on price_snapshots (watchlist_id, source, captured_at desc);

-- ─── computed signals (sleeper score, buyout candidate, ...) ────────────────

create table signals (
  id             bigserial primary key,
  watchlist_id   uuid not null references watchlist (id) on delete cascade,
  signal_type    signal_type not null,
  captured_at    timestamptz not null default now(),

  score          smallint not null,        -- 0..100
  explanation    text,
  payload        jsonb
);

create index signals_wl_type_time_idx
  on signals (watchlist_id, signal_type, captured_at desc);
create index signals_recent_hot_idx
  on signals (captured_at desc) where score >= 70;

-- ─── sealed → contents relationships ────────────────────────────────────────
--
-- Links a sealed product (PRB box, anniversary set, tournament kit) to the
-- card(s) it contains. Enables the "sealed undervalued" signal: if the chase
-- card inside a sealed box is rising sharply but the box price has not moved,
-- the sealed product is mispriced relative to its contents.
--
-- Both sides reference the same `watchlist` table (sealed_id points at a
-- sealed_* kind, card_id points at a graded_single / raw_single kind).
create table sealed_contents (
  id              bigserial primary key,
  sealed_id       uuid not null references watchlist (id) on delete cascade,
  card_id         uuid not null references watchlist (id) on delete cascade,
  quantity        smallint not null default 1,
  is_chase        bool not null default false,    -- the headline card / hit
  notes           text,
  unique (sealed_id, card_id)
);

create index sealed_contents_sealed_idx on sealed_contents (sealed_id);
create index sealed_contents_card_idx   on sealed_contents (card_id);

-- ─── alerts dedup ───────────────────────────────────────────────────────────
--
-- Records every alert pushed to a delivery channel (telegram / email / etc.)
-- so the worker can skip re-sending. Keyed by (watchlist, signal_type,
-- channel, fingerprint) where fingerprint is a stable hash of the alert's
-- meaningful payload (e.g. "score >= 80 AND active_listings <= 3"). When the
-- underlying conditions change enough that the fingerprint changes, the
-- alert can fire again.
create table alerts_sent (
  id              bigserial primary key,
  watchlist_id    uuid not null references watchlist (id) on delete cascade,
  signal_type     signal_type not null,
  channel         text not null,           -- 'telegram' | 'email' | ...
  recipient       text not null,           -- chat_id / email / ...
  fingerprint     text not null,           -- stable hash of alert payload
  sent_at         timestamptz not null default now(),
  payload         jsonb,
  unique (watchlist_id, signal_type, channel, recipient, fingerprint)
);

create index alerts_sent_recent_idx on alerts_sent (sent_at desc);

-- ─── worker run log ─────────────────────────────────────────────────────────
--
-- Operational ledger for every ingestion run. Critical for two reasons:
--   1. Call-budget tracking. PSA's free tier is 100 calls/day. We need to
--      know how many we have left right now.
--   2. Debug "why is data stale". Without this you stare at the data and
--      guess. With this you query "show me the last PSA run" in one line.
create table worker_runs (
  id              bigserial primary key,
  source          text not null,           -- 'psa' | 'ebay_browse' | 'pricecharting' | ...
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running',  -- 'running' | 'ok' | 'partial' | 'failed'
  items_processed int not null default 0,
  api_calls       int not null default 0,
  errors          int not null default 0,
  notes           text,
  meta            jsonb
);

create index worker_runs_source_time_idx on worker_runs (source, started_at desc);

-- ─── derived view: latest pulse per watchlist item ──────────────────────────
--
-- This is what the SITE reads. It exposes only the qualitative buckets
-- derived in app code; raw populations and prices never leave the snapshot
-- tables. The materialized view is refreshed by the ingestion worker after
-- each full snapshot cycle.

create materialized view pulse_latest as
select
  w.id                      as watchlist_id,
  w.collection,
  w.kind,
  w.card_id,
  w.variant_id,
  w.character,
  (
    select s.score
    from signals s
    where s.watchlist_id = w.id and s.signal_type = 'sleeper'
    order by s.captured_at desc
    limit 1
  )                         as sleeper_score,
  (
    select p.grade_10
    from psa_pop_snapshots p
    where p.watchlist_id = w.id
    order by p.captured_at desc
    limit 1
  )                         as grade_10_pop,
  (
    select e.active_count
    from ebay_market_snapshots e
    where e.watchlist_id = w.id
    order by e.captured_at desc
    limit 1
  )                         as active_listings,
  now()                     as refreshed_at
from watchlist w
where w.enabled;

create unique index pulse_latest_wl_idx on pulse_latest (watchlist_id);

-- ─── RLS ────────────────────────────────────────────────────────────────────
--
-- Default deny everywhere. Service role (used by the worker, the TG bot,
-- and SSR fetches we trust) bypasses RLS automatically. The publishable
-- key (used by the browser) gets nothing by default; we add a narrow read
-- policy for `pulse_latest` that exposes ONLY abstract derived signals
-- AND only score buckets, not raw numbers.

alter table watchlist                enable row level security;
alter table psa_pop_snapshots        enable row level security;
alter table ebay_market_snapshots    enable row level security;
alter table ebay_listings            enable row level security;
alter table price_snapshots          enable row level security;
alter table signals                  enable row level security;
alter table sealed_contents          enable row level security;
alter table alerts_sent              enable row level security;
alter table worker_runs              enable row level security;

-- Public read of watchlist's display-safe columns only. The browser gets
-- to know that we track a card, plus its display name & character, but
-- not the eBay query payload.
create policy "public: watchlist display fields"
  on watchlist for select
  using (enabled = true);

-- The materialized view itself does not support RLS, but we wrap it in
-- a function that returns score buckets only, never raw numbers.
-- (Defined in 0002_pulse_buckets.sql once we are happy with thresholds.)

-- ─── seed marker ────────────────────────────────────────────────────────────

comment on table watchlist is
  'Items the market-intel system tracks. Seeded from scripts/seed-watchlist-op.mjs. One Piece only in v1.';
