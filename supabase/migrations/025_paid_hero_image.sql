-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 024_tournament_join_code.sql). MUST run on the SAME project as the tournament
-- tables.
--
-- Optional hero background image for a PAID game's page. Set at create time in
-- the admin panel by pasting an image URL, uploading a file, or pasting an
-- image from the clipboard. Stores EITHER a compressed WebP data URL
-- (uploaded/pasted image, mirroring how prize images ride inside the snapshot)
-- OR a plain image URL (pasted link). Both are usable directly in CSS url(...).
--
-- NULL means "use the default arena background" (/tournaments/paid-hero.webp),
-- so every existing paid game keeps the default look with no behavior change.
--
-- Additive and idempotent.

alter table tournaments add column if not exists hero_image text;
