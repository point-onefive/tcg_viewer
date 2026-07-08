-- 018_participation_badge.sql
--
-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 015_tournament_badges.sql). MUST run on the SAME project as the tournament
-- tables. Safe to run on prod AND the preview project.
--
-- Adds an OPTIONAL, single participation badge per tournament: a badge handed to
-- EVERY participant (not by placement). It sits next to the placement Badge pool
-- (`tournaments.badges`, migration 015) but is a single slot rather than one per
-- rank. On award, one row is written into the existing `tournament_awarded_badges`
-- table for each participant with `slot_index = -1` and `rank = null` (the marker
-- that distinguishes a participation award from a placement award). Reusing that
-- table means the profile shelf renders it with zero read-side changes.
--
-- Security model: same as the rest of the schema. Written by the service-role
-- key in route handlers; reads for profiles also go through route handlers. RLS
-- on with no permissive policies => anon key gets nothing.

-- ── tournaments.participation_badge + participation_badge_awarded_at ────────
-- Single JSON object { title, description, image } or null. `image` is a
-- normalized (trimmed, 1:1, 512px) WebP data URL produced client-side on upload,
-- same pipeline as the placement Badge pool.
alter table tournaments
  add column if not exists participation_badge jsonb;

alter table tournaments
  add column if not exists participation_badge_awarded_at timestamptz;
