-- Run once in the cardwall-tournaments Supabase SQL editor
-- (after 006_tournament_placements.sql). MUST run on the SAME project as the
-- tournament tables.
--
-- Adds a per-player deck list captured at sign-up. The list is the deck the
-- player commits to for the whole event; it is meant to stay unchanged once
-- locked. Stored as plain text in the OPTCG Sim export format (lines of
-- "<count>x<cardId>", e.g. "4xST01-003"), but the column is format-agnostic
-- free text so new or unknown card ids are never rejected.
--
-- Nullable on purpose: existing rows (and people auto-converted from the
-- waitlist, who joined before deck lists existed) start with NULL and must
-- submit their list before the bracket can be generated. The app enforces
-- "required" at sign-up and again as a guard when starting the bracket, rather
-- than via a NOT NULL constraint that would break those in-flight rows.
--
-- Security model: same as the rest of the schema. All reads/writes go through
-- Next.js route handlers using the SERVICE ROLE key; the wallet_address is
-- verified server-side via SIWE before any write.

alter table players
  add column if not exists deck_list text;
