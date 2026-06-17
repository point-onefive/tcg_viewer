-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 005_tournament_waitlist.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Adds persistent final placements so a wallet profile can show "finalist"
-- badges (gold / silver / bronze) earned in past tournaments.
--
-- Why store this: standings are normally recomputed on the fly from matches,
-- but a profile needs to look up "which tournaments did this wallet place in"
-- cheaply and long after the event. When a tournament finishes, the app writes
-- each bracket player's final rank onto their player row; the badge query then
-- joins players -> tournaments for any wallet with final_rank <= 3.
--
-- Security model: same as the rest of the schema. Placements are written by the
-- service-role key when a tournament completes; reads are public (placements
-- are not secret) but still go through Next.js route handlers.

-- ── Final placement columns on players ─────────────────────────────────────
-- final_rank    : 1-indexed finishing position within the bracket (1 = champion).
--                 NULL until the tournament completes (and only set for players
--                 who were actually seeded into the bracket).
-- final_players : how many players the bracket finished with, so a badge can
--                 read "2nd of 16" without re-counting.
alter table players
  add column if not exists final_rank integer;

alter table players
  add column if not exists final_players integer;

-- Fast lookup for the badge query: a wallet's podium finishes.
create index if not exists players_wallet_final_rank_idx
  on players (wallet_address, final_rank)
  where wallet_address is not null and final_rank is not null;

-- NOTE: placements for tournaments that completed BEFORE this migration are
-- backfilled from the admin panel (Recompute placements) - the app recomputes
-- standings for every completed tournament and writes final_rank in one pass.
-- No manual SQL backfill is needed.
