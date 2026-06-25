-- 010_fix_wallet_standings_wins.sql
--
-- Fix: the all-time leaderboard counted a match as a win whenever winner_id
-- matched the player, REGARDLESS of match status. A single-sided "reported"
-- result stores a PROVISIONAL winner_id before the match is confirmed, so an
-- unconfirmed self-reported win was leaking into the leaderboard (e.g. a player
-- reporting a win while their opponent has reported nothing showed +1 win). That
-- is also the gameable path - a self-reported win must not count until it is
-- actually finalized.
--
-- Wins now require the match to be finalized: 'confirmed' (both agreed or an
-- admin settled it) or 'bye' (a free win). Losses and draws were already
-- correctly gated on 'confirmed', so they are unchanged. This is a read-only
-- view replacement - it mutates no rows and recomputes live on the next query.

create or replace view wallet_standings as
select
  wp.wallet_address,
  wp.username,
  wp.x_handle,
  wp.avatar_url,
  count(distinct p.tournament_id) as tournaments_played,
  count(*) filter (where m.winner_id = p.id and m.status in ('confirmed', 'bye')) as wins,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is not null and m.winner_id <> p.id) as losses,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is null) as draws
from wallet_profiles wp
left join players p on p.wallet_address = wp.wallet_address
left join matches m on (m.player1_id = p.id or m.player2_id = p.id)
group by wp.wallet_address, wp.username, wp.x_handle, wp.avatar_url;
