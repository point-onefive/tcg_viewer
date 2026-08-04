-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 022_paid_deck_audit.sql). MUST run on the SAME project as the tournament
-- tables.
--
-- Pre-mainnet hardening: a lightweight, DB-backed rate-limit ledger for the
-- public enroll route. Each POST /api/tournaments/:code/enroll records one row
-- here (wallet + IP + timestamp); the route counts recent rows per wallet and
-- per IP in a short sliding window and returns 429 when a burst crosses the
-- threshold. DB-backed (not in-memory) so the limit holds across serverless
-- instances.
--
-- Everything here is additive and idempotent ("if not exists"). The route
-- treats a missing table / query error as "allow" (best-effort), so the app
-- runs unchanged BEFORE this migration is applied and never blocks a legit
-- sign-up on the limiter.

-- ── enroll_attempts: one row per enroll POST, for sliding-window counting ────
create table if not exists enroll_attempts (
  id             uuid primary key default gen_random_uuid(),
  wallet_address text,        -- lowercased signed-in wallet (nullable)
  ip             text,        -- best-effort client IP from x-forwarded-for
  created_at     timestamptz not null default now()
);

-- Windowed counts are keyed by (wallet, time) and (ip, time).
create index if not exists enroll_attempts_wallet_created_idx
  on enroll_attempts (wallet_address, created_at);
create index if not exists enroll_attempts_ip_created_idx
  on enroll_attempts (ip, created_at);

-- Housekeeping helper: prune rows older than a day so the table stays tiny.
-- Optional to schedule; the windows are minutes, so anything older is dead
-- weight. Safe to run any time.
--   delete from enroll_attempts where created_at < now() - interval '1 day';
