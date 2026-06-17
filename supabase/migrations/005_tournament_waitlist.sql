-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 004_wallet_profiles.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Adds a lightweight, frictionless waitlist so people can register interest in
-- the NEXT event while a tournament is already running (or between events).
-- A waitlist entry is just an X handle - no wallet, no password - so the barrier
-- to "notify me next time" is as low as possible. The operator pulls the list
-- when opening the next tournament.
--
-- Security model: same as the rest of the schema. All reads/writes go through
-- Next.js route handlers using the SERVICE ROLE key; RLS is enabled with no
-- permissive policies so the public anon key gets nothing.

-- ── tournament_waitlist ────────────────────────────────────────────────────
-- Global (not tied to a tournament id, because the next event does not exist
-- yet). `converted_at` is stamped when the operator rolls an entry into a real
-- sign-up, which also releases the handle from the dedupe index so the same
-- person can waitlist again for a future event.
create table if not exists tournament_waitlist (
  id              uuid primary key default gen_random_uuid(),
  x_handle        text not null,                 -- lowercase, stored without @ prefix
  wallet_address  text,                          -- optional: set if they were signed in
  created_at      timestamptz not null default now(),
  converted_at    timestamptz                    -- null = still waiting
);

-- One pending entry per handle. Partial unique index so a handle can reappear
-- after it has been converted for a past event.
create unique index if not exists tournament_waitlist_pending_handle_idx
  on tournament_waitlist (lower(x_handle))
  where converted_at is null;

create index if not exists tournament_waitlist_created_idx
  on tournament_waitlist (created_at);

alter table tournament_waitlist enable row level security;
-- No permissive policies: all access via service role key in route handlers.
