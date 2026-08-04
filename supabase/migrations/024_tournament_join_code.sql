-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 023_enroll_rate_limit.sql). MUST run on the SAME project as the tournament
-- tables.
--
-- Optional per-tournament "join code" (a shared room passcode, like a Zoom
-- passcode - NOT a per-user account password). When set, players must enter
-- the correct code to enroll in that specific tournament. Use case: the
-- operator shares the code for a private lobby (e.g. their APAC group) so only
-- invited players can join. Separate from and additive to the global soft
-- password NEXT_PUBLIC_TOURNAMENT_PASSWORD.
--
-- Stored SERVER-SIDE ONLY in plaintext (a shared room code, not a secret
-- credential). The raw value is NEVER mapped into the public Tournament domain
-- object / public API responses; only a derived `joinProtected` boolean is
-- exposed. See src/lib/tournament/{types,mappers,service}.ts.
--
-- Additive and idempotent. Existing tournaments get join_password = null =>
-- joinProtected=false => an open lobby with no behavior change.

alter table tournaments add column if not exists join_password text;
