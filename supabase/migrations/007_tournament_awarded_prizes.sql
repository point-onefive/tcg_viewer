-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 006_tournament_placements.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Adds an immutable record of the prizes actually handed out when a tournament
-- finishes, so profiles can show a "prizes won" trophy shelf and the tournament
-- page can show a historical "prizes awarded" section.
--
-- Why a snapshot table (instead of reading tournaments.prizes): the live prize
-- pool keeps changing right up to the end of an event - the operator might swap
-- the image, grow the pool, or split one prize across five winners. We must not
-- treat the live pool as history. So at completion we COPY each awarded prize
-- (title + description + image) onto its winner here. Later edits to the live
-- pool can never rewrite what someone already won.
--
-- Security model: same as the rest of the schema. Rows are written by the
-- service-role key when a tournament completes (or when the admin re-awards);
-- reads are public (winners are not secret) but still go through Next.js route
-- handlers. RLS on with no permissive policies => anon key gets nothing.

-- ── tournament_awarded_prizes ──────────────────────────────────────────────
-- One row per (prize slot x winner). A single prize awarded to five people is
-- five rows sharing the same slot_index/title/image. wallet_address + x_handle
-- are denormalized snapshots so a profile lookup is a single indexed read and
-- so the winner still shows even if they later change their profile.
create table if not exists tournament_awarded_prizes (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  player_id       uuid references players(id) on delete set null,
  wallet_address  text,                          -- lowercase 0x-prefixed, null if winner had no wallet
  x_handle        text,                          -- lowercase, no @, snapshot for display
  display_name    text,                          -- winner name snapshot
  rank            integer,                        -- the winner's final placement (1 = champion)
  slot_index      integer not null,              -- which prize slot (0-based) in the live pool
  title           text not null,                 -- prize title snapshot at award time
  description     text not null default '',      -- prize description snapshot
  image           text,                          -- prize image snapshot (data URL or external URL)
  awarded_at      timestamptz not null default now()
);

-- Fast profile lookup: every prize a wallet has won.
create index if not exists awarded_prizes_wallet_idx
  on tournament_awarded_prizes (wallet_address)
  where wallet_address is not null;

-- Fast per-event lookup for the tournament page history section.
create index if not exists awarded_prizes_tournament_idx
  on tournament_awarded_prizes (tournament_id);

alter table tournament_awarded_prizes enable row level security;
-- No permissive policies: all access via service role key in route handlers.

-- ── tournaments.prizes_awarded_at ──────────────────────────────────────────
-- Stamped when prizes are first resolved (at completion) or re-awarded by the
-- admin. NULL = prizes have not been handed out yet, so the public history
-- section stays hidden until the event is truly done.
alter table tournaments
  add column if not exists prizes_awarded_at timestamptz;
