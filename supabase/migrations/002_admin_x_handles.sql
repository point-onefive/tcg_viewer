-- Run once in Supabase SQL editor (after schema.sql).
-- Adds admin-managed signup flow: X handles + approval before bracket.

alter table tournaments
  add column if not exists is_live boolean not null default false,
  add column if not exists max_players int;

alter table players
  add column if not exists x_handle text,
  add column if not exists approval_status text not null default 'pending';
  -- pending | approved | rejected

-- Backfill x_handle from display_name for any existing rows.
update players
set x_handle = lower(regexp_replace(display_name, '^@', ''))
where x_handle is null and display_name is not null;

create unique index if not exists players_tournament_x_handle_idx
  on players (tournament_id, lower(x_handle))
  where x_handle is not null and approval_status != 'rejected';
