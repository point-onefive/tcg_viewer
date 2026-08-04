import type {
  Match,
  Player,
  Round,
  ScheduleProposal,
  Tournament,
  TournamentPrize,
  TournamentBadgeSlot,
  MatchStatus,
  ReportedResult,
  RoundStatus,
  TournamentFormat,
  TournamentGame,
  TournamentStatus,
} from './types'
import type { PollOption } from './poll'
import { sanitizeRegion } from './region'

/** Defensively coerce the JSONB `prizes` column into clean domain objects. */
function rowToPrizes(raw: unknown): TournamentPrize[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((p): p is Record<string, unknown> => Boolean(p) && typeof p === 'object')
    .map((p) => ({
      title: typeof p.title === 'string' ? p.title : '',
      description: typeof p.description === 'string' ? p.description : '',
      image: typeof p.image === 'string' && p.image ? p.image : null,
    }))
}

/** Defensively coerce the JSONB `badges` column into clean domain objects. */
function rowToBadges(raw: unknown): TournamentBadgeSlot[] {
  if (!Array.isArray(raw)) return []
  return raw
    .filter((b): b is Record<string, unknown> => Boolean(b) && typeof b === 'object')
    .map((b) => ({
      title: typeof b.title === 'string' ? b.title : '',
      description: typeof b.description === 'string' ? b.description : '',
      image: typeof b.image === 'string' && b.image ? b.image : null,
    }))
}

/** Coerce the JSONB `participation_badge` column into a single slot or null. */
function rowToParticipationBadge(raw: unknown): TournamentBadgeSlot | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const b = raw as Record<string, unknown>
  const image = typeof b.image === 'string' && b.image ? b.image : null
  if (!image) return null
  return {
    title: typeof b.title === 'string' ? b.title : '',
    description: typeof b.description === 'string' ? b.description : '',
    image,
  }
}

/** Coerce the JSONB `poll_options` column; null when absent/empty/invalid. */
function rowToPollOptions(raw: unknown): PollOption[] | null {
  if (!Array.isArray(raw)) return null
  const options = raw
    .filter((o): o is Record<string, unknown> => Boolean(o) && typeof o === 'object')
    .map((o) => ({
      id: typeof o.id === 'string' ? o.id : '',
      label: typeof o.label === 'string' ? o.label : '',
      blurb: typeof o.blurb === 'string' ? o.blurb : '',
    }))
    .filter((o) => o.id && o.label)
  return options.length > 0 ? options : null
}

// ─────────────────────────────────────────────────────────────────────────
// snake_case Postgres rows → camelCase domain objects. Token-hash columns are
// intentionally never copied across so they can't leak into an API response.
// ─────────────────────────────────────────────────────────────────────────

/* eslint-disable @typescript-eslint/no-explicit-any */

export function rowToTournament(r: any): Tournament {
  return {
    id: r.id,
    code: r.code,
    name: r.name,
    game: r.game as TournamentGame,
    format: r.format as TournamentFormat,
    status: r.status as TournamentStatus,
    swissRounds: r.swiss_rounds ?? null,
    roundMinutes: r.round_minutes,
    enrollClosesAt: r.enroll_closes_at ?? null,
    rules: r.rules ?? null,
    contactUrl: r.contact_url ?? null,
    isLive: Boolean(r.is_live),
    maxPlayers: r.max_players ?? null,
    prizes: rowToPrizes(r.prizes),
    prizesAwardedAt: r.prizes_awarded_at ?? null,
    badges: rowToBadges(r.badges),
    badgesAwardedAt: r.badges_awarded_at ?? null,
    participationBadge: rowToParticipationBadge(r.participation_badge),
    participationBadgeAwardedAt: r.participation_badge_awarded_at ?? null,
    // Default open when the column is absent (pre-migration) or null.
    pollOpen: r.poll_open ?? true,
    pollQuestion: typeof r.poll_question === 'string' && r.poll_question.trim() ? r.poll_question : null,
    pollOptions: rowToPollOptions(r.poll_options),
    theme: typeof r.theme === 'string' && r.theme.trim() ? r.theme : null,
    escrowId: typeof r.escrow_id === 'string' && r.escrow_id ? r.escrow_id : null,
    entryFeeUsdc: r.entry_fee_usdc != null ? Number(r.entry_fee_usdc) : null,
    rakeBps: r.rake_bps != null ? Number(r.rake_bps) : null,
    payoutPreset: typeof r.payout_preset === 'string' && r.payout_preset ? r.payout_preset : null,
    payoutBps: Array.isArray(r.payout_bps)
      ? r.payout_bps.filter((n: unknown) => typeof n === 'number')
      : null,
    contractAddress:
      typeof r.contract_address === 'string' && r.contract_address ? r.contract_address : null,
    chainId: r.chain_id != null ? Number(r.chain_id) : null,
    isPaid: Boolean(typeof r.escrow_id === 'string' && r.escrow_id),
    // sanitizeRegion(undefined) === null, so pre-migration rows (no column) and
    // open lobbies (null) both resolve to null.
    lobbyRegion: sanitizeRegion(r.lobby_region),
    // Only expose a derived boolean; the raw join_password is server-side only
    // and must never be copied into the public domain object / API responses.
    joinProtected: r.join_password != null && String(r.join_password).trim() !== '',
    // Tolerate the column being absent (pre-migration 025): null falls back to
    // the default arena background at the render site.
    heroImage: typeof r.hero_image === 'string' && r.hero_image.trim() ? r.hero_image : null,
    createdAt: r.created_at,
  }
}

export function rowToPlayer(r: any): Player {
  const xHandle = r.x_handle ?? r.display_name?.replace(/^@/, '').toLowerCase() ?? ''
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    displayName: r.display_name,
    xHandle,
    approvalStatus: (r.approval_status ?? 'approved') as Player['approvalStatus'],
    discordHandle: r.discord_handle ?? null,
    walletAddress: r.wallet_address ?? null,
    seed: r.seed ?? null,
    region: sanitizeRegion(r.region),
    dropped: Boolean(r.dropped),
    funded: Boolean(r.funded),
    refunded: Boolean(r.refunded),
    depositTx: r.deposit_tx ?? null,
    deckList: r.deck_list ?? null,
    hasDeckList: Boolean(r.deck_list),
    // null when the column is absent (pre-migration) or the player was never
    // approved into a paid event.
    deckLockedAt: r.deck_locked_at ?? null,
    // Leader is derived from the deck list in the snapshot layer (it needs the
    // card index); default null here so the raw mapper stays pure.
    leaderCardId: null,
    leaderName: null,
    leaderImage: null,
    createdAt: r.created_at,
  }
}

export function rowToRound(r: any): Round {
  return {
    id: r.id,
    tournamentId: r.tournament_id,
    number: r.number,
    status: r.status as RoundStatus,
    startsAt: r.starts_at,
    endsAt: r.ends_at ?? null,
  }
}

export function rowToMatch(r: any): Match {
  return {
    id: r.id,
    roundId: r.round_id,
    tournamentId: r.tournament_id,
    number: r.number,
    player1Id: r.player1_id,
    player2Id: r.player2_id ?? null,
    status: r.status as MatchStatus,
    player1Report: (r.player1_report ?? null) as ReportedResult | null,
    player2Report: (r.player2_report ?? null) as ReportedResult | null,
    winnerId: r.winner_id ?? null,
    scheduledAt: r.scheduled_at ?? null,
    reportedAt: r.reported_at ?? null,
    resolvedAt: r.resolved_at ?? null,
    // Dispute battle-log evidence; all null pre-migration / when never attached.
    disputeLogUrl: r.dispute_log_url ?? null,
    disputeLogText: r.dispute_log_text ?? null,
    disputeLogBy: r.dispute_log_by ?? null,
    disputeLogAt: r.dispute_log_at ?? null,
  }
}

export function rowToProposal(r: any): ScheduleProposal {
  return {
    id: r.id,
    matchId: r.match_id,
    proposedByPlayerId: r.proposed_by_player_id,
    slots: Array.isArray(r.slots) ? r.slots : [],
    status: r.status,
    acceptedSlot: r.accepted_slot ?? null,
    createdAt: r.created_at,
  }
}
