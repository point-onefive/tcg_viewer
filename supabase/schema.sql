-- ===========================================================================
-- The Card Wall — Tournament feature schema
--
-- Run this once in the Supabase SQL editor (or `supabase db push`) after
-- creating your project. It is idempotent-ish: it uses IF NOT EXISTS where
-- possible so re-running is safe.
--
-- Security model: every read/write goes through Next.js route handlers using
-- the SERVICE ROLE key, which bypasses RLS. We still ENABLE RLS on every table
-- and add NO permissive policies, so the public anon key (and any future
-- client-side access) is denied by default. Authorization is enforced in the
-- app layer by comparing sha256(token) to the stored hash columns.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ── tournaments ────────────────────────────────────────────────────────────
create table if not exists tournaments (
  id              uuid primary key default gen_random_uuid(),
  code            text unique not null,
  name            text not null,
  game            text not null default 'other',
  format          text not null default 'swiss',         -- 'swiss' | 'single-elim'
  status          text not null default 'enrolling',     -- enrolling|running|complete|cancelled
  swiss_rounds    int,                                    -- null for single-elim
  round_minutes   int not null default 1440,             -- default 24h
  enroll_closes_at timestamptz,
  rules           text,
  contact_url     text,
  prizes          jsonb not null default '[]'::jsonb,    -- [{title,description,image}]
  host_token_hash text not null,
  created_at      timestamptz not null default now()
);

-- ── players ──────────────────────────────────────────────────────────────--
create table if not exists players (
  id                uuid primary key default gen_random_uuid(),
  tournament_id     uuid not null references tournaments(id) on delete cascade,
  display_name      text not null,
  discord_handle    text,
  seed              int,
  dropped           boolean not null default false,
  player_token_hash text not null,
  created_at        timestamptz not null default now()
);
create index if not exists players_tournament_idx on players(tournament_id);

-- ── rounds ─────────────────────────────────────────────────────────────────
create table if not exists rounds (
  id            uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references tournaments(id) on delete cascade,
  number        int not null,
  status        text not null default 'active',          -- active | complete
  starts_at     timestamptz not null default now(),
  ends_at       timestamptz,
  unique (tournament_id, number)
);
create index if not exists rounds_tournament_idx on rounds(tournament_id);

-- ── matches ──────────────────────────────────────────────────────────────--
create table if not exists matches (
  id            uuid primary key default gen_random_uuid(),
  round_id      uuid not null references rounds(id) on delete cascade,
  tournament_id uuid not null references tournaments(id) on delete cascade,
  number        int not null,
  player1_id    uuid not null references players(id) on delete cascade,
  player2_id    uuid references players(id) on delete cascade,  -- null = bye
  status        text not null default 'pending',          -- pending|reported|confirmed|disputed|bye
  player1_report text,                                     -- win|loss|draw|null
  player2_report text,
  winner_id     uuid references players(id) on delete set null,
  scheduled_at  timestamptz,
  reported_at   timestamptz,
  resolved_at   timestamptz
);
create index if not exists matches_round_idx on matches(round_id);
create index if not exists matches_tournament_idx on matches(tournament_id);

-- ── schedule_proposals ─────────────────────────────────────────────────────
create table if not exists schedule_proposals (
  id                    uuid primary key default gen_random_uuid(),
  match_id              uuid not null references matches(id) on delete cascade,
  proposed_by_player_id uuid not null references players(id) on delete cascade,
  slots                 jsonb not null default '[]'::jsonb,  -- array of ISO UTC strings
  status                text not null default 'open',        -- open|accepted|superseded
  accepted_slot         timestamptz,
  created_at            timestamptz not null default now()
);
create index if not exists proposals_match_idx on schedule_proposals(match_id);

-- ── Lock everything down to the app layer ───────────────────────────────────
alter table tournaments        enable row level security;
alter table players            enable row level security;
alter table rounds             enable row level security;
alter table matches            enable row level security;
alter table schedule_proposals enable row level security;
-- No policies on purpose: anon/auth roles get nothing; service role bypasses
-- RLS and is the only path in, via our Next.js route handlers.
