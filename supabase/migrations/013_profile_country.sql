-- 013_profile_country.sql
--
-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 012_player_and_profile_region.sql). MUST run on the SAME project as the
-- tournament tables. Safe to run on prod AND the preview project.
--
-- Adds an OPTIONAL, self-declared country to the wallet profile, shown as an
-- emoji flag next to a player's name (profile pic + username + flag). Purely
-- cosmetic / for flavor: it is never required and never gates waitlist or
-- sign-up. We store the ISO 3166-1 alpha-2 code (uppercase, e.g. 'US'); the app
-- derives the flag emoji + readable name from it.
--
-- Nullable on purpose: existing profiles start NULL (no flag) and are never
-- blocked. Unlike region we do NOT add it to players / waitlist - country is a
-- profile-only cosmetic, not a scheduling input.
--
-- Security model: unchanged. All reads/writes go through Next.js route handlers
-- using the SERVICE ROLE key.

alter table wallet_profiles
  add column if not exists country text
    check (country is null or country ~ '^[A-Z]{2}$');

-- Recreate the standings view so the public profile popup (rendered from a
-- standings row) can show the flag. As in migrations 011/012, `create or
-- replace view` can only APPEND columns, so `country` goes LAST. Selection is
-- by name in app code, so column order does not matter.
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
  wp.region,
  wp.country
from wallet_profiles wp
left join players p on p.wallet_address = wp.wallet_address
left join matches m on (m.player1_id = p.id or m.player2_id = p.id)
group by wp.wallet_address, wp.username, wp.x_handle, wp.avatar_url, wp.availability, wp.region, wp.country;
