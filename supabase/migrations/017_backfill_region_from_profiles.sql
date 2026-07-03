-- 017_backfill_region_from_profiles.sql
--
-- One-time reconciliation: fill a coarse region onto existing tournament rows
-- that predate the "region required" rule (migration 012), pulling from each
-- wallet's saved profile region. Legacy waitlist entries and players converted
-- from them landed with region = null; this backfills them from wallet_profiles
-- so the whole field has a geo bucket.
--
-- Safe to re-run: only fills NULLs, never overwrites a region a player already
-- chose for a specific event. Matches by wallet address first, then by X handle
-- (for rows that were never wallet-linked). Going forward the app backfills on
-- profile edit / waitlist conversion / promotion, so this is just the catch-up.

-- Players by wallet address.
update players p
set region = wp.region
from wallet_profiles wp
where p.region is null
  and p.wallet_address is not null
  and lower(p.wallet_address) = lower(wp.wallet_address)
  and wp.region is not null;

-- Players by X handle (rows not yet linked to a wallet).
update players p
set region = wp.region
from wallet_profiles wp
where p.region is null
  and p.x_handle is not null
  and lower(p.x_handle) = lower(wp.x_handle)
  and wp.region is not null;

-- Un-converted waitlist entries by wallet address.
update tournament_waitlist tw
set region = wp.region
from wallet_profiles wp
where tw.region is null
  and tw.wallet_address is not null
  and lower(tw.wallet_address) = lower(wp.wallet_address)
  and wp.region is not null;

-- Un-converted waitlist entries by X handle.
update tournament_waitlist tw
set region = wp.region
from wallet_profiles wp
where tw.region is null
  and tw.x_handle is not null
  and lower(tw.x_handle) = lower(wp.x_handle)
  and wp.region is not null;
