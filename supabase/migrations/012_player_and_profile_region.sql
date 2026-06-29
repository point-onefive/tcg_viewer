-- 012_player_and_profile_region.sql
--
-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 011_wallet_availability.sql). MUST run on the SAME project as the tournament
-- tables. Safe to run on prod AND the preview project.
--
-- Adds a coarse geographic region ('amer' | 'emea' | 'apac') so events can be
-- planned / paired around time-zone overlap as the field grows. Captured
-- explicitly at waitlist + sign-up, and stored on the wallet profile so it
-- pre-fills sign-up next time.
--
-- Nullable on purpose (mirrors the deck-list rollout, migration 008): existing
-- waitlist rows, players, and profiles start NULL ("Unspecified") and are never
-- blocked. "Required" is enforced at the app boundary for NEW waitlist/sign-up
-- submissions, not via a NOT NULL constraint that would break in-flight rows.
-- A CHECK keeps the value to the known buckets while still permitting NULL.
--
-- Security model: unchanged. All reads/writes go through Next.js route handlers
-- using the SERVICE ROLE key.

alter table players
  add column if not exists region text
    check (region in ('amer', 'emea', 'apac'));

alter table tournament_waitlist
  add column if not exists region text
    check (region in ('amer', 'emea', 'apac'));

alter table wallet_profiles
  add column if not exists region text
    check (region in ('amer', 'emea', 'apac'));

-- Recreate the standings view so the public profile popup (rendered from a
-- standings row) can show region. As in migration 011, `create or replace view`
-- can only APPEND columns, so `region` goes LAST. Selection is by name in app
-- code, so column order does not matter.
create or replace view wallet_standings as
select
  wp.wallet_address,
  wp.username,
  wp.x_handle,
  wp.avatar_url,
  count(distinct p.tournament_id) as tournaments_played,
  count(*) filter (where m.status = 'confirmed' and m.winner_id = p.id) as wins,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is not null and m.winner_id <> p.id) as losses,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is null) as draws,
  wp.availability,
  wp.region
from wallet_profiles wp
left join players p on p.wallet_address = wp.wallet_address
left join matches m on (m.player1_id = p.id or m.player2_id = p.id)
group by wp.wallet_address, wp.username, wp.x_handle, wp.avatar_url, wp.availability, wp.region;
