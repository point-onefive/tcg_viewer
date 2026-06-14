-- Run once in Supabase SQL editor (after 002_admin_x_handles.sql).
-- Adds an admin-managed prize pool to a tournament. Each entry is
-- { title, description, image } where image is a (compressed) data URL
-- or external URL. Empty array = no prizes (the public page hides the
-- whole section in that case).

alter table tournaments
  add column if not exists prizes jsonb not null default '[]'::jsonb;
