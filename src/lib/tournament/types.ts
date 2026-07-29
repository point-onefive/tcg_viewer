import type { Region } from './region'

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

import type { PollOption, PollResults } from './poll'

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
 *  - double_forfeit: neither side reported by a HARD round deadline (autopilot
 *      paid games only). Counts as a loss for BOTH players so stalling can
 *      never force a coin-flip; see docs/paid-tournaments-escrow.md.
 */
export type MatchStatus =
  | 'pending'
  | 'reported'
  | 'confirmed'
  | 'disputed'
  | 'bye'
  | 'double_forfeit'

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

/**
 * One slot in a tournament's badge pool. Structurally identical to a prize slot
 * (title/description/image), but semantically a per-placement award: slot order
 * is placing order (index 0 = 1st place), so N badges are handed to the top N
 * finishers on completion. `image` is a normalized (trimmed, 1:1, 512px) WebP
 * data URL produced client-side on upload - see lib/tournament/badge-image.
 */
export interface TournamentBadgeSlot {
  /** Header shown on the badge hover card, e.g. "BONK Champion". */
  title: string
  /** Sub-header / blurb shown under the header on hover. */
  description: string
  /** Normalized badge image (data URL); null = no art yet. */
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
  /** Admin-curated badge pool (one per placement); empty = no badges. */
  badges: TournamentBadgeSlot[]
  /** When badges were resolved to winners (ISO); null = not awarded yet. */
  badgesAwardedAt: string | null
  /**
   * Optional single badge handed to EVERY participant (not by placement).
   * null = none set. Structurally a badge slot (title/description/image).
   */
  participationBadge: TournamentBadgeSlot | null
  /** When the participation badge was handed out (ISO); null = not yet. */
  participationBadgeAwardedAt: string | null
  /** When false, the player feedback poll is closed to new votes. */
  pollOpen: boolean
  /** Custom poll heading for this event; null = use the default question. */
  pollQuestion: string | null
  /** Custom ballot for this event; null/empty = use the default options. */
  pollOptions: PollOption[] | null
  /**
   * Visual theme id for the public tournament page (see lib/tournament/theme).
   * null means unbranded until an explicit theme is set in admin.
   */
  theme: string | null
  /**
   * Paid-tournament escrow link (see docs/paid-tournaments-escrow.md). All null
   * for a free event; a tournament is "paid" iff `escrowId` is set. The chain is
   * the source of truth for money; these are a reconciled mirror.
   */
  escrowId: string | null
  /** Per-player entry fee in 6-decimal USDC units (e.g. 10_000000 = $10). */
  entryFeeUsdc: number | null
  /** Platform rake in basis points (e.g. 1500 = 15%). */
  rakeBps: number | null
  /** Payout preset id ('wta' | 'top3' | 'top6' | 'top8'). */
  payoutPreset: string | null
  /** Locked post-rake split in basis points (sums to 10000). */
  payoutBps: number[] | null
  /** Deployed escrow proxy address. */
  contractAddress: string | null
  /** EVM chain id (8453 base | 84532 base-sepolia). */
  chainId: number | null
  /** Convenience flag: true when this is a paid (escrowed) tournament. */
  isPaid: boolean
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
  /**
   * Coarse geographic region for scheduling ('amer' | 'emea' | 'apac').
   * null = unspecified (legacy rows / joined before regions existed). Used for
   * planning counts and a soft same-region pairing preference.
   */
  region: Region | null
  /**
   * Display identity resolved from the linked wallet profile, attached only
   * when building the public snapshot (not stored on the player row). Lets the
   * bracket / standings / roster show the leaderboard-style "avatar + username"
   * (falling back to the handle). Undefined outside the snapshot.
   */
  username?: string | null
  avatarUrl?: string | null
  /** Self-declared country (ISO 3166-1 alpha-2) from the linked profile, for the
   * flag shown next to the name. Attached only in the public snapshot. */
  country?: string | null
  /** True once the player drops; pairing skips them, no auto-wins. */
  dropped: boolean
  /**
   * Paid tournaments only: true once this player's on-chain deposit is
   * confirmed (>= min confirmations). The bracket only ever seats funded
   * players. Always false for free events.
   */
  funded: boolean
  /** Paid tournaments only: true once the entry was refunded on-chain. */
  refunded: boolean
  /** Confirmed deposit transaction hash; null until funded. */
  depositTx: string | null
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
  /**
   * The deck's Leader card, resolved from the (private) deck list. The Leader
   * is public during play (it sits face-up on the table; the metagame is
   * tracked by leader), so these are exposed in the public snapshot even while
   * the rest of the deck stays hidden. null when no known leader was found.
   */
  leaderCardId: string | null
  leaderName: string | null
  leaderImage: string | null
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
  /** Opponents' opponents' win % (deeper strength-of-schedule tiebreak; 0–1). */
  oppOppWinPct: number
  rank: number
  /**
   * True when this row could NOT be separated from an adjacent row by any merit
   * tiebreaker (points, OMW, head-to-head, OOMW, wins). Such rows are ordered
   * only by a stable fallback - never by name - and must be resolved with a
   * real tiebreaker before any placement-based award is made.
   */
  tied: boolean
  /** Shared id grouping rows that are mutually tied (see `tied`); null if not. */
  tieGroup: number | null
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

/**
 * An immutable record of one badge handed to one finisher when an event ended.
 * Mirrors AwardedPrize: title/description/image are SNAPSHOTS at award time so
 * later edits to the live badge pool never rewrite history.
 */
export interface AwardedBadge {
  id: string
  slotIndex: number
  /** The finisher's placement (1 = champion); the badge maps to this rank. */
  rank: number | null
  title: string
  description: string
  image: string | null
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

/**
 * Compact card shown in the always-on paid tournaments lobby (/tournaments/play).
 * One row per open paid game (escrow-linked, not the featured live event).
 */
export interface PaidGameSummary {
  code: string
  name: string
  game: TournamentGame
  /** Visual theme id, so lobby cards can echo the event's look. */
  theme: string | null
  status: TournamentStatus
  /** Per-player entry fee (6-decimal USDC units). */
  entryFeeUsdc: number | null
  /** Platform rake in basis points. */
  rakeBps: number | null
  /** Payout preset id ('wta' | 'top3' | 'top6' | 'top8'). */
  payoutPreset: string | null
  /** Locked post-rake split (basis points). */
  payoutBps: number[] | null
  /** Player cap for the game; null = unlimited up to the guard. */
  cap: number | null
  /** Confirmed (funded) deposit count so far. */
  fundedCount: number
  /** EVM chain id + escrow address so the client can wire the deposit tx. */
  chainId: number | null
  contractAddress: string | null
}

/**
 * Compact card shown in the public "Past events" archive. One row per
 * completed tournament, newest first. Contents only - no tokens.
 */
export interface CompletedTournamentSummary {
  code: string
  name: string
  format: TournamentFormat
  /** When the event was created (ISO); used as the archive date label. */
  createdAt: string
  /** Headcount of non-dropped, approved entrants. */
  playerCount: number
  /** The 1st-place finisher, when standings were locked; null otherwise. */
  champion: {
    xHandle: string
    displayName: string
    walletAddress: string | null
    username: string | null
    avatarUrl: string | null
    country: string | null
  } | null
}
