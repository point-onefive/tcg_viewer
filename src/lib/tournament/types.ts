// ─────────────────────────────────────────────────────────────────────────
// Tournament domain types
//
// These mirror the Postgres schema in `schema.sql`. Everything that crosses
// the API boundary is shaped here so the route handlers, the pairing engine,
// and the UI all speak the same language.
//
// Identity model: a tournament has ONE host token and each player has ONE
// player token. Tokens are long random strings handed out as part of a
// bookmarkable URL; the server only ever stores their SHA-256 hash. The
// plaintext token never leaves the browser that created it except inside
// that browser's own URL/localStorage.
// ─────────────────────────────────────────────────────────────────────────

import type { PollResults } from './poll'

/** Card games this tool knows about. Kept loose - purely a label. */
export type TournamentGame =
  | 'one-piece'
  | 'pokemon'
  | 'gundam'
  | 'dragon-ball'
  | 'digimon'
  | 'lorcana'
  | 'other'

/** Pairing system used to generate rounds. */
export type TournamentFormat = 'swiss' | 'single-elim'

/** Lifecycle of a whole tournament. */
export type TournamentStatus =
  | 'enrolling' // open / scheduled enrollment window
  | 'running' // bracket generated, rounds in progress
  | 'complete' // final standings locked
  | 'cancelled' // host called it off

/** Lifecycle of a single round. */
export type RoundStatus = 'active' | 'complete'

/**
 * Lifecycle of a single match.
 *  - pending:   no result reported yet
 *  - reported:  exactly one side reported; in the confirmation window
 *  - confirmed: both sides agree (or one-sided report stood after window)
 *  - disputed:  both sides claim the win - surfaced to the host
 *  - bye:       a player advanced unopposed (no opponent this round)
 */
export type MatchStatus =
  | 'pending'
  | 'reported'
  | 'confirmed'
  | 'disputed'
  | 'bye'

/** A player's self-reported outcome for their own match. */
export type ReportedResult = 'win' | 'loss' | 'draw'

/**
 * One slot in a tournament's prize pool. `image` is either a (client-
 * compressed) data URL or an external image URL; null = text-only slot.
 * Slot order in the array is the placing order (index 0 = 1st place).
 */
export interface TournamentPrize {
  /** Editable heading, e.g. "1st Place" or "Top 8". */
  title: string
  /** Free-text describing the prize. */
  description: string
  /** Pasted image (data URL) or external URL; null for text-only. */
  image: string | null
}

export interface Tournament {
  id: string
  /** Short human code used in the URL, e.g. "OP-7QK2". */
  code: string
  name: string
  game: TournamentGame
  format: TournamentFormat
  status: TournamentStatus
  /** Total Swiss rounds; ignored for single-elim (derived from bracket size). */
  swissRounds: number | null
  /** Default minutes a round stays open before the cron sweep can close it. */
  roundMinutes: number
  /** When enrollment auto-closes (ISO). null = host closes manually. */
  enrollClosesAt: string | null
  /** Free-text rules / notes the host wants players to see. */
  rules: string | null
  /** Optional Discord invite / X link the host shares for coordination. */
  contactUrl: string | null
  /** The one public tournament shown at /tournaments when true. */
  isLive: boolean
  /** Cap on signups; null = unlimited up to MAX_PLAYERS guard. */
  maxPlayers: number | null
  /** Admin-curated prize pool shown publicly; empty = no prizes. */
  prizes: TournamentPrize[]
  /** When prizes were resolved to winners (ISO); null = not awarded yet. */
  prizesAwardedAt: string | null
  /** When false, the prize-distribution poll is closed to new votes. */
  pollOpen: boolean
  createdAt: string
}

/** Admin gate before a player enters the bracket. */
export type ApprovalStatus = 'pending' | 'approved' | 'rejected'

export interface Player {
  id: string
  tournamentId: string
  displayName: string
  /** Required X handle - normalized, stored lowercase. */
  xHandle: string
  /** Clickable profile: https://x.com/{xHandle} */
  approvalStatus: ApprovalStatus
  /** Optional Discord handle if the player linked their account. */
  discordHandle: string | null
  /** EVM wallet that owns this entry, when signed up / converted via wallet. */
  walletAddress: string | null
  /** Swiss seed / single-elim seed (1 = top). Assigned at bracket gen. */
  seed: number | null
  /** True once the player drops; pairing skips them, no auto-wins. */
  dropped: boolean
  /**
   * The deck the player committed to for the event (OPTCG Sim text format).
   * Required at sign-up and locked once set; null only for in-flight rows
   * (waitlist conversions / walk-ins) that still owe a list before lock.
   * REDACTED in the public snapshot - read contents via the gated deck
   * endpoints (player sees own, host sees all). Use `hasDeckList` for status.
   */
  deckList: string | null
  /** Whether a deck list is on file. Safe to expose publicly (no contents). */
  hasDeckList: boolean
  createdAt: string
}

export interface Round {
  id: string
  tournamentId: string
  number: number
  status: RoundStatus
  startsAt: string
  /** Deadline for the round; cron auto-resolves stragglers past this. */
  endsAt: string | null
}

export interface Match {
  id: string
  roundId: string
  tournamentId: string
  number: number
  player1Id: string
  /** null on a bye. */
  player2Id: string | null
  status: MatchStatus
  /** Each side's self-report, null until they submit. */
  player1Report: ReportedResult | null
  player2Report: ReportedResult | null
  /** Resolved winner; null on a draw or unresolved. */
  winnerId: string | null
  /** Agreed match time in UTC (ISO); null until both confirm a slot. */
  scheduledAt: string | null
  /** When the single-sided report landed (drives the confirm window). */
  reportedAt: string | null
  resolvedAt: string | null
}

/**
 * A back-and-forth scheduling thread for one match. Each row is one
 * person's set of proposed UTC slots; the other side accepts one or
 * counter-proposes. All times are stored UTC and rendered in the
 * viewer's local zone client-side.
 */
export interface ScheduleProposal {
  id: string
  matchId: string
  proposedByPlayerId: string
  /** ISO UTC datetimes the proposer is free. */
  slots: string[]
  status: 'open' | 'accepted' | 'superseded'
  /** The slot that got accepted (ISO UTC), when status = accepted. */
  acceptedSlot: string | null
  createdAt: string
}

/** Computed standings row for the bracket / standings view. */
export interface StandingRow {
  playerId: string
  displayName: string
  dropped: boolean
  wins: number
  losses: number
  draws: number
  /** Match points: win = 3, draw = 1, loss = 0 (Swiss convention). */
  points: number
  /** Opponent win % tiebreak (0–1); 0 for single-elim. */
  oppWinPct: number
  rank: number
}

/**
 * An immutable record of one prize handed to one winner when an event finished.
 * The title/description/image are SNAPSHOTS taken at award time, so later edits
 * to the live prize pool never rewrite history. A prize split across several
 * winners is several rows sharing the same `slotIndex`/`title`/`image`.
 */
export interface AwardedPrize {
  id: string
  /** Which prize slot (0-based) in the live pool this came from. */
  slotIndex: number
  /** The winner's final placement (1 = champion); null if unranked. */
  rank: number | null
  /** Prize title snapshot, e.g. "1st Place" or "Top 8". */
  title: string
  /** Prize description snapshot - the context an image alone can't convey. */
  description: string
  /** Prize image snapshot (data URL / external URL); null for text-only. */
  image: string | null
  /** Winner identity snapshots. walletAddress is null for X-handle-only players. */
  playerId: string | null
  walletAddress: string | null
  xHandle: string | null
  displayName: string | null
  awardedAt: string
}

// ── API payloads ───────────────────────────────────────────────────────────

export interface CreateTournamentInput {
  name: string
  game: TournamentGame
  format: TournamentFormat
  swissRounds?: number | null
  roundMinutes: number
  enrollClosesAt?: string | null
  rules?: string | null
  contactUrl?: string | null
  /** The host's chosen display name (host is also player 0 if they join). */
  hostName: string
}

/** What the create endpoint hands back - includes the secret host token ONCE. */
export interface CreateTournamentResult {
  tournament: Tournament
  hostToken: string
}

export interface EnrollResult {
  player: Player
  playerToken: string
}

/** Public snapshot the bracket page renders (no token hashes ever). */
export interface TournamentSnapshot {
  tournament: Tournament
  players: Player[]
  rounds: Round[]
  matches: Match[]
  proposals: ScheduleProposal[]
  standings: StandingRow[]
  /** Prize-distribution poll tallies for the live tournament. */
  poll: PollResults
  /** Prizes resolved to winners; empty until the event completes + is awarded. */
  awardedPrizes: AwardedPrize[]
}
