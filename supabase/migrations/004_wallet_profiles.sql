-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 003_tournament_prizes.sql). MUST run on the SAME project as the
-- tournament tables (players/matches) because wallet_profiles links to players.
--
-- Adds a wallet-based identity layer: one profile per EVM wallet address.
-- Profiles are independent of any specific tournament; they persist across
-- events and accumulate a cross-tournament win/loss record.
--
-- Security model: same as the rest of the schema. All reads/writes go through
-- Next.js route handlers using the SERVICE ROLE key. The wallet_address is
-- verified server-side via SIWE (Sign-In With Ethereum) before any mutation.

-- ── wallet_profiles ────────────────────────────────────────────────────────
-- One row per EVM wallet address. Address is stored lowercase (0x-prefixed).
create table if not exists wallet_profiles (
  wallet_address  text primary key,              -- lowercase 0x-prefixed EVM address
  username        text unique,                   -- 3-20 chars, alphanumeric/_/-, null until set
  x_handle        text,                          -- lowercase, stored without @ prefix
  avatar_url      text,                          -- external HTTPS URL, null = no avatar
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

alter table wallet_profiles enable row level security;
-- No permissive policies: all access via service role key in route handlers.

-- Format constraints as a DB-level safety net (the app layer validates first).
-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS", so guard with a DO block.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'wallet_profiles_username_format'
  ) then
    alter table wallet_profiles
      add constraint wallet_profiles_username_format
      check (
        username is null
        or (length(username) between 3 and 20 and username ~ '^[a-zA-Z0-9_-]+$')
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'wallet_profiles_avatar_https'
  ) then
    alter table wallet_profiles
      add constraint wallet_profiles_avatar_https
      check (avatar_url is null or avatar_url like 'https://%');
  end if;
end $$;

-- ── Link players to wallet profiles ───────────────────────────────────────
-- Nullable: existing tournament players without wallets are unaffected.
-- When a wallet-authenticated user enrolls in a tournament their player row
-- will have wallet_address set so we can aggregate W/L across events.
alter table players
  add column if not exists wallet_address text references wallet_profiles(wallet_address) on delete set null;

create index if not exists players_wallet_address_idx on players(wallet_address)
  where wallet_address is not null;

-- ── Cross-tournament standings view ───────────────────────────────────────
-- Aggregates wins/losses/draws across ALL tournaments for each wallet.
-- Used for the public leaderboard and the profile card.
--   wins   = matches this player won (includes byes - a bye is a free win)
--   losses = confirmed matches won by someone else
--   draws  = confirmed matches with no winner
create or replace view wallet_standings as
select
  wp.wallet_address,
  wp.username,
  wp.x_handle,
  wp.avatar_url,
  count(distinct p.tournament_id) as tournaments_played,
  count(*) filter (where m.winner_id = p.id) as wins,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is not null and m.winner_id <> p.id) as losses,
  count(*) filter (where m.status = 'confirmed' and m.winner_id is null) as draws
from wallet_profiles wp
left join players p on p.wallet_address = wp.wallet_address
left join matches m on (m.player1_id = p.id or m.player2_id = p.id)
group by wp.wallet_address, wp.username, wp.x_handle, wp.avatar_url;

-- Trigger to keep updated_at current on wallet_profiles.
create or replace function wallet_profiles_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists wallet_profiles_updated_at_trigger on wallet_profiles;
create trigger wallet_profiles_updated_at_trigger
  before update on wallet_profiles
  for each row execute procedure wallet_profiles_updated_at();
