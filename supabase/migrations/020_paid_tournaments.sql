-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 019_manual_badges.sql). MUST run on the SAME project as the tournament
-- tables.
--
-- Phase 2 of the paid-tournament build (see docs/paid-tournaments-escrow.md).
-- Adds the columns that mirror on-chain escrow state onto the existing free
-- tournament tables. The chain is the source of truth for money; these columns
-- are a cache the app reconciles against the contract (chain wins on any
-- disagreement).
--
-- All columns are nullable / defaulted so every EXISTING (free) tournament is
-- untouched: a free event has escrow_id = NULL and behaves exactly as before.
-- A tournament is "paid" iff escrow_id IS NOT NULL.

-- ── tournaments: link a game to its on-chain escrow ─────────────────────────
alter table tournaments
  add column if not exists escrow_id        text,               -- bytes32 game id (0x-prefixed hex)
  add column if not exists entry_fee_usdc   bigint,             -- 6-decimal units, e.g. 10000000 = $10
  add column if not exists rake_bps         int,                -- basis points, e.g. 1500 = 15%
  add column if not exists payout_preset    text,               -- 'wta' | 'top3' | 'top6' | 'top8'
  add column if not exists payout_bps       jsonb,              -- [3300,2000,...] locked split (sums to 10000)
  add column if not exists contract_address text,               -- escrow proxy address
  add column if not exists chain_id         int;                -- 8453 base | 84532 base-sepolia

-- One escrow instance per tournament. Partial unique index ignores the many
-- free tournaments (escrow_id NULL) so they never collide.
create unique index if not exists tournaments_escrow_id_idx
  on tournaments (escrow_id)
  where escrow_id is not null;

-- ── players: mirror per-entry deposit / refund status ───────────────────────
-- The bracket only ever includes FUNDED players. `funded` flips true only after
-- a deposit is confirmed on-chain (>= ~10 Base confirmations); the reconcile
-- pass repairs these against the contract idempotently.
alter table players
  add column if not exists deposit_tx    text,                  -- confirmed deposit tx hash
  add column if not exists deposit_block bigint,                -- block the deposit landed in (for confirmations)
  add column if not exists funded        boolean not null default false,
  add column if not exists funded_at     timestamptz,
  add column if not exists refunded      boolean not null default false;

create index if not exists players_funded_idx
  on players (tournament_id)
  where funded = true;
