-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 004_wallet_profiles.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Adds a wallet-backed waitlist so people can register interest in the NEXT
-- event while a tournament is already running (or between events). Joining is
-- one tap once a wallet is connected - the X handle is pulled straight from the
-- wallet profile, so there is nothing to retype. When the operator opens the
-- next tournament, every pending waitlist entry is auto-converted into a
-- PENDING player sign-up for that event (still subject to admin approval), and
-- the entry is stamped converted_at so it leaves the waitlist.
--
-- Security model: same as the rest of the schema. All reads/writes go through
-- Next.js route handlers using the SERVICE ROLE key; the wallet_address is
-- verified server-side via SIWE before any insert. RLS is enabled with no
-- permissive policies so the public anon key gets nothing.

-- ── tournament_waitlist ────────────────────────────────────────────────────
-- Global (not tied to a tournament id, because the next event does not exist
-- yet). One row per wallet while pending. `converted_at` is stamped when the
-- entry is rolled into a real sign-up, which also releases the wallet + handle
-- from the dedupe indexes so the same person can waitlist again next time.
create table if not exists tournament_waitlist (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,                 -- lowercase 0x-prefixed EVM address
  x_handle        text not null,                 -- lowercase, without @, copied from profile
  created_at      timestamptz not null default now(),
  converted_at    timestamptz,                   -- null = still waiting
  converted_tournament_id uuid                   -- which event absorbed this entry
    references tournaments(id) on delete set null
);

-- One pending entry per wallet, and per handle. Partial unique indexes so the
-- same wallet/handle can reappear after a past entry has been converted.
create unique index if not exists tournament_waitlist_pending_wallet_idx
  on tournament_waitlist (wallet_address)
  where converted_at is null;

create unique index if not exists tournament_waitlist_pending_handle_idx
  on tournament_waitlist (lower(x_handle))
  where converted_at is null;

create index if not exists tournament_waitlist_created_idx
  on tournament_waitlist (created_at);

alter table tournament_waitlist enable row level security;
-- No permissive policies: all access via service role key in route handlers.
