-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 015_tournament_badges.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Adds a per-event visual theme id for the public /tournaments page. The app
-- maps this id to a theme definition in src/lib/tournament/theme.ts (palette,
-- copy, imagery, structural toggles like the partner pill + payout step).
--
-- NULL means "use the app default" (the incumbent BONK theme), so every
-- existing tournament keeps its current look untouched. Set it to e.g.
-- 'summer2026' from the admin panel to reskin a self-hosted event.

alter table tournaments
  add column if not exists theme text;
