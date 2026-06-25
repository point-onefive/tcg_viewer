-- 010_fix_wallet_standings_wins.sql
--
-- Two corrections to the all-time leaderboard view (wallet_standings):
--
-- 1. Only finalized results count. The old `wins` filter matched any row where
--    winner_id = the player, REGARDLESS of status. A single-sided "reported"
--    result stores a PROVISIONAL winner_id before the match is confirmed, so an
--    unconfirmed self-reported win was leaking into the board (and was gameable).
--    Wins now require status = 'confirmed' (both players agreed, or an admin
--    settled it). Losses/draws were already gated on 'confirmed'.
--
-- 2. Byes are excluded from the lifetime board. A bye is luck of the pairing,
--    not an earned result, so counting it as a win inflates a player's win rate
--    across events. The leaderboard now reflects games actually played. (Inside a
--    single tournament a bye still counts as a match win for Swiss points - that
--    logic lives in computeStandings, not in this view.)
--
-- This is a read-only view replacement: it mutates no rows and recomputes live
-- on the next query.

create or replace view wallet_standings as
select
  wp.wallet_address,
  wp.username,
  wp.x_handle,
  wp.avatar_url,
  count(distinct p.tournament_id) as tournaments_played,
  count(*) filter (where m.status = 'confirmed' and m.winner_id = p.id) as wins,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is not null and m.winner_id <> p.id) as losses,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is null) as draws
from wallet_profiles wp
left join players p on p.wallet_address = wp.wallet_address
left join matches m on (m.player1_id = p.id or m.player2_id = p.id)
group by wp.wallet_address, wp.username, wp.x_handle, wp.avatar_url;
