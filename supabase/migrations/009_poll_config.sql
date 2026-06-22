-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 008_player_deck_lists.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Makes the player feedback poll configurable per event. Until now the poll
-- question + ballot were hardcoded in the app; these two nullable columns let
-- the host set a custom question and option list from the admin panel without
-- a code change. NULL on either column means "use the app default" (the
-- built-in question + Cash / Slab / Sealed ballot), so existing tournaments
-- keep working untouched.
--
-- poll_options shape: a JSON array of { id, label, blurb }, where `id` is a
-- stable slug stored on each poll_votes.choice row. The app validates a vote's
-- choice against the live event's options (custom or default).

alter table tournaments
  add column if not exists poll_question text,
  add column if not exists poll_options  jsonb;
