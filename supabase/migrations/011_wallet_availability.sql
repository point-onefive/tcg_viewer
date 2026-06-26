-- 011_wallet_availability.sql
--
-- Adds a lean, self-declared availability schedule to player profiles so
-- opponents across timezones can find overlap. Stored as JSONB:
--   { "tz": "America/New_York", "weekday": [13,15], "weekend": [10,11] }
-- where weekday/weekend are whole-hour blocks (0-23) in the player's own tz.
--
-- The wallet_standings view is recreated to surface the column, since the
-- public profile popup is rendered from a standings row.

alter table wallet_profiles add column if not exists availability jsonb;

create or replace view wallet_standings as
select
  wp.wallet_address,
  wp.username,
  wp.x_handle,
  wp.avatar_url,
  wp.availability,
  count(distinct p.tournament_id) as tournaments_played,
  count(*) filter (where m.status = 'confirmed' and m.winner_id = p.id) as wins,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is not null and m.winner_id <> p.id) as losses,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is null) as draws
from wallet_profiles wp
left join players p on p.wallet_address = wp.wallet_address
left join matches m on (m.player1_id = p.id or m.player2_id = p.id)
group by wp.wallet_address, wp.username, wp.x_handle, wp.avatar_url, wp.availability;
