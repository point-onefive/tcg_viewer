-- 014_profile_badges.sql
--
-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 013_profile_country.sql). MUST run on the SAME project as the tournament
-- tables. Safe to run on prod AND the preview project.
--
-- Adds the "Badges" shelf backing store: a simple grant table pairing a wallet
-- with a badge id (from the code-side catalog in src/lib/wallet/badge-catalog).
-- Badges are cosmetic awards (participation / placement / one-offs) shown on the
-- player profile. Grants are explicit rows here (backfilled by script or added
-- by an admin later), never derived on the fly.
--
-- Security model: unchanged. All reads/writes go through Next.js route handlers
-- (or a service-role script) using the SERVICE ROLE key.

create table if not exists profile_badges (
  wallet_address text not null,
  badge_id       text not null,
  awarded_at     timestamptz not null default now(),
  primary key (wallet_address, badge_id)
);

create index if not exists profile_badges_wallet_idx
  on profile_badges (wallet_address);
