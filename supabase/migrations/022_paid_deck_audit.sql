-- Run once in the cardwall-tournaments Supabase SQL editor (after
-- 021_paid_autopilot.sql). MUST run on the SAME project as the tournament
-- tables.
--
-- Phase P2 of the paid-tournament build: the match/deck integrity layer.
-- Three additive concerns, all PAID-only in behavior (gated in code to
-- escrow-linked tournaments):
--   1. deck-lock auditability: players.deck_locked_at records WHEN an approved
--      paid entrant's decklist became immutable (approval freezes the list).
--   2. dispute battle-log evidence: matches gets four nullable columns so a
--      participant in a DISPUTED paid match can attach an OPTCG Sim battle log
--      (a URL and/or pasted text) for the organizer to read before resolving.
--
-- Everything here is additive, idempotent ("if not exists"), and
-- nullable / defaulted so the app runs unchanged BEFORE this migration is
-- applied and every EXISTING (free) tournament is untouched. Free / featured
-- events never write these columns: deck_locked_at stays NULL (no paid-approval
-- lock happens for them) and the dispute-log columns stay NULL (the attach path
-- is gated to paid disputed matches only).

-- ── players: record when an approved paid entrant's decklist locked ─────────
-- NULL = not locked via the paid-approval path (every free-event row, and any
-- paid row still pending / rejected). Set once, on the pending -> approved
-- transition for a paid tournament, purely for auditability. The decklist is
-- already effectively immutable in code (player self-submit is set-once); this
-- column just timestamps the moment for the public audit / dispute trail.
alter table players
  add column if not exists deck_locked_at timestamptz;

-- ── matches: OPTCG Sim battle-log evidence for a disputed paid match ────────
-- Attached by EITHER participant of a DISPUTED paid match (gated in code). The
-- organizer reads url/text in the admin dispute-resolution UI before picking a
-- winner. dispute_log_by is the attacher's wallet address (lowercased); all
-- four stay NULL for free events and for any match that was never disputed.
alter table matches
  add column if not exists dispute_log_url  text,        -- link to an OPTCG Sim battle log / replay
  add column if not exists dispute_log_text text,        -- pasted battle-log text (optional)
  add column if not exists dispute_log_by   text,        -- attacher wallet address (lowercased)
  add column if not exists dispute_log_at   timestamptz; -- when the evidence was attached
