-- 019_manual_badges.sql
--
-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 018_participation_badge.sql). MUST run on the SAME project as the tournament
-- tables. Safe to run on prod AND the preview project.
--
-- Standalone, tournament-agnostic cosmetic badges. Unlike tournament_awarded_
-- badges (which require a tournament and are awarded by placement), these are
-- granted by hand from the admin panel to any registered wallet_profiles user
-- at any time. Same snapshot shape (title / description / normalized image data
-- URL) so they render identically on the profile shelf.
--
-- Security model: same as the rest of the schema. Written by the service-role
-- key in route handlers; reads for profiles also go through route handlers. RLS
-- on with no permissive policies => anon key gets nothing.

create table if not exists manual_awarded_badges (
  id              uuid primary key default gen_random_uuid(),
  wallet_address  text not null,                  -- lowercase 0x-prefixed recipient
  x_handle        text,                           -- lowercase, no @, snapshot for display
  display_name    text,                           -- recipient name snapshot
  title           text not null,                  -- badge header
  description     text not null default '',        -- badge sub-header
  image           text,                           -- normalized badge image (data URL)
  awarded_at      timestamptz not null default now()
);

-- Fast profile lookup: every manual badge a wallet has been given.
create index if not exists manual_badges_wallet_idx
  on manual_awarded_badges (wallet_address);

alter table manual_awarded_badges enable row level security;
-- No permissive policies: all access via service role key in route handlers.
