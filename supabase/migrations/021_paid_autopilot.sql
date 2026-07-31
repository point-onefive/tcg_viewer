-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 020_paid_tournaments.sql). MUST run on the SAME project as the tournament
-- tables.
--
-- Phase P1 of the paid-tournament build (see docs/future-build.md, section
-- "Paid-tournament autopilot: no-show handling, reliability score, region
-- lobbies"). This is the fairness layer that lets a paid tournament run itself:
--   1. optional per-lobby region lock (tournaments.lobby_region),
--   2. no-show auto-drop marker (players.no_show) distinct from a clean drop,
--   3. a cross-tournament, wallet-keyed reliability score (wallet_reliability).
--
-- Everything here is additive, idempotent ("if not exists"), and
-- nullable / defaulted so the app runs unchanged BEFORE this migration is
-- applied and every EXISTING (free) tournament is untouched. Paid behavior is
-- gated in code to escrow-linked tournaments only; these columns are a no-op
-- for free events (lobby_region NULL = open lobby, no_show defaults false).
--
-- Reliability lives in a DEDICATED wallet-keyed table on purpose. We do NOT
-- touch wallet_profiles (migration 004) or the wallet_standings view: attendance
-- reputation is a separate concern from identity and competitive standings.

-- ── tournaments: optional per-lobby region lock ────────────────────────────
-- NULL = open lobby (admits everyone). A value ('amer' | 'emea' | 'apac')
-- restricts paid enrollment to that region only. Region is an eligibility input
-- only, never a win-determinant.
alter table tournaments
  add column if not exists lobby_region text; -- null | 'amer' | 'emea' | 'apac'

-- ── players: mark a no-show auto-drop, distinct from a clean/voluntary drop ──
-- `dropped` (migration-era column) means "out of the bracket" for any reason.
-- `no_show` narrows that to "auto-dropped because they ghosted a round at the
-- hard deadline", so a clean self-drop or an admin drop (no_show = false) is
-- never counted against the player's reliability.
alter table players
  add column if not exists no_show boolean not null default false;

-- ── wallet_reliability: cross-tournament attendance reputation, per wallet ──
-- One row per wallet, accumulated across every paid event the wallet played.
-- Counters only ever increment on the actual unresolved -> resolved match
-- transition (guarded in code), so cron + lazy-on-read enforcement can never
-- double-count. `score` is a derived 0..100 value (see computeReliabilityScore
-- in src/lib/tournament/paid.ts); NULL score = a fresh wallet with 0 matches
-- played, treated as neutral (never penalized, never gated).
create table if not exists wallet_reliability (
  wallet_address   text primary key,
  matches_played   int not null default 0,
  matches_on_time  int not null default 0,
  no_shows         int not null default 0,
  double_forfeits  int not null default 0,
  clean_drops      int not null default 0,
  disputes_lost    int not null default 0,
  score            int,                       -- 0..100, or null = neutral (0 played)
  updated_at       timestamptz default now()
);

-- Cheap lookups for the admin approval queue / gate (worst offenders first).
create index if not exists wallet_reliability_score_idx
  on wallet_reliability (score);
create index if not exists wallet_reliability_no_shows_idx
  on wallet_reliability (no_shows);
