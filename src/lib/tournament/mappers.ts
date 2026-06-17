import type {
  Match,
  Player,
  Round,
  ScheduleProposal,
  Tournament,
  TournamentPrize,
  MatchStatus,
  ReportedResult,
  RoundStatus,
  TournamentFormat,
  TournamentGame,
  TournamentStatus,
} from './types'

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
    // Default open when the column is absent (pre-migration) or null.
    pollOpen: r.poll_open ?? true,
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
    seed: r.seed ?? null,
    dropped: Boolean(r.dropped),
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
