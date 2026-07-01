-- 015_tournament_badges.sql
--
-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 014_profile_badges.sql). MUST run on the SAME project as the tournament
-- tables. Safe to run on prod AND the preview project.
--
-- Adds a per-tournament BADGE pool, structurally identical to the prize pool but
-- awarded strictly by placement: N badge slots => the top N finishers each get
-- the badge for their rank (slot 0 -> 1st, slot 1 -> 2nd, ...). Mirrors the
-- prize snapshot design (007): the live pool lives on `tournaments.badges`, and
-- at completion each awarded badge is COPIED (title/description/image) onto its
-- winner in `tournament_awarded_badges` so later edits to the live pool never
-- rewrite history. Badge art is a normalized (trimmed, 1:1, 512px) WebP data URL
-- produced client-side on upload.
--
-- Security model: same as the rest of the schema. Written by the service-role
-- key in route handlers; reads for profiles also go through route handlers. RLS
-- on with no permissive policies => anon key gets nothing.

-- ── tournaments.badges + badges_awarded_at ─────────────────────────────────
alter table tournaments
  add column if not exists badges jsonb not null default '[]'::jsonb;

alter table tournaments
  add column if not exists badges_awarded_at timestamptz;

-- ── tournament_awarded_badges ──────────────────────────────────────────────
-- One row per (badge slot x winner). wallet_address / x_handle / display_name
-- are denormalized snapshots so a profile lookup is a single indexed read and
-- the badge still shows even if the player later changes their profile.
create table if not exists tournament_awarded_badges (
  id              uuid primary key default gen_random_uuid(),
  tournament_id   uuid not null references tournaments(id) on delete cascade,
  player_id       uuid references players(id) on delete set null,
  wallet_address  text,                          -- lowercase 0x-prefixed, null if winner had no wallet
  x_handle        text,                          -- lowercase, no @, snapshot for display
  display_name    text,                          -- winner name snapshot
  rank            integer,                        -- the winner's final placement (1 = champion)
  slot_index      integer not null,              -- which badge slot (0-based) in the live pool
  title           text not null,                 -- badge header snapshot at award time
  description     text not null default '',      -- badge sub-header snapshot
  image           text,                          -- normalized badge image snapshot (data URL)
  awarded_at      timestamptz not null default now()
);

-- Fast profile lookup: every badge a wallet has won.
create index if not exists awarded_badges_wallet_idx
  on tournament_awarded_badges (wallet_address)
  where wallet_address is not null;

-- Fast per-event lookup.
create index if not exists awarded_badges_tournament_idx
  on tournament_awarded_badges (tournament_id);

alter table tournament_awarded_badges enable row level security;
-- No permissive policies: all access via service role key in route handlers.
