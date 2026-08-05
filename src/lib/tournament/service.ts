import 'server-only'
import { getServiceClient } from './supabase'
import {
  generateCode,
  generateToken,
  gamePrefix,
  hashToken,
  tokenMatchesHash,
} from './tokens'
import {
  rowToMatch,
  rowToPlayer,
  rowToProposal,
  rowToRound,
  rowToTournament,
} from './mappers'
import type { Hex } from 'viem'
import {
  isEscrowConfigured,
  escrowAddress,
  escrowChainId,
  getFundingStatus,
  getOnchainGame,
  EscrowGameState,
  verifyDeposit as verifyEscrowDeposit,
} from './escrow'
import {
  isOperatorConfigured,
  isOwnerKeyConfigured,
  isApproverConfigured,
  isApproverSameAsOperator,
  createGameOnchain,
  lockOnchain,
  settleOnchain,
  cancelGameOnchain,
  refundPlayerOnchain,
  approveWinnerOnchain,
  approveWinnersOnchain,
  pauseOnchain,
  unpauseOnchain,
  readLowGasSigners,
} from './escrow-write'
import type { Address } from 'viem'
import {
  PAYOUT_PRESETS,
  isPayoutPreset,
  payoutDepth,
  MAX_RAKE_BPS,
  DEFAULT_ENTRY_FEE_USDC,
  DEFAULT_RAKE_BPS,
  isReliabilityBlocked,
  type PayoutPreset,
} from './paid'
import { bumpReliability, getReliability, getReliabilityMany } from './reliability'
import {
  computeStandings,
  pairSingleElimFirstRound,
  pairSingleElimNext,
  pairSwiss,
  recommendedSwissRounds,
  type Pairing,
} from './pairing'
import type {
  CompletedTournamentSummary,
  CreateTournamentInput,
  CreateTournamentResult,
  EnrollResult,
  Match,
  Player,
  ReportedResult,
  Round,
  Tournament,
  TournamentFormat,
  TournamentGame,
  TournamentPrize,
  TournamentBadgeSlot,
  TournamentSnapshot,
  AwardedPrize,
  PaidGameSummary,
  PaidNeedsAttention,
  PaidDeckAudit,
  PaidDeckAuditEntry,
} from './types'
import { formatXLabel, isValidXHandle, normalizeXHandle } from './x-handle'
import { type Region, sanitizeRegion, regionShort } from './region'
import { validateDeckList } from './deck-list'
import { checkDeckList, type DeckCheck } from './deck-check'
import { extractLeader } from './leader'
import { TOURNAMENT_THEMES } from './theme'
import {
  emptyPollResults,
  isValidChoice,
  normalizePollConfig,
  POLL_OPTIONS,
  type PollOption,
  type PollResults,
} from './poll'

// ─────────────────────────────────────────────────────────────────────────
// Service layer: all tournament mutations + reads. Route handlers call these.
// Authorization (host token / player token) is enforced here, never in the UI.
// ─────────────────────────────────────────────────────────────────────────

/** How long a single-sided report waits for a dispute before auto-confirming. */
const CONFIRM_WINDOW_MINUTES = 120

/** Guard-rails so an open tool can't be trivially abused. */
const MAX_PLAYERS = 256
const MIN_PLAYERS_TO_START = 2

export class TournamentError extends Error {
  status: number
  constructor(message: string, status = 400) {
    super(message)
    this.name = 'TournamentError'
    this.status = status
  }
}

function nowIso(): string {
  return new Date().toISOString()
}

function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString()
}

/** A random 0x-prefixed 32-byte hex string, used as a paid game's escrow id. */
function randomBytes32Hex(): string {
  const arr = new Uint8Array(32)
  crypto.getRandomValues(arr)
  return '0x' + Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// ── Internal fetch helpers ───────────────────────────────────────────────--

async function fetchTournamentRowByCode(code: string) {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('tournaments')
    .select('*')
    .eq('code', code.toUpperCase())
    .maybeSingle()
  if (error) throw new TournamentError(error.message, 500)
  if (!data) throw new TournamentError('Tournament not found.', 404)
  return data
}

async function fetchPlayers(tournamentId: string): Promise<Player[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('created_at', { ascending: true })
  if (error) throw new TournamentError(error.message, 500)
  return (data ?? []).map(rowToPlayer)
}

async function fetchRounds(tournamentId: string): Promise<Round[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('rounds')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('number', { ascending: true })
  if (error) throw new TournamentError(error.message, 500)
  return (data ?? []).map(rowToRound)
}

async function fetchMatches(tournamentId: string): Promise<Match[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('matches')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('number', { ascending: true })
  if (error) throw new TournamentError(error.message, 500)
  return (data ?? []).map(rowToMatch)
}

// ── Create ─────────────────────────────────────────────────────────────────

export async function createTournament(
  input: CreateTournamentInput,
): Promise<CreateTournamentResult> {
  const sb = getServiceClient()
  const name = input.name?.trim()
  if (!name) throw new TournamentError('Tournament name is required.')
  if (!input.hostName?.trim()) throw new TournamentError('Host name is required.')

  const hostToken = generateToken()
  const prefix = gamePrefix(input.game)

  // Retry on the (very unlikely) code collision.
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode(prefix)
    const swissRounds =
      input.format === 'swiss'
        ? input.swissRounds && input.swissRounds > 0
          ? input.swissRounds
          : null // resolved at bracket generation from the field size
        : null
    const { data, error } = await sb
      .from('tournaments')
      .insert({
        code,
        name,
        game: input.game,
        format: input.format,
        status: 'enrolling',
        swiss_rounds: swissRounds,
        round_minutes: Math.max(15, input.roundMinutes || 1440),
        enroll_closes_at: input.enrollClosesAt ?? null,
        rules: input.rules?.trim() || null,
        contact_url: input.contactUrl?.trim() || null,
        host_token_hash: hashToken(hostToken),
      })
      .select('*')
      .single()
    if (!error && data) {
      // Auto-populate the new event from the waitlist (pending sign-ups).
      // Best-effort: never blocks creation. Dynamic import avoids a static
      // import cycle (waitlist.ts imports TournamentError from this module).
      const { convertWaitlistToTournament } = await import('./waitlist')
      await convertWaitlistToTournament(data.id, { maxPlayers: data.max_players ?? null })
      return { tournament: rowToTournament(data), hostToken }
    }
    lastErr = error
    // 23505 = unique_violation (code clash) → retry with a new code.
    if (error && (error as { code?: string }).code !== '23505') break
  }
  throw new TournamentError(
    `Could not create tournament: ${(lastErr as Error)?.message ?? 'unknown'}`,
    500,
  )
}

// ── Authorization ──────────────────────────────────────────────────────────

async function requireHost(code: string) {
  const row = await fetchTournamentRowByCode(code)
  return row
}

function assertHostToken(row: { host_token_hash: string }, token: string) {
  if (!tokenMatchesHash(token, row.host_token_hash)) {
    throw new TournamentError('Not authorized (invalid host token).', 403)
  }
}

async function fetchPlayerByToken(
  tournamentId: string,
  token: string,
): Promise<Player | null> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('player_token_hash', hashToken(token))
    .maybeSingle()
  if (error) throw new TournamentError(error.message, 500)
  return data ? rowToPlayer(data) : null
}

/**
 * Resolve a signed-in wallet to its player row in one event. Matches on the
 * wallet address first (set at enroll time), then falls back to the profile's
 * X handle so players who signed up before a wallet was linked can still
 * report. Returns the active (non-rejected) row.
 */
async function fetchPlayerByWalletOrHandle(
  tournamentId: string,
  walletAddress: string,
  xHandle: string | null,
): Promise<Player | null> {
  const sb = getServiceClient()
  const addr = walletAddress.toLowerCase()
  const { data: byWallet, error: walletErr } = await sb
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('wallet_address', addr)
    .neq('approval_status', 'rejected')
    .maybeSingle()
  if (walletErr) throw new TournamentError(walletErr.message, 500)
  if (byWallet) return rowToPlayer(byWallet)

  const handle = xHandle ? normalizeXHandle(xHandle) : ''
  if (!handle) return null
  const { data: byHandle, error: handleErr } = await sb
    .from('players')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('x_handle', handle)
    .neq('approval_status', 'rejected')
    .maybeSingle()
  if (handleErr) throw new TournamentError(handleErr.message, 500)
  return byHandle ? rowToPlayer(byHandle) : null
}

// ── Enroll ─────────────────────────────────────────────────────────────────

/**
 * Look up a wallet profile's saved region by X handle. Used as a fallback for
 * operator-seeded sign-ups that don't carry a region, so the roster still gets
 * a geo bucket when the player has a profile. Returns null when no profile /
 * region is on file. `limit(1)` guards against the rare duplicate-handle case.
 */
async function regionFromProfileByHandle(handle: string): Promise<Region | null> {
  if (!handle) return null
  const sb = getServiceClient()
  const { data } = await sb
    .from('wallet_profiles')
    .select('region')
    .eq('x_handle', handle)
    .limit(1)
  return sanitizeRegion(data?.[0]?.region)
}

export async function enroll(
  code: string,
  xHandleRaw: string,
  deckListRaw?: string | null,
  walletAddress?: string | null,
  region?: Region | null,
  joinPassword?: string,
  opts?: { bypassJoinGate?: boolean },
): Promise<EnrollResult> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError('Sign-ups are closed for this tournament.')
  }
  if (row.enroll_closes_at && new Date(row.enroll_closes_at) <= new Date()) {
    throw new TournamentError('The sign-up window has ended.')
  }

  // Optional per-tournament join code (a shared room passcode, like a Zoom
  // passcode - NOT a per-user password). When a non-empty join_password is set
  // on the row, the enroller must present the matching code. The stored value
  // is read directly from the row (server-side only) and never surfaced in any
  // public response. A trimmed string equality is fine here: this is a shared
  // room code, not a per-user secret, so a constant-time compare is not needed.
  // The trusted operator add-player path bypasses this gate (it is already
  // admin-secret-gated).
  if (!opts?.bypassJoinGate) {
    const storedJoin = typeof row.join_password === 'string' ? row.join_password.trim() : ''
    if (storedJoin !== '') {
      const provided = typeof joinPassword === 'string' ? joinPassword.trim() : ''
      if (!provided) {
        throw new TournamentError('This tournament needs a join code. Ask the organizer for it.')
      }
      if (provided !== storedJoin) {
        throw new TournamentError('That join code is not correct.')
      }
    }
  }

  const xHandle = normalizeXHandle(xHandleRaw)
  if (!isValidXHandle(xHandle)) {
    throw new TournamentError('Enter a valid X handle (letters, numbers, underscore - no @ needed).')
  }

  // Deck list is optional at the service boundary so operator-seeded walk-ins
  // (admin add-player) and waitlist conversions can come in without one and
  // submit it before the bracket locks. The public sign-up route requires it.
  let deckList: string | null = null
  if (deckListRaw != null && String(deckListRaw).trim() !== '') {
    const checked = validateDeckList(deckListRaw)
    if (!checked.ok) throw new TournamentError(checked.error)
    deckList = checked.value
  }

  const players = await fetchPlayers(row.id)
  const cap = row.max_players ?? MAX_PLAYERS
  const isPaid = Boolean(row.escrow_id)
  // Cap accounting differs by mode:
  //  - Free/featured (unchanged): every non-dropped, non-rejected sign-up
  //    occupies a slot, including pending ones.
  //  - Paid: ONLY approved seats occupy the cap. In an always-on, open paid
  //    lobby with approve-then-pay, a pending/unapproved applicant has not
  //    committed anything, so counting them would let spam pending sign-ups
  //    block real entrants. (Funded implies approved, so counting approved
  //    already covers funded seats.)
  const occupiesSlot = isPaid
    ? (p: (typeof players)[number]) => !p.dropped && p.approvalStatus === 'approved'
    : (p: (typeof players)[number]) => !p.dropped && p.approvalStatus !== 'rejected'
  if (players.filter(occupiesSlot).length >= cap) {
    throw new TournamentError('This tournament is full.')
  }
  if (players.some((p) => p.xHandle === xHandle && p.approvalStatus !== 'rejected')) {
    throw new TournamentError('That X handle is already registered.')
  }

  // Region is required at the public route, but operator-seeded walk-ins
  // (admin add-player) call in without one. Fall back to the wallet profile's
  // saved region (matched by handle) so those entries still get a geo bucket.
  let resolvedRegion = sanitizeRegion(region)
  if (!resolvedRegion) {
    resolvedRegion = await regionFromProfileByHandle(xHandle)
  }

  // PAID-only fairness gates (Decisions 2 + 4). Free/featured events are never
  // affected: both branches short-circuit unless this is an escrow-linked game.
  if (isPaid) {
    // Per-lobby region lock: an open lobby (lobby_region null) admits everyone;
    // a region-locked lobby only admits its region. Eligibility only, never a
    // win-determinant. sanitizeRegion(undefined) === null, so pre-migration
    // (no column) reads as open and this block is a no-op.
    const lobbyRegion = sanitizeRegion(row.lobby_region)
    if (lobbyRegion) {
      // One clear, consistent message for both the missing-region and
      // wrong-region cases, pointing at the on-screen picker (the enroll route
      // accepts the picker value directly).
      if (!resolvedRegion || resolvedRegion !== lobbyRegion) {
        throw new TournamentError(
          `This lobby is ${regionShort(lobbyRegion)}-only. Choose ${regionShort(lobbyRegion)} above (or set your profile region) to join.`,
        )
      }
    }

    // Soft reliability floor: block a clearly-serial no-show wallet from paid
    // lobbies. Best-effort - unknown / absent reliability NEVER blocks.
    if (walletAddress) {
      const reliability = await getReliability(walletAddress)
      if (isReliabilityBlocked(reliability)) {
        throw new TournamentError(
          'Your no-show record is too low to join paid lobbies right now.',
          403,
        )
      }
    }
  }

  const playerToken = generateToken()
  const label = formatXLabel(xHandle)
  const { data, error } = await sb
    .from('players')
    .insert({
      tournament_id: row.id,
      display_name: label,
      x_handle: xHandle,
      approval_status: 'pending',
      discord_handle: null,
      deck_list: deckList,
      wallet_address: walletAddress ? walletAddress.toLowerCase() : null,
      region: resolvedRegion,
      player_token_hash: hashToken(playerToken),
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new TournamentError(`Could not sign up: ${error?.message ?? 'unknown'}`, 500)
  }
  return { player: rowToPlayer(data), playerToken }
}

// ── Paid tournaments: deposit confirmation ─────────────────────────────────

/**
 * Confirm a player's on-chain USDC deposit for a paid tournament and flip their
 * `funded` flag so the bracket can seat them. Approve-then-pay: the entry must
 * already be approved. Idempotent - a repeat call on an already-funded player
 * returns the current row. The chain is the source of truth; we only READ it
 * here (see lib/tournament/escrow).
 */
export async function confirmDeposit(
  code: string,
  walletAddress: string,
  txHash: string,
): Promise<Player> {
  if (!isEscrowConfigured()) {
    throw new TournamentError('Paid tournaments are not enabled on this deployment.', 503)
  }
  const wallet = (walletAddress || '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new TournamentError('Connect a valid wallet.', 400)
  const tx = (txHash || '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{64}$/.test(tx)) {
    throw new TournamentError('Provide a valid transaction hash.', 400)
  }

  const row = await fetchTournamentRowByCode(code)
  const tournament = rowToTournament(row)
  if (!tournament.isPaid || !tournament.escrowId) {
    throw new TournamentError('This tournament does not require a deposit.', 400)
  }

  const player = await fetchPlayerByWalletOrHandle(tournament.id, wallet, null)
  if (!player) throw new TournamentError('Sign up for this tournament before depositing.', 404)
  if (player.approvalStatus !== 'approved') {
    throw new TournamentError('Your entry must be approved before you can deposit.', 409)
  }
  if (player.funded) return player // idempotent

  const verification = await verifyEscrowDeposit({
    escrowId: tournament.escrowId as Hex,
    wallet: wallet as Hex,
    txHash: tx as Hex,
  })
  if (!verification.ok) {
    throw new TournamentError(verification.reason ?? 'Deposit not confirmed yet.', 409)
  }
  if (tournament.entryFeeUsdc != null && verification.amount !== BigInt(tournament.entryFeeUsdc)) {
    throw new TournamentError('Deposit amount does not match the entry fee.', 409)
  }

  const sb = getServiceClient()
  const { data, error } = await sb
    .from('players')
    .update({
      funded: true,
      funded_at: nowIso(),
      deposit_tx: tx,
      deposit_block: Number(verification.blockNumber),
    })
    .eq('id', player.id)
    .select('*')
    .single()
  if (error || !data) throw new TournamentError('Could not record the deposit.', 500)
  return rowToPlayer(data)
}

/**
 * Auto-drop a player flagged as a no-show at a hard deadline: set `dropped` so
 * pairing skips them in every future round (this is what stops a ghost from
 * being a recurring free win), and mark `no_show = true` to distinguish it from
 * a clean/voluntary drop. BEST-EFFORT on the no_show marker: if that column is
 * absent (migration 021 not applied yet) the essential `dropped` write still
 * lands, so the auto-drop behavior degrades gracefully. Idempotent - setting an
 * already-dropped player's flags again is harmless.
 */
async function autoDropNoShow(
  sb: ReturnType<typeof getServiceClient>,
  tournamentId: string,
  playerId: string,
): Promise<void> {
  const { error } = await sb
    .from('players')
    .update({ dropped: true, no_show: true })
    .eq('id', playerId)
    .eq('tournament_id', tournamentId)
  if (error) {
    // Pre-migration fallback: no_show column missing. Still perform the drop,
    // which is the load-bearing half (pairing already skips dropped players).
    await sb
      .from('players')
      .update({ dropped: true })
      .eq('id', playerId)
      .eq('tournament_id', tournamentId)
  }
}

/**
 * Autopilot for paid games: at the HARD round deadline (no extensions), force-
 * resolve every unfinished match in the current round, drop the no-shows, bump
 * wallet reliability, then advance. This is what makes a started paid tournament
 * run itself end-to-end and is the core of the P1 fairness system.
 *
 * Resolution policy (see docs/future-build.md), designed so stalling never helps:
 *  - single-sided report -> the reporter's result stands (opponent ghosted). The
 *    non-reporting side is a NO-SHOW: auto-dropped, reliability no_show++.
 *  - neither reported     -> DOUBLE FORFEIT (both take a loss, no coin flip).
 *    BOTH sides are soft no-shows: auto-dropped, reliability double_forfeit++.
 *  - disputed (both reported, conflicting) -> left for the admin. This is the
 *    only thing that pauses autopilot; the round won't advance until resolved.
 *  - bye / confirmed -> never flagged.
 *
 * IDEMPOTENCY / CONCURRENCY (cron + multiple concurrent lazy-on-read page loads
 * can race): each match-resolution UPDATE is conditional on the match's PRIOR
 * status (`.eq('status', <prior>)`) and returns the affected row. Only the run
 * that actually performs the unresolved -> resolved transition (non-empty
 * result) drops the no-show and bumps reliability, so a match is resolved once,
 * counters are incremented exactly once, and the round advance / on-chain
 * settlement stay guarded downstream (maybeAdvance re-checks round completion;
 * settlement is guarded by the on-chain Locked -> Paid check). A wallet plays at
 * most one match per round and only the current round is enforced, so no wallet
 * is double-bumped.
 *
 * Scoped to paid (escrow-linked) tournaments only, so the featured-events flow
 * keeps its softer, extendable behavior. Pass `targetTournamentId` to enforce a
 * SINGLE tournament (lazy on-read); omit it for the full cron scan. Returns the
 * number of matches resolved.
 */
async function enforceRoundDeadlines(targetTournamentId?: string): Promise<number> {
  const sb = getServiceClient()
  let query = sb
    .from('tournaments')
    .select('*')
    .eq('status', 'running')
    .not('escrow_id', 'is', null)
  if (targetTournamentId) query = query.eq('id', targetTournamentId)
  const { data: tRows } = await query
  const nowMs = Date.now()
  const affected = new Set<string>()
  let resolved = 0

  for (const tr of tRows ?? []) {
    const tournament = rowToTournament(tr)
    const rounds = await fetchRounds(tournament.id)
    if (rounds.length === 0) continue
    const current = rounds[rounds.length - 1]
    if (current.status === 'complete') continue
    // Hard deadline: only act once the round's clock has fully elapsed.
    if (!current.endsAt || new Date(current.endsAt).getTime() > nowMs) continue

    const players = await fetchPlayers(tournament.id)
    const walletById = new Map(players.map((p) => [p.id, p.walletAddress]))
    const matches = (await fetchMatches(tournament.id)).filter((m) => m.roundId === current.id)
    for (const m of matches) {
      if (
        m.status === 'confirmed' ||
        m.status === 'bye' ||
        m.status === 'double_forfeit' ||
        m.status === 'disputed' // admin must settle; do not auto-resolve
      ) {
        continue
      }
      if (m.status === 'reported') {
        // Reporter showed up; the provisional winner_id was set at report time.
        // Conditional on status = 'reported' so only one racing run resolves it.
        const { data: upd } = await sb
          .from('matches')
          .update({ status: 'confirmed', resolved_at: nowIso() })
          .eq('id', m.id)
          .eq('status', 'reported')
          .select('id')
        if (!upd || upd.length === 0) continue // another run won the transition
        resolved++
        // Exactly one side reported. player1_report/player2_report presence
        // identifies the reporter. Only a claimed WIN by the reporter implies the
        // opponent ghosted: in that case the non-reporter is a genuine no-show and
        // is dropped + reliability-penalized. A lone 'loss' (a concession) or
        // 'draw' does NOT mean the non-reporter ghosted - the provisional
        // winner_id set at report time already made the non-reporter the winner,
        // so we must never drop or brand them. This mirrors the free-flow sweep,
        // which only auto-confirms a lone 'win'.
        const reporterIsP1 = m.player1Report != null
        const reporterId = reporterIsP1 ? m.player1Id : m.player2Id
        const otherId = reporterIsP1 ? m.player2Id : m.player1Id
        const reporterReport = reporterIsP1 ? m.player1Report : m.player2Report
        if (reporterReport === 'win') {
          // Reporter claims victory; opponent ghosted -> opponent is the no-show.
          if (otherId) await autoDropNoShow(sb, tournament.id, otherId)
          if (reporterId) {
            await bumpReliability(walletById.get(reporterId) ?? null, {
              matchesPlayed: 1,
              matchesOnTime: 1,
            })
          }
          if (otherId) {
            await bumpReliability(walletById.get(otherId) ?? null, {
              matchesPlayed: 1,
              noShows: 1,
            })
          }
        } else {
          // Concession ('loss') or 'draw': the non-reporter is NOT a no-show and
          // may in fact be the winner. Do not drop or penalize them. Reporter is
          // on-time; non-reporter is neutral (played, no on-time credit, no
          // no-show, no drop). Never penalize the winner.
          if (reporterId) {
            await bumpReliability(walletById.get(reporterId) ?? null, {
              matchesPlayed: 1,
              matchesOnTime: 1,
            })
          }
          if (otherId) {
            await bumpReliability(walletById.get(otherId) ?? null, {
              matchesPlayed: 1,
            })
          }
        }
      } else {
        // 'pending' - neither side reported: double forfeit (both lose, both are
        // soft no-shows). Conditional on status = 'pending' for the same reason.
        const { data: upd } = await sb
          .from('matches')
          .update({ status: 'double_forfeit', winner_id: null, resolved_at: nowIso() })
          .eq('id', m.id)
          .eq('status', 'pending')
          .select('id')
        if (!upd || upd.length === 0) continue
        resolved++
        if (m.player2Id) {
          await autoDropNoShow(sb, tournament.id, m.player1Id)
          await autoDropNoShow(sb, tournament.id, m.player2Id)
          await bumpReliability(walletById.get(m.player1Id) ?? null, {
            matchesPlayed: 1,
            doubleForfeits: 1,
          })
          await bumpReliability(walletById.get(m.player2Id) ?? null, {
            matchesPlayed: 1,
            doubleForfeits: 1,
          })
        }
      }
    }
    affected.add(tournament.id)
  }

  for (const id of affected) {
    try {
      await maybeAdvance(id)
    } catch {
      /* a lingering disputed match blocks advance; next sweep retries */
    }
  }
  return resolved
}

/**
 * List open paid games for the always-on lobby (/tournaments/paid). These are
 * escrow-linked tournaments that are NOT the featured live event: paid games
 * carry `escrow_id` and `is_live = false`, so this never surfaces (or depends
 * on) the single featured event at /tournaments. Newest first, with a live
 * funded-deposit count per game.
 */
export async function listOpenPaidGames(): Promise<PaidGameSummary[]> {
  const sb = getServiceClient()
  const { data: tRows, error } = await sb
    .from('tournaments')
    .select('*')
    .not('escrow_id', 'is', null)
    .in('status', ['enrolling', 'running'])
    .order('created_at', { ascending: false })
  if (error) throw new TournamentError(error.message, 500)

  const tournaments = (tRows ?? []).map(rowToTournament)
  if (tournaments.length === 0) return []

  // One query pulls every roster row for the listed games, then we tally the
  // three counts the lobby cards need in a single pass: applicants (the applied
  // phase), approved entrants (the funded-phase denominator), and funded
  // deposits (the funded-phase numerator).
  const ids = tournaments.map((t) => t.id)
  const applied = new Map<string, number>()
  const approved = new Map<string, number>()
  const funded = new Map<string, number>()
  const { data: pRows } = await sb
    .from('players')
    .select('tournament_id, approval_status, dropped, funded, refunded')
    .in('tournament_id', ids)
  for (const r of pRows ?? []) {
    const row = r as {
      tournament_id: string
      approval_status: string
      dropped: boolean
      funded: boolean
      refunded: boolean
    }
    if (row.dropped || row.approval_status === 'rejected') continue
    applied.set(row.tournament_id, (applied.get(row.tournament_id) ?? 0) + 1)
    if (row.approval_status === 'approved') {
      approved.set(row.tournament_id, (approved.get(row.tournament_id) ?? 0) + 1)
    }
    if (row.funded && !row.refunded) {
      funded.set(row.tournament_id, (funded.get(row.tournament_id) ?? 0) + 1)
    }
  }

  return tournaments.map((t) => ({
    code: t.code,
    name: t.name,
    game: t.game,
    theme: t.theme,
    status: t.status,
    entryFeeUsdc: t.entryFeeUsdc,
    rakeBps: t.rakeBps,
    payoutPreset: t.payoutPreset,
    payoutBps: t.payoutBps,
    cap: t.maxPlayers,
    lobbyRegion: t.lobbyRegion,
    appliedCount: applied.get(t.id) ?? 0,
    approvedCount: approved.get(t.id) ?? 0,
    fundedCount: funded.get(t.id) ?? 0,
    chainId: t.chainId,
    contractAddress: t.contractAddress,
  }))
}

/**
 * Wallet-scoped "needs your action" feed: paid games this wallet has a funded,
 * un-refunded seat in that have been CANCELLED (so the entry is refundable). It
 * powers the lobby's prompt that walks a player back to the withdraw button on
 * the game page after a cancel. Best-effort by design: any error (missing
 * columns pre-migration, flaky read) returns an empty list rather than throwing,
 * and the wallet is matched case-insensitively.
 */
export async function listRefundableStakesForWallet(
  wallet: string,
): Promise<{ code: string; name: string }[]> {
  const w = (wallet ?? '').trim().toLowerCase()
  if (!w) return []
  try {
    const sb = getServiceClient()
    const { data: tRows } = await sb
      .from('tournaments')
      .select('id, code, name')
      .not('escrow_id', 'is', null)
      .eq('status', 'cancelled')
    const cancelled = (tRows ?? []) as { id: string; code: string; name: string }[]
    if (cancelled.length === 0) return []
    const ids = cancelled.map((t) => t.id)
    const { data: pRows } = await sb
      .from('players')
      .select('tournament_id, wallet_address, funded, refunded')
      .in('tournament_id', ids)
      .eq('funded', true)
      .eq('refunded', false)
    const refundableIds = new Set<string>()
    for (const p of pRows ?? []) {
      const pr = p as { tournament_id: string; wallet_address: string | null }
      if ((pr.wallet_address ?? '').toLowerCase() === w) refundableIds.add(pr.tournament_id)
    }
    return cancelled
      .filter((t) => refundableIds.has(t.id))
      .map((t) => ({ code: t.code, name: t.name }))
  } catch {
    return []
  }
}

/**
 * Read-only reconcile pass (run in the cron sweep): re-read each funded/refunded
 * flag from the contract for active paid tournaments and repair the Supabase
 * mirror. Idempotent, chain-wins, never signs or moves money. Best-effort per
 * tournament so one bad RPC read can't stall the rest of the sweep.
 */
async function reconcilePaidFunding(): Promise<number> {
  if (!isEscrowConfigured()) return 0
  const sb = getServiceClient()
  const { data: tRows } = await sb
    .from('tournaments')
    .select('id, escrow_id, status')
    .not('escrow_id', 'is', null)
    .neq('status', 'complete')
    .neq('status', 'cancelled')
  let updated = 0
  for (const t of tRows ?? []) {
    const escrowId = (t as { escrow_id?: string }).escrow_id
    if (!escrowId) continue
    try {
      const { data: pRows } = await sb
        .from('players')
        .select('id, wallet_address, funded, refunded')
        .eq('tournament_id', (t as { id: string }).id)
        .not('wallet_address', 'is', null)
      for (const p of pRows ?? []) {
        const pr = p as { id: string; wallet_address: string; funded?: boolean; refunded?: boolean }
        const status = await getFundingStatus(escrowId as Hex, pr.wallet_address as Hex)
        const patch: Record<string, unknown> = {}
        if (status.funded !== Boolean(pr.funded)) {
          patch.funded = status.funded
          if (status.funded) patch.funded_at = nowIso()
        }
        if (status.refunded !== Boolean(pr.refunded)) patch.refunded = status.refunded
        if (Object.keys(patch).length > 0) {
          await sb.from('players').update(patch).eq('id', pr.id)
          updated++
        }
      }
    } catch {
      /* chain read failed; next sweep retries */
    }
  }
  return updated
}

/**
 * Autopilot payout retry: find COMPLETE paid games that are still `Locked`
 * on-chain (settle at completion failed, or a wallet got linked afterward) and
 * try to settle them again. Idempotent - `autoSettlePaid` re-checks on-chain
 * state and only acts when appropriate. No-op without the operator key.
 * Returns how many games were settled this pass.
 */
async function reconcilePaidSettlements(): Promise<number> {
  if (!isOperatorConfigured()) return 0
  const sb = getServiceClient()
  const { data: tRows } = await sb
    .from('tournaments')
    .select('id')
    .eq('status', 'complete')
    .not('escrow_id', 'is', null)
  let settled = 0
  for (const t of tRows ?? []) {
    const id = (t as { id: string }).id
    try {
      const [players, matches] = await Promise.all([fetchPlayers(id), fetchMatches(id)])
      // autoSettlePaid short-circuits unless the on-chain game is still Locked.
      if (await autoSettlePaid(id, players, matches)) settled++
    } catch {
      /* transient (RPC / not-ready); next sweep retries */
    }
  }
  return settled
}

// ── Bracket generation ───────────────────────────────────────────────────--

async function insertRoundWithMatches(
  tournament: Tournament,
  roundNumber: number,
  pairings: Pairing[],
): Promise<void> {
  const sb = getServiceClient()
  const startsAt = nowIso()
  const endsAt = addMinutes(startsAt, tournament.roundMinutes)
  const { data: roundRow, error: roundErr } = await sb
    .from('rounds')
    .insert({
      tournament_id: tournament.id,
      number: roundNumber,
      status: 'active',
      starts_at: startsAt,
      ends_at: endsAt,
    })
    .select('*')
    .single()
  if (roundErr || !roundRow) {
    throw new TournamentError(`Could not create round: ${roundErr?.message}`, 500)
  }

  const matchRows = pairings.map((p, i) => {
    const isBye = p[1] == null
    return {
      round_id: roundRow.id,
      tournament_id: tournament.id,
      number: i + 1,
      player1_id: p[0],
      player2_id: p[1],
      status: isBye ? 'bye' : 'pending',
      winner_id: isBye ? p[0] : null,
      resolved_at: isBye ? startsAt : null,
    }
  })
  if (matchRows.length > 0) {
    const { error: matchErr } = await sb.from('matches').insert(matchRows)
    if (matchErr) {
      throw new TournamentError(`Could not create matches: ${matchErr.message}`, 500)
    }
  }
}

/**
 * Close enrollment (host action or cron when the timer elapses) and generate
 * round 1. Seeds are randomized for fairness in the absence of ratings.
 */
export async function closeEnrollmentAndGenerate(
  code: string,
  hostToken: string,
): Promise<void> {
  const row = await requireHost(code)
  assertHostToken(row, hostToken)
  await generateFirstRound(row)
}

/** Internal: shared by host-close and cron-close. Expects a raw tournament row. */
async function generateFirstRound(row: {
  id: string
  code: string
  status: string
  format: string
  swiss_rounds: number | null
}): Promise<void> {
  const sb = getServiceClient()
  if (row.status !== 'enrolling') {
    throw new TournamentError('This tournament has already started.')
  }
  const tournament = rowToTournament(await fetchTournamentRowByCode(row.code))
  const players = await fetchPlayers(row.id)
  let active = players.filter((p) => !p.dropped && p.approvalStatus === 'approved')
  // Paid games only seat players who have actually funded the escrow. Enforced
  // only when the escrow is configured, so a paid game can still be QC'd end to
  // end before the contract is deployed (no chain -> no funded gate).
  if (tournament.isPaid && isEscrowConfigured()) {
    active = active.filter((p) => p.funded)
    if (active.length < MIN_PLAYERS_TO_START) {
      throw new TournamentError('Need at least 2 funded players to start this paid game.')
    }
  }
  if (active.length < MIN_PLAYERS_TO_START) {
    throw new TournamentError('Need at least 2 approved players to start.')
  }

  // Every player in the bracket must have a locked deck list. Block the start
  // (rather than silently dropping people) so the operator can chase the
  // stragglers - e.g. waitlist conversions who have not submitted theirs yet.
  const missingDecks = active.filter((p) => !p.deckList || p.deckList.trim() === '')
  if (missingDecks.length > 0) {
    const names = missingDecks.map((p) => formatXLabel(p.xHandle)).join(', ')
    throw new TournamentError(
      `These approved players still need to submit a deck list before the bracket can start: ${names}`,
    )
  }

  // Assign random seeds 1..N.
  const seeded = shuffle(active)
  for (let i = 0; i < seeded.length; i++) {
    await sb.from('players').update({ seed: i + 1 }).eq('id', seeded[i].id)
  }
  const seededPlayers = seeded.map((p, i) => ({ ...p, seed: i + 1 }))

  const swissRounds =
    row.format === 'swiss'
      ? row.swiss_rounds ?? recommendedSwissRounds(active.length)
      : null

  const pairings =
    row.format === 'swiss'
      ? pairSwiss(seededPlayers, [])
      : pairSingleElimFirstRound(seededPlayers)

  // Paid game: freeze the roster + payout on-chain before play starts. This
  // reverts (blocking the start) if the on-chain funded field is smaller than
  // the payout depth, keeping the contract and bracket in lockstep. No-op when
  // the operator key isn't configured.
  if (tournament.isPaid && isOperatorConfigured() && tournament.escrowId) {
    await lockOnchain(tournament.escrowId as `0x${string}`)
  }

  await sb
    .from('tournaments')
    .update({ status: 'running', swiss_rounds: swissRounds })
    .eq('id', row.id)

  await insertRoundWithMatches({ ...tournament, swissRounds }, 1, pairings)
}

// ── Reporting + resolution ──────────────────────────────────────────────--

function complementary(a: ReportedResult, b: ReportedResult): boolean {
  return (a === 'win' && b === 'loss') || (a === 'loss' && b === 'win') || (a === 'draw' && b === 'draw')
}

/** Resolve a match given both reports; sets winner + status. */
function resolveFromReports(
  match: Match,
  p1: ReportedResult | null,
  p2: ReportedResult | null,
): { status: Match['status']; winnerId: string | null; resolved: boolean } {
  if (p1 && p2) {
    if (complementary(p1, p2)) {
      const winnerId = p1 === 'win' ? match.player1Id : p1 === 'loss' ? match.player2Id : null
      return { status: 'confirmed', winnerId, resolved: true }
    }
    return { status: 'disputed', winnerId: null, resolved: false }
  }
  // single-sided → provisional, stays 'reported' until confirm window / cron
  const only = p1 ?? p2
  const reporterIsP1 = Boolean(p1)
  let winnerId: string | null = null
  if (only === 'win') winnerId = reporterIsP1 ? match.player1Id : match.player2Id
  else if (only === 'loss') winnerId = reporterIsP1 ? match.player2Id : match.player1Id
  return { status: 'reported', winnerId, resolved: false }
}

export async function reportResult(
  code: string,
  matchId: string,
  playerToken: string,
  result: ReportedResult,
): Promise<void> {
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByToken(row.id, playerToken)
  if (!player) throw new TournamentError('Not authorized (invalid player token).', 403)
  await applyReport(row, matchId, player, result)
}

/**
 * Wallet-backed match reporting. The route verifies the wallet session and
 * passes the signed-in wallet address plus the profile X handle. We resolve the
 * caller to their player row in this event by wallet address first, then fall
 * back to the X handle (covers players enrolled before a wallet was linked).
 * Same dual-confirmation resolution as the token path.
 */
export async function reportResultByWallet(
  code: string,
  matchId: string,
  walletAddress: string,
  xHandle: string | null,
  result: ReportedResult,
): Promise<void> {
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByWalletOrHandle(row.id, walletAddress, xHandle)
  if (!player) {
    throw new TournamentError('You are not signed up for this tournament.', 403)
  }
  await applyReport(row, matchId, player, result)
}

/**
 * Core dual-confirmation report logic shared by the token and wallet paths.
 * Both sides agree -> confirmed + auto-advance; conflict -> disputed (admin
 * review); single-sided -> provisional until the confirm window / cron sweep.
 */
async function applyReport(
  row: { id: string; format: Tournament['format'] },
  matchId: string,
  player: Player,
  result: ReportedResult,
): Promise<void> {
  const sb = getServiceClient()

  const { data: mRow, error } = await sb
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('tournament_id', row.id)
    .maybeSingle()
  if (error) throw new TournamentError(error.message, 500)
  if (!mRow) throw new TournamentError('Match not found.', 404)
  const match = rowToMatch(mRow)

  if (match.status === 'bye') throw new TournamentError('This match is a bye.')
  if (match.player1Id !== player.id && match.player2Id !== player.id) {
    throw new TournamentError('You are not a participant in this match.', 403)
  }
  if (match.status === 'confirmed') {
    throw new TournamentError('This match is already finalized.')
  }
  if (result === 'draw' && row.format === 'single-elim') {
    throw new TournamentError('Single elimination cannot end in a draw - pick a winner.')
  }

  const isP1 = match.player1Id === player.id
  const p1 = isP1 ? result : match.player1Report
  const p2 = isP1 ? match.player2Report : result

  const res = resolveFromReports(match, p1, p2)
  const update: Record<string, unknown> = {
    player1_report: p1,
    player2_report: p2,
    status: res.status,
    winner_id: res.winnerId,
    reported_at: match.reportedAt ?? nowIso(),
    resolved_at: res.resolved ? nowIso() : null,
  }
  const { error: upErr } = await sb.from('matches').update(update).eq('id', matchId)
  if (upErr) throw new TournamentError(upErr.message, 500)

  if (res.resolved) await maybeAdvance(row.id)
}

/**
 * Admin declares a match outcome (admin-secret flow; auth enforced at the
 * route). `result` is which slot won, or a draw (Swiss only). Setting the
 * final unresolved match in a round triggers `maybeAdvance`, which generates
 * the next round (Swiss re-pair / single-elim winners) or crowns a champion.
 * Re-callable to correct a mistake on the current round.
 */
export async function adminSetResult(
  code: string,
  matchId: string,
  result: 'p1' | 'p2' | 'draw',
): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'running') {
    throw new TournamentError('Results can only be set while the tournament is running.')
  }

  const { data: mRow, error } = await sb
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('tournament_id', row.id)
    .maybeSingle()
  if (error) throw new TournamentError(error.message, 500)
  if (!mRow) throw new TournamentError('Match not found.', 404)
  const match = rowToMatch(mRow)

  if (match.status === 'bye') throw new TournamentError('This match is a bye - nothing to report.')
  if (!match.player2Id) throw new TournamentError('This match has no opponent.')

  let winnerId: string | null
  if (result === 'draw') {
    if (row.format === 'single-elim') {
      throw new TournamentError('Single elimination cannot end in a draw - pick a winner.')
    }
    winnerId = null
  } else if (result === 'p1') {
    winnerId = match.player1Id
  } else if (result === 'p2') {
    winnerId = match.player2Id
  } else {
    throw new TournamentError('Invalid result.')
  }

  // Deliberately do NOT overwrite the players' self-reports here. Preserving the
  // original reports is what lets the UI tell an admin-settled match (reports
  // missing or conflicting) apart from one the players auto-confirmed between
  // themselves (matching reports). We only set the winner + confirmed status.
  const { error: upErr } = await sb
    .from('matches')
    .update({
      status: 'confirmed',
      winner_id: winnerId,
      reported_at: match.reportedAt ?? nowIso(),
      resolved_at: nowIso(),
    })
    .eq('id', matchId)
  if (upErr) throw new TournamentError(upErr.message, 500)

  await maybeAdvance(row.id)
}

/** Host override: force a result (winner id, or null for a draw). */
export async function hostOverrideMatch(
  code: string,
  hostToken: string,
  matchId: string,
  winnerId: string | null,
): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  assertHostToken(row, hostToken)
  const { error } = await sb
    .from('matches')
    .update({
      status: 'confirmed',
      winner_id: winnerId,
      resolved_at: nowIso(),
    })
    .eq('id', matchId)
    .eq('tournament_id', row.id)
  if (error) throw new TournamentError(error.message, 500)
  await maybeAdvance(row.id)
}

// ── Scheduling ─────────────────────────────────────────────────────────────

export async function proposeSchedule(
  code: string,
  matchId: string,
  playerToken: string,
  slots: string[],
): Promise<void> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByToken(row.id, playerToken)
  if (!player) throw new TournamentError('Not authorized (invalid player token).', 403)

  const clean = (slots ?? [])
    .map((s) => new Date(s))
    .filter((d) => !Number.isNaN(d.getTime()) && d.getTime() > Date.now() - 60_000)
    .map((d) => d.toISOString())
  if (clean.length === 0) throw new TournamentError('Propose at least one valid future time.')

  const { data: mRow } = await sb
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('tournament_id', row.id)
    .maybeSingle()
  if (!mRow) throw new TournamentError('Match not found.', 404)
  const match = rowToMatch(mRow)
  if (match.player1Id !== player.id && match.player2Id !== player.id) {
    throw new TournamentError('You are not a participant in this match.', 403)
  }

  // Supersede this player's previous open proposals on the match.
  await sb
    .from('schedule_proposals')
    .update({ status: 'superseded' })
    .eq('match_id', matchId)
    .eq('proposed_by_player_id', player.id)
    .eq('status', 'open')

  const { error } = await sb.from('schedule_proposals').insert({
    match_id: matchId,
    proposed_by_player_id: player.id,
    slots: clean,
    status: 'open',
  })
  if (error) throw new TournamentError(error.message, 500)
}

export async function acceptSchedule(
  code: string,
  matchId: string,
  playerToken: string,
  proposalId: string,
  slot: string,
): Promise<void> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByToken(row.id, playerToken)
  if (!player) throw new TournamentError('Not authorized (invalid player token).', 403)

  const { data: pRow } = await sb
    .from('schedule_proposals')
    .select('*')
    .eq('id', proposalId)
    .eq('match_id', matchId)
    .maybeSingle()
  if (!pRow) throw new TournamentError('Proposal not found.', 404)
  const proposal = rowToProposal(pRow)
  if (proposal.proposedByPlayerId === player.id) {
    throw new TournamentError('You can\u2019t accept your own proposed time.')
  }
  const when = new Date(slot)
  if (Number.isNaN(when.getTime()) || !proposal.slots.includes(when.toISOString())) {
    throw new TournamentError('That time is not one of the proposed slots.')
  }

  await sb
    .from('schedule_proposals')
    .update({ status: 'accepted', accepted_slot: when.toISOString() })
    .eq('id', proposalId)
  // Supersede all other open proposals on the match.
  await sb
    .from('schedule_proposals')
    .update({ status: 'superseded' })
    .eq('match_id', matchId)
    .eq('status', 'open')
  await sb.from('matches').update({ scheduled_at: when.toISOString() }).eq('id', matchId)
}

// ── Drop ─────────────────────────────────────────────────────────────────--

/**
 * Mark a player dropped and, if the event is live, forfeit any open match they
 * have in the current round so the round can still complete (the opponent
 * advances). Pairing already excludes dropped players from every future round.
 * Idempotent and safe to call repeatedly.
 */
async function applyDrop(row: { id: string; status: string }, playerId: string): Promise<void> {
  const sb = getServiceClient()
  // A clean/voluntary (or admin) drop is explicitly NOT a no-show, so we set
  // no_show = false so it never counts against reliability. Best-effort on that
  // column: if it's absent (pre-migration 021) fall back to the plain drop.
  const { error } = await sb
    .from('players')
    .update({ dropped: true, no_show: false })
    .eq('id', playerId)
    .eq('tournament_id', row.id)
  if (error) {
    await sb.from('players').update({ dropped: true }).eq('id', playerId).eq('tournament_id', row.id)
  }

  if (row.status !== 'running') return

  // Forfeit an unresolved match in the active round so it doesn't block the
  // round forever. The remaining player is recorded as the winner.
  const rounds = await fetchRounds(row.id)
  const active = rounds.find((r) => r.status === 'active')
  if (!active) return
  const matches = await fetchMatches(row.id)
  const open = matches.find(
    (m) =>
      m.roundId === active.id &&
      m.player2Id != null &&
      (m.player1Id === playerId || m.player2Id === playerId) &&
      m.status !== 'confirmed' &&
      m.status !== 'bye',
  )
  if (open) {
    const opponentId = open.player1Id === playerId ? open.player2Id : open.player1Id
    await sb
      .from('matches')
      .update({
        status: 'confirmed',
        winner_id: opponentId,
        // Clear any provisional self-reports so the result reads as a settled
        // forfeit rather than a contradictory player report.
        player1_report: null,
        player2_report: null,
        resolved_at: nowIso(),
      })
      .eq('id', open.id)
  }
  await maybeAdvance(row.id)
}

export async function dropSelf(code: string, playerToken: string): Promise<void> {
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByToken(row.id, playerToken)
  if (!player) throw new TournamentError('Not authorized (invalid player token).', 403)
  await applyDrop(row, player.id)
}

/** Wallet-backed self-drop, mirroring reportResultByWallet's identity lookup. */
export async function dropSelfByWallet(
  code: string,
  walletAddress: string,
  xHandle: string | null,
): Promise<void> {
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByWalletOrHandle(row.id, walletAddress, xHandle)
  if (!player) throw new TournamentError('You are not signed up for this tournament.', 403)
  await applyDrop(row, player.id)
}

export async function hostDropPlayer(
  code: string,
  hostToken: string,
  playerId: string,
): Promise<void> {
  const row = await requireHost(code)
  assertHostToken(row, hostToken)
  await applyDrop(row, playerId)
}

/** Admin-key authorized drop (the admin route guards this via assertAdmin). */
export async function adminDropPlayer(code: string, playerId: string): Promise<void> {
  const row = await requireHost(code)
  await applyDrop(row, playerId)
}

// ── Round advancement ──────────────────────────────────────────────────────

/** True when every match in the round is resolved (confirmed or bye). */
function roundFullyResolved(matches: Match[]): boolean {
  return (
    matches.length > 0 &&
    matches.every(
      (m) => m.status === 'confirmed' || m.status === 'bye' || m.status === 'double_forfeit',
    )
  )
}

/**
 * Persist each bracket player's final finishing position so wallet profiles can
 * show finalist badges later. Uses the same player set the live standings view
 * does (seeded + not rejected) and the same computeStandings ranking, so a
 * stored placement always matches what the bracket showed. Best-effort by
 * design: callers wrap this so a placement hiccup never blocks completion.
 */
async function persistFinalStandings(
  tournamentId: string,
  players: Player[],
  allMatches: Match[],
): Promise<void> {
  const sb = getServiceClient()
  const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
  if (inBracket.length === 0) return
  const standings = computeStandings(inBracket, allMatches)
  const total = standings.length
  await Promise.all(
    standings.map((row) =>
      sb
        .from('players')
        .update({ final_rank: row.rank, final_players: total })
        .eq('id', row.playerId),
    ),
  )
}

/**
 * Mark a tournament complete and record its final placements in one step.
 * Placement writes are best-effort: completion must succeed even if they fail.
 */
async function finalizeTournament(
  tournamentId: string,
  players: Player[],
  allMatches: Match[],
): Promise<void> {
  const sb = getServiceClient()
  await sb.from('tournaments').update({ status: 'complete' }).eq('id', tournamentId)
  try {
    await persistFinalStandings(tournamentId, players, allMatches)
  } catch {
    // Never block completion on a placement write.
  }
  try {
    await autoAwardPrizesOnComplete(tournamentId, players, allMatches)
  } catch {
    // Never block completion on a prize-award write.
  }
  try {
    await autoAwardBadgesOnComplete(tournamentId, players, allMatches)
  } catch {
    // Never block completion on a badge-award write.
  }
  try {
    await autoAwardParticipationBadgeOnComplete(tournamentId, players)
  } catch {
    // Never block completion on a participation-badge write.
  }
  try {
    await autoSettlePaid(tournamentId, players, allMatches)
  } catch {
    // Never block completion on an on-chain settle; the sweep retries it.
  }
}

/**
 * Resolve the ordered on-chain winner addresses for a paid game: the top
 * `depth` finishers by final Swiss standings, mapped to their funded wallet
 * addresses. Returns null if we can't build a clean, distinct list of exactly
 * `depth` wallets (e.g. a finalist never linked a wallet) so we never submit a
 * settle that would revert - the operator can settle manually in that case.
 */
function paidWinnerAddresses(
  tournament: Tournament,
  players: Player[],
  allMatches: Match[],
): Address[] | null {
  const payout = tournament.payoutBps ?? []
  const depth = payout.length
  if (depth === 0) return null
  const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
  const standings = computeStandings(inBracket, allMatches)
  if (standings.length < depth) return null

  // Deterministic-tiebreak safety valve. computeStandings orders dead-even
  // players by seed then wallet (stable, never random), which is fine when the
  // amounts are equal. But it must NEVER decide real money across a genuine
  // tie: if two players share a merit tieGroup yet sit on opposite sides of a
  // payout boundary (their forced ordering would pay them different amounts,
  // treating positions past `depth` as 0), we refuse to guess and hand it to a
  // manual settle. Adjacent-pair check suffices because tie groups are
  // contiguous in the standings.
  const payAt = (i: number) => (i < depth ? payout[i] : 0)
  for (let i = 0; i < depth; i++) {
    const cur = standings[i]
    const next = standings[i + 1]
    if (next && cur.tieGroup != null && cur.tieGroup === next.tieGroup && payAt(i) !== payAt(i + 1)) {
      return null
    }
  }

  const byId = new Map(players.map((p) => [p.id, p]))
  const seen = new Set<string>()
  const winners: Address[] = []
  for (let i = 0; i < depth; i++) {
    const p = byId.get(standings[i].playerId)
    const w = p?.walletAddress
    if (!w) return null
    const key = w.toLowerCase()
    if (seen.has(key)) return null
    seen.add(key)
    winners.push(w as Address)
  }
  return winners
}

/**
 * Autopilot payout: once a paid game is complete, submit the final placement
 * on-chain so the contract pays winners + rake. Idempotent + safe to retry:
 * only settles when the on-chain game is still `Locked` (never re-settles a
 * `Paid` game), and no-ops entirely when the operator key isn't configured.
 */
async function autoSettlePaid(
  tournamentId: string,
  players: Player[],
  allMatches: Match[],
): Promise<boolean> {
  if (!isOperatorConfigured()) return false
  const sb = getServiceClient()
  const { data: tRow } = await sb.from('tournaments').select('*').eq('id', tournamentId).maybeSingle()
  if (!tRow) return false
  const tournament = rowToTournament(tRow)
  if (!tournament.isPaid || !tournament.escrowId) return false

  const escrowId = tournament.escrowId as `0x${string}`
  const onchain = await getOnchainGame(escrowId)
  if (onchain.state !== EscrowGameState.Locked) return false // not ready, or already paid

  const winners = paidWinnerAddresses(tournament, players, allMatches)
  if (!winners) return false // can't build a clean winner list; leave for manual settle

  // Concurrency guard: two racing finalize/sweep runs can both observe `Locked`
  // above and both try to submit the settle tx. GUARANTEE: at most one settle tx
  // per escrow game is attempted per process. In-process single-flight skips the
  // duplicate attempt entirely; if a settle sneaks through on another process
  // (or the node has already advanced Locked -> Paid), settleGuarded swallows the
  // benign "already settled" revert so it is treated as success, not a noisy
  // throw. On-chain state remains the source of truth for correctness.
  if (settleInFlight.has(escrowId)) return false
  settleInFlight.add(escrowId)
  try {
    await settleGuarded(escrowId, winners)
  } finally {
    settleInFlight.delete(escrowId)
  }
  return true
}

// In-process single-flight set of escrow ids with a settle tx in progress.
const settleInFlight = new Set<string>()

/**
 * Wrap settleOnchain so a concurrent/duplicate settle that reverts because the
 * game already moved Locked -> Paid is treated as success (idempotent), while
 * any other error still surfaces. The on-chain Locked check is the real guard;
 * this just keeps a lost race from throwing a spurious error.
 */
async function settleGuarded(escrowId: `0x${string}`, winners: Address[]): Promise<void> {
  try {
    await settleOnchain(escrowId, winners)
  } catch (err) {
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase()
    const alreadySettled =
      msg.includes('already') ||
      msg.includes('not locked') ||
      msg.includes('locked') ||
      msg.includes('paid') ||
      msg.includes('invalidstate') ||
      msg.includes('invalid state') ||
      msg.includes('state')
    if (alreadySettled) return // benign: another run settled it first
    throw err
  }
}

// ── Paid-game admin escrow controls ─────────────────────────────────────────
//
// Human-driven levers for the person running the paid lobbies, all gated to
// paid (escrow-linked) games. The on-chain call always runs BEFORE the DB
// mirror flips so we never advertise a state the chain won't back. Each no-ops
// or errors cleanly when the operator key isn't configured.

/** Load a paid tournament by code, or throw a clear error if it isn't paid. */
async function requirePaidTournament(code: string): Promise<Tournament> {
  const row = await fetchTournamentRowByCode(code)
  const tournament = rowToTournament(row)
  if (!tournament.isPaid || !tournament.escrowId) {
    throw new TournamentError('This control is only for paid tournaments.', 400)
  }
  return tournament
}

/**
 * Stop-the-world for one paid game: cancel it on-chain (operator; valid while
 * Funding OR Locked) so every funded player can pull their entry back, then
 * flip the DB row to `cancelled` (drops it from the lobby + halts the
 * autopilot). Idempotent - if the chain game is already Cancelled/None we skip
 * the tx and still fix the mirror; a settled (Paid) game can't be cancelled.
 */
export async function adminCancelPaidGame(code: string): Promise<{ txHash: string | null }> {
  const tournament = await requirePaidTournament(code)
  const sb = getServiceClient()
  const escrowId = tournament.escrowId as Hex
  let txHash: string | null = null
  if (isOperatorConfigured()) {
    const onchain = await getOnchainGame(escrowId)
    if (onchain.state === EscrowGameState.Paid) {
      throw new TournamentError('Game is already settled on-chain; nothing to cancel.', 409)
    }
    if (onchain.state === EscrowGameState.Funding || onchain.state === EscrowGameState.Locked) {
      txHash = (await cancelGameOnchain(escrowId)) ?? null
    }
    // None (never created) or already Cancelled: no tx needed, just fix mirror.
  }
  await sb.from('tournaments').update({ status: 'cancelled' }).eq('id', tournament.id)
  return { txHash }
}

/**
 * Kick + refund one funded player before lock (operator). Credits their entry
 * back on-chain (they pull it with withdraw), then mirrors it: funded=false,
 * refunded=true, dropped=true so they leave the field. Only valid while the
 * game is still Funding on-chain; once locked, cancel the whole game instead.
 */
export async function adminRefundPlayer(
  code: string,
  playerId: string,
): Promise<{ txHash: string | null }> {
  const tournament = await requirePaidTournament(code)
  const sb = getServiceClient()
  const { data: pRow } = await sb
    .from('players')
    .select('*')
    .eq('id', playerId)
    .eq('tournament_id', tournament.id)
    .maybeSingle()
  if (!pRow) throw new TournamentError('Player not found in this game.', 404)
  const player = rowToPlayer(pRow)
  if (!player.walletAddress) {
    throw new TournamentError('Player has no linked wallet to refund.', 400)
  }
  const escrowId = tournament.escrowId as Hex
  let txHash: string | null = null
  if (isOperatorConfigured()) {
    const onchain = await getOnchainGame(escrowId)
    if (onchain.state !== EscrowGameState.Funding) {
      throw new TournamentError(
        'Can only refund a single player before the game locks. Cancel the game to refund everyone.',
        409,
      )
    }
    // Only spend gas if the chain still shows them funded and not yet refunded.
    const status = await getFundingStatus(escrowId, player.walletAddress as Hex)
    if (status.funded && !status.refunded) {
      txHash = (await refundPlayerOnchain(escrowId, player.walletAddress as Address)) ?? null
    }
  }
  await sb
    .from('players')
    .update({ funded: false, refunded: true, dropped: true })
    .eq('id', playerId)
  return { txHash }
}

/**
 * Manual settle escape hatch (operator): the admin reviews computed standings
 * and submits the final ordered winners (player ids, length == payout depth).
 * We map them to funded wallet addresses and settle on-chain, paying winners +
 * rake. Used when autoSettlePaid deferred (a genuine tie across a pay line) or
 * a winner linked a wallet late. The contract is the final gate: it reverts on
 * a non-funded / duplicate / wrong-count / not-Locked settle.
 */
export async function adminManualSettlePaid(
  code: string,
  orderedPlayerIds: string[],
): Promise<{ txHash: string }> {
  if (!isOperatorConfigured()) {
    throw new TournamentError('On-chain settle is not configured (missing operator key).', 503)
  }
  const tournament = await requirePaidTournament(code)
  const depth = tournament.payoutBps?.length ?? 0
  if (depth === 0) throw new TournamentError('This game has no on-chain payout to settle.', 400)
  if (!Array.isArray(orderedPlayerIds) || orderedPlayerIds.length !== depth) {
    throw new TournamentError(`Provide exactly ${depth} winners in placement order.`, 400)
  }
  const escrowId = tournament.escrowId as Hex
  const onchain = await getOnchainGame(escrowId)
  if (onchain.state !== EscrowGameState.Locked) {
    throw new TournamentError(
      onchain.state === EscrowGameState.Paid
        ? 'Game is already settled on-chain.'
        : 'Game must be locked (running) before it can be settled.',
      409,
    )
  }
  const players = await fetchPlayers(tournament.id)
  const byId = new Map(players.map((p) => [p.id, p]))
  const winners: Address[] = []
  const seen = new Set<string>()
  for (const pid of orderedPlayerIds) {
    const p = byId.get(pid)
    if (!p) throw new TournamentError('A selected winner is not in this game.', 400)
    if (!p.walletAddress) throw new TournamentError(`${p.displayName} has no linked wallet.`, 400)
    const key = p.walletAddress.toLowerCase()
    if (seen.has(key)) throw new TournamentError('Each winner must be a distinct wallet.', 400)
    seen.add(key)
    winners.push(p.walletAddress as Address)
  }
  const txHash = await settleOnchain(escrowId, winners)
  if (!txHash) throw new TournamentError('On-chain settle did not return a transaction.', 500)
  return { txHash }
}

/**
 * OPTIONAL global halt. pause()/unpause() are onlyOwner on the contract, so
 * this only works when the cold-ish TOURNAMENT_ESCROW_OWNER_KEY is configured.
 * Without it these throw 503 and the admin UI hides the control - per-game
 * cancel remains the primary stop lever.
 */
export async function adminPauseEscrow(): Promise<{ txHash: string }> {
  const txHash = await pauseOnchain()
  if (!txHash) {
    throw new TournamentError('Global pause is unavailable (no owner key configured).', 503)
  }
  return { txHash }
}

export async function adminUnpauseEscrow(): Promise<{ txHash: string }> {
  const txHash = await unpauseOnchain()
  if (!txHash) {
    throw new TournamentError('Global unpause is unavailable (no owner key configured).', 503)
  }
  return { txHash }
}

// ── Paid-game "needs attention" surface ─────────────────────────────────────

/**
 * Read-only signal for the paid admin console: what needs a human. Surfaces
 * disputed matches, complete-but-unsettled (still Locked) games, and
 * cancelled/refundable games. Best-effort on the on-chain reads so a flaky RPC
 * never breaks the panel.
 */
export async function adminPaidNeedsAttention(): Promise<PaidNeedsAttention> {
  const sb = getServiceClient()
  const result: PaidNeedsAttention = {
    ownerKeyConfigured: isOwnerKeyConfigured(),
    operatorConfigured: isOperatorConfigured(),
    // Winner-approval key health. Best-effort like the other key flags: a read
    // failure defaults to the safe/loud value so the payload never crashes.
    approverConfigured: false,
    approverSameAsOperator: false,
    disputes: [],
    settleStuck: [],
    cancelled: [],
    lowGas: [],
  }
  try {
    result.approverConfigured = isApproverConfigured()
    result.approverSameAsOperator = isApproverSameAsOperator()
  } catch {
    /* key read/derive failed; leave the safe defaults (approver "not configured") */
  }

  // Low-gas signal for the configured signer wallets. Best-effort: a failed
  // read just leaves lowGas empty and never breaks the panel.
  try {
    result.lowGas = await readLowGasSigners()
  } catch {
    /* balance read failed; omit the signal */
  }
  const { data: tRows } = await sb
    .from('tournaments')
    .select('*')
    .not('escrow_id', 'is', null)
    .in('status', ['running', 'complete', 'cancelled'])
  const tournaments = (tRows ?? []).map(rowToTournament)
  if (tournaments.length === 0) return result

  // Disputed matches across running paid games (single query).
  const runningIds = tournaments.filter((t) => t.status === 'running').map((t) => t.id)
  if (runningIds.length) {
    const { data: dRows } = await sb
      .from('matches')
      .select('tournament_id')
      .in('tournament_id', runningIds)
      .eq('status', 'disputed')
    const counts = new Map<string, number>()
    for (const m of dRows ?? []) {
      const id = (m as { tournament_id: string }).tournament_id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    for (const t of tournaments) {
      const c = counts.get(t.id) ?? 0
      if (c > 0) result.disputes.push({ code: t.code, name: t.name, count: c })
    }
  }

  // Cancelled / refundable games.
  for (const t of tournaments) {
    if (t.status === 'cancelled') {
      result.cancelled.push({ code: t.code, name: t.name, status: t.status })
    }
  }

  // Settle-stuck: complete off-chain but still Locked on-chain. Bounded on-chain
  // read per complete paid game; skipped when the escrow isn't configured.
  if (isEscrowConfigured()) {
    for (const t of tournaments) {
      if (t.status !== 'complete' || !t.escrowId) continue
      try {
        const onchain = await getOnchainGame(t.escrowId as Hex)
        if (onchain.state === EscrowGameState.Locked) {
          result.settleStuck.push({ code: t.code, name: t.name, status: t.status })
        }
      } catch {
        /* chain read failed; skip - the sweep also retries settles */
      }
    }
  }

  return result
}

// ── Awarded prizes (frozen at completion) ──────────────────────────────────

/** Row shape returned from the awarded-prizes table. */
function rowToAwardedPrize(r: Record<string, unknown>): AwardedPrize {
  return {
    id: r.id as string,
    slotIndex: Number(r.slot_index ?? 0),
    rank: r.rank == null ? null : Number(r.rank),
    title: (r.title as string) ?? '',
    description: (r.description as string) ?? '',
    image: (r.image as string | null) ?? null,
    playerId: (r.player_id as string | null) ?? null,
    walletAddress: (r.wallet_address as string | null) ?? null,
    xHandle: (r.x_handle as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    awardedAt: (r.awarded_at as string) ?? '',
  }
}

/**
 * All prizes handed out in one tournament, in slot order then placement order.
 * Resilient: if the awarded-prizes table is missing (migration 007 not yet
 * applied) it returns an empty list rather than throwing, so the snapshot still
 * loads.
 */
async function fetchAwardedPrizes(tournamentId: string): Promise<AwardedPrize[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('tournament_awarded_prizes')
    .select('*')
    .eq('tournament_id', tournamentId)
    .order('slot_index', { ascending: true })
    .order('rank', { ascending: true, nullsFirst: false })
  if (error) return []
  return (data ?? []).map((r) => rowToAwardedPrize(r as Record<string, unknown>))
}

/** One winner assigned to a prize slot. */
interface PrizeAssignment {
  slotIndex: number
  playerIds: string[]
}

/**
 * Replace the awarded-prize rows for a tournament from a set of assignments.
 * Each prize slot is SNAPSHOT (title/description/image) from the live pool and
 * copied onto every assigned winner, alongside that winner's identity + final
 * placement. Deletes then re-inserts so re-awarding is idempotent.
 */
async function persistAwardedPrizes(
  tournamentId: string,
  prizes: TournamentPrize[],
  assignments: PrizeAssignment[],
): Promise<number> {
  const sb = getServiceClient()

  // Gather the winners we need identity snapshots for, in one read.
  const allIds = Array.from(new Set(assignments.flatMap((a) => a.playerIds))).filter(Boolean)
  const byId = new Map<string, Record<string, unknown>>()
  if (allIds.length > 0) {
    const { data } = await sb
      .from('players')
      .select('id, display_name, x_handle, wallet_address, final_rank')
      .in('id', allIds)
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      byId.set(r.id as string, r)
    }
  }

  const rows: Record<string, unknown>[] = []
  for (const a of assignments) {
    const prize = prizes[a.slotIndex]
    if (!prize) continue
    for (const pid of a.playerIds) {
      const p = byId.get(pid)
      const wallet = (p?.wallet_address as string | null) ?? null
      rows.push({
        tournament_id: tournamentId,
        player_id: pid || null,
        wallet_address: wallet ? wallet.toLowerCase() : null,
        x_handle: (p?.x_handle as string | null) ?? null,
        display_name: (p?.display_name as string | null) ?? null,
        rank: p?.final_rank == null ? null : Number(p.final_rank),
        slot_index: a.slotIndex,
        title: prize.title,
        description: prize.description ?? '',
        image: prize.image ?? null,
      })
    }
  }

  // Re-award is destructive-then-rebuild: wipe this event's old rows first.
  const del = await sb.from('tournament_awarded_prizes').delete().eq('tournament_id', tournamentId)
  if (del.error) throw new TournamentError(del.error.message, 500)
  if (rows.length > 0) {
    const ins = await sb.from('tournament_awarded_prizes').insert(rows)
    if (ins.error) throw new TournamentError(ins.error.message, 500)
  }
  await sb.from('tournaments').update({ prizes_awarded_at: nowIso() }).eq('id', tournamentId)
  return rows.length
}

/**
 * Default prize -> winner mapping used when an event auto-finishes: slot i goes
 * to the i-th ranked finalist (slot 0 -> 1st place, slot 1 -> 2nd, ...). Only
 * runs if the event has prizes AND has not already been awarded, so a manual
 * admin re-award is never clobbered by a later sweep.
 */
async function autoAwardPrizesOnComplete(
  tournamentId: string,
  players: Player[],
  allMatches: Match[],
): Promise<void> {
  const sb = getServiceClient()
  const { data: tRow } = await sb
    .from('tournaments')
    .select('prizes, prizes_awarded_at')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tRow) return
  if (tRow.prizes_awarded_at) return // already resolved (manual award) - don't touch
  const prizes = rowToTournament({ ...tRow, prizes: tRow.prizes }).prizes
  if (prizes.length === 0) return

  const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
  const standings = computeStandings(inBracket, allMatches)

  // Never auto-award onto an unresolved tie: if any prize-winning position is
  // flagged `tied` (couldn't be separated on merit), leave prizes_awarded_at
  // null so the host resolves it with a tiebreaker and awards manually, instead
  // of the positional default handing a prize out on a non-merit fallback.
  const tieAffectsPrize = standings.some((row, i) => i < prizes.length && row.tied)
  if (tieAffectsPrize) return

  const assignments: PrizeAssignment[] = []
  prizes.forEach((_, i) => {
    const winner = standings[i]
    if (winner) assignments.push({ slotIndex: i, playerIds: [winner.playerId] })
  })
  if (assignments.length === 0) return
  await persistAwardedPrizes(tournamentId, prizes, assignments)
}

// ── Awarded badges (frozen at completion, one per placement) ────────────────

/**
 * Snapshot the badge pool onto its winners: badge slot i is copied onto the
 * i-th ranked finalist (slot 0 -> 1st, ...). Deletes-then-inserts so a re-award
 * is idempotent. Mirrors persistAwardedPrizes but each slot has exactly one
 * winner (its placement).
 */
async function persistAwardedBadges(
  tournamentId: string,
  badges: TournamentBadgeSlot[],
  winnersBySlot: { slotIndex: number; playerId: string }[],
): Promise<number> {
  const sb = getServiceClient()

  const ids = Array.from(new Set(winnersBySlot.map((w) => w.playerId))).filter(Boolean)
  const byId = new Map<string, Record<string, unknown>>()
  if (ids.length > 0) {
    const { data } = await sb
      .from('players')
      .select('id, display_name, x_handle, wallet_address, final_rank')
      .in('id', ids)
    for (const r of (data ?? []) as Record<string, unknown>[]) byId.set(r.id as string, r)
  }

  const rows: Record<string, unknown>[] = []
  for (const w of winnersBySlot) {
    const badge = badges[w.slotIndex]
    if (!badge) continue
    const p = byId.get(w.playerId)
    const wallet = (p?.wallet_address as string | null) ?? null
    rows.push({
      tournament_id: tournamentId,
      player_id: w.playerId || null,
      wallet_address: wallet ? wallet.toLowerCase() : null,
      x_handle: (p?.x_handle as string | null) ?? null,
      display_name: (p?.display_name as string | null) ?? null,
      rank: p?.final_rank == null ? null : Number(p.final_rank),
      slot_index: w.slotIndex,
      title: badge.title,
      description: badge.description ?? '',
      image: badge.image ?? null,
    })
  }

  // Scope to placement rows only (slot_index >= 0) so a re-award never wipes the
  // participation badge (which lives in the same table with slot_index = -1).
  const del = await sb
    .from('tournament_awarded_badges')
    .delete()
    .eq('tournament_id', tournamentId)
    .gte('slot_index', 0)
  if (del.error) throw new TournamentError(del.error.message, 500)
  if (rows.length > 0) {
    const ins = await sb.from('tournament_awarded_badges').insert(rows)
    if (ins.error) throw new TournamentError(ins.error.message, 500)
  }
  await sb.from('tournaments').update({ badges_awarded_at: nowIso() }).eq('id', tournamentId)
  return rows.length
}

// ── Participation badge (single, handed to every participant) ───────────────

/** Marker slot_index for participation-badge rows in tournament_awarded_badges. */
const PARTICIPATION_SLOT = -1

/**
 * A participant, for the purposes of the participation badge, is anyone who made
 * it into the bracket (`seed != null`) and wasn't rejected. Dropped players are
 * INCLUDED - they still took part in the event.
 */
function participationRecipients(players: Player[]): Player[] {
  return players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
}

/**
 * Hand the participation badge to every participant. Idempotent: clears the
 * tournament's participation rows (slot_index = -1) then re-inserts one per
 * recipient, snapshotting the badge art/title so later edits never rewrite
 * history. Stamps participation_badge_awarded_at. Returns the recipient count.
 */
async function persistParticipationBadge(
  tournamentId: string,
  badge: TournamentBadgeSlot,
  players: Player[],
): Promise<number> {
  const sb = getServiceClient()
  const recipients = participationRecipients(players)

  const rows = recipients.map((p) => ({
    tournament_id: tournamentId,
    player_id: p.id || null,
    wallet_address: p.walletAddress ? p.walletAddress.toLowerCase() : null,
    x_handle: p.xHandle || null,
    display_name: p.displayName || null,
    rank: null,
    slot_index: PARTICIPATION_SLOT,
    title: badge.title,
    description: badge.description ?? '',
    image: badge.image ?? null,
  }))

  const del = await sb
    .from('tournament_awarded_badges')
    .delete()
    .eq('tournament_id', tournamentId)
    .lt('slot_index', 0)
  if (del.error) throw new TournamentError(del.error.message, 500)
  if (rows.length > 0) {
    const ins = await sb.from('tournament_awarded_badges').insert(rows)
    if (ins.error) throw new TournamentError(ins.error.message, 500)
  }
  await sb
    .from('tournaments')
    .update({ participation_badge_awarded_at: nowIso() })
    .eq('id', tournamentId)
  return rows.length
}

/** Remove every participation-badge row for a tournament and clear the stamp. */
async function clearParticipationBadgeAwards(tournamentId: string): Promise<void> {
  const sb = getServiceClient()
  const del = await sb
    .from('tournament_awarded_badges')
    .delete()
    .eq('tournament_id', tournamentId)
    .lt('slot_index', 0)
  if (del.error) throw new TournamentError(del.error.message, 500)
  await sb
    .from('tournaments')
    .update({ participation_badge_awarded_at: null })
    .eq('id', tournamentId)
}

/**
 * On completion, hand the participation badge (if set) to every participant.
 * Guarded by participation_badge_awarded_at so it doesn't rewrite an award the
 * host already triggered by hand.
 */
async function autoAwardParticipationBadgeOnComplete(
  tournamentId: string,
  players: Player[],
): Promise<void> {
  const sb = getServiceClient()
  const { data: tRow } = await sb
    .from('tournaments')
    .select('participation_badge, participation_badge_awarded_at')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tRow) return
  if (tRow.participation_badge_awarded_at) return
  const badge = rowToTournament({ ...tRow, participation_badge: tRow.participation_badge })
    .participationBadge
  if (!badge) return
  await persistParticipationBadge(tournamentId, badge, players)
}

/**
 * On completion, hand each badge slot to the finalist at that placement (slot i
 * -> i-th ranked). Same guards as prizes: only if the event has badges and has
 * not already been awarded, and never onto an unresolved (merit) tie.
 */
async function autoAwardBadgesOnComplete(
  tournamentId: string,
  players: Player[],
  allMatches: Match[],
): Promise<void> {
  const sb = getServiceClient()
  const { data: tRow } = await sb
    .from('tournaments')
    .select('badges, badges_awarded_at')
    .eq('id', tournamentId)
    .maybeSingle()
  if (!tRow) return
  if (tRow.badges_awarded_at) return
  const badges = rowToTournament({ ...tRow, badges: tRow.badges }).badges
  if (badges.length === 0) return

  const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
  const standings = computeStandings(inBracket, allMatches)

  const tieAffectsBadge = standings.some((row, i) => i < badges.length && row.tied)
  if (tieAffectsBadge) return

  const winnersBySlot: { slotIndex: number; playerId: string }[] = []
  badges.forEach((_, i) => {
    const winner = standings[i]
    if (winner) winnersBySlot.push({ slotIndex: i, playerId: winner.playerId })
  })
  if (winnersBySlot.length === 0) return
  await persistAwardedBadges(tournamentId, badges, winnersBySlot)
}

/**
 * If the current (latest) round is fully resolved, mark it complete and either
 * generate the next round or finalize the tournament. Safe to call repeatedly.
 */
export async function maybeAdvance(tournamentId: string): Promise<void> {
  const sb = getServiceClient()
  const { data: tRow } = await sb.from('tournaments').select('*').eq('id', tournamentId).maybeSingle()
  if (!tRow) return
  const tournament = rowToTournament(tRow)
  if (tournament.status !== 'running') return

  const rounds = await fetchRounds(tournamentId)
  if (rounds.length === 0) return
  const current = rounds[rounds.length - 1]
  const allMatches = await fetchMatches(tournamentId)
  const roundMatches = allMatches.filter((m) => m.roundId === current.id)
  if (!roundFullyResolved(roundMatches)) return

  // Claim the round-advance as a single-flight. applyReport (the reporting
  // player), the deadline sweep, and lazy on-read enforcement can all call
  // maybeAdvance for the same finished round at once. The complete flip is
  // conditional on the round still being 'active' and returns the affected row,
  // so only ONE run proceeds to pair the next round. The losers exit here rather
  // than racing to insert a duplicate round N+1 (which would surface as a
  // spurious 500 to whichever player just reported). This only swallows the
  // benign already-advanced case; any real error still throws below.
  const { data: claimed } = await sb
    .from('rounds')
    .update({ status: 'complete' })
    .eq('id', current.id)
    .eq('status', 'active')
    .select('id')
  if (!claimed || claimed.length === 0) return // another run already advanced this round

  const players = await fetchPlayers(tournamentId)

  if (tournament.format === 'single-elim') {
    const next = pairSingleElimNext(roundMatches)
    if (!next || next.length === 0) {
      await finalizeTournament(tournamentId, players, allMatches)
      return
    }
    await insertRoundWithMatches(tournament, current.number + 1, next)
    return
  }

  // Swiss
  const totalRounds =
    tournament.swissRounds ??
    recommendedSwissRounds(
      players.filter((p) => !p.dropped && p.approvalStatus !== 'rejected').length,
    )
  if (current.number >= totalRounds) {
    await finalizeTournament(tournamentId, players, allMatches)
    return
  }
  const next = pairSwiss(players, allMatches)
  if (next.length === 0) {
    await finalizeTournament(tournamentId, players, allMatches)
    return
  }
  await insertRoundWithMatches(tournament, current.number + 1, next)
}

/**
 * Backfill final placements for every completed tournament. Idempotent: it just
 * recomputes standings and overwrites final_rank, so it is safe to run anytime
 * (used once after the placements migration to seed pre-existing events).
 * Returns how many tournaments were processed.
 */
export async function recomputeAllPlacements(): Promise<number> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('tournaments')
    .select('id')
    .eq('status', 'complete')
  if (error) throw new TournamentError(error.message, 500)
  const ids = (data ?? []).map((r) => r.id as string)
  for (const id of ids) {
    const [players, matches] = await Promise.all([fetchPlayers(id), fetchMatches(id)])
    await persistFinalStandings(id, players, matches)
  }
  return ids.length
}

// ── Prize-distribution poll ────────────────────────────────────────────────

/**
 * Aggregate poll tallies for one tournament. Resilient by design: if the
 * `poll_votes` table hasn't been created yet (migration not run), it returns
 * an empty result instead of throwing, so the rest of the snapshot still
 * loads. Votes are scoped to `tournament_id`, so a new tournament starts the
 * poll fresh with no extra work.
 */
async function fetchPollResults(
  tournamentId: string,
  options: PollOption[] = POLL_OPTIONS,
): Promise<PollResults> {
  const results = emptyPollResults(options)
  try {
    const sb = getServiceClient()
    const { data, error } = await sb
      .from('poll_votes')
      .select('choice')
      .eq('tournament_id', tournamentId)
    if (error || !data) return results
    for (const r of data) {
      const choice = (r as { choice?: string }).choice
      if (choice && choice in results.counts) {
        results.counts[choice] += 1
        results.totalVotes += 1
      }
    }
  } catch {
    /* table missing or transient error → empty poll, never break the page */
  }
  return results
}

/**
 * Record one vote for the live tournament. Phase C (per-browser): the caller
 * passes a random per-browser `voterId`; a unique (tournament_id, voter_id)
 * constraint enforces one vote per browser per event. Switching to secure
 * per-player tokens later means resolving the token to a player here and
 * using the player id as the voter id; the rest stays identical.
 */
export async function castPollVote(
  voterIdRaw: string,
  choice: string,
): Promise<PollResults> {
  const voterId = (voterIdRaw ?? '').trim()
  if (!voterId || voterId.length > 128) {
    throw new TournamentError('Could not identify your browser - try refreshing.')
  }
  const row = await getLiveTournamentRow()
  // Validate the choice against THIS event's ballot (custom or default).
  const options = rowToTournament(row).pollOptions ?? POLL_OPTIONS
  if (!isValidChoice(options, choice)) {
    throw new TournamentError('Pick one of the available options.')
  }
  if (row.poll_open === false) {
    throw new TournamentError('Voting for this poll has closed.', 403)
  }
  const sb = getServiceClient()
  const { error } = await sb
    .from('poll_votes')
    .insert({ tournament_id: row.id, voter_id: voterId, choice })
  if (error) {
    // 23505 = unique_violation → this browser already voted in this poll.
    if ((error as { code?: string }).code === '23505') {
      throw new TournamentError('You have already voted in this poll.', 409)
    }
    throw new TournamentError(`Could not record your vote: ${error.message}`, 500)
  }
  return fetchPollResults(row.id, options)
}

/**
 * Replace the live/active event's poll question + ballot. Host-only. Options
 * are validated + slugged in `normalizePollConfig`; changing the ballot does
 * not delete past votes (they simply stop being counted once their option id
 * is gone), so reuse ids only when you intend to keep a running tally.
 */
export async function adminSetPollConfig(
  code: string,
  question: unknown,
  options: unknown,
): Promise<{ count: number }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  let normalized: { question: string; options: PollOption[] }
  try {
    normalized = normalizePollConfig(question, options)
  } catch (e) {
    throw new TournamentError(e instanceof Error ? e.message : 'Invalid poll configuration.')
  }
  const { error } = await sb
    .from('tournaments')
    .update({ poll_question: normalized.question, poll_options: normalized.options })
    .eq('id', row.id)
  if (error) throw new TournamentError(`Could not update the poll: ${error.message}`, 500)
  return { count: normalized.options.length }
}

/**
 * Start a FRESH poll on the live/active event: apply the given question +
 * ballot, wipe every existing vote for this tournament, and (re)open voting.
 * Unlike adminSetPollConfig - which preserves a kept option's running tally -
 * this guarantees a clean slate, so the host can change the poll at any time
 * without prior votes carrying over. Host-only.
 */
export async function adminResetPoll(
  code: string,
  question: unknown,
  options: unknown,
): Promise<{ count: number }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  let normalized: { question: string; options: PollOption[] }
  try {
    normalized = normalizePollConfig(question, options)
  } catch (e) {
    throw new TournamentError(e instanceof Error ? e.message : 'Invalid poll configuration.')
  }
  const { error } = await sb
    .from('tournaments')
    .update({
      poll_question: normalized.question,
      poll_options: normalized.options,
      poll_open: true,
    })
    .eq('id', row.id)
  if (error) throw new TournamentError(`Could not start a new poll: ${error.message}`, 500)

  // Clear prior votes so tallies start at zero. Best-effort: a missing
  // poll_votes table (migration not run) just means there's nothing to clear.
  const { error: delErr } = await sb.from('poll_votes').delete().eq('tournament_id', row.id)
  if (delErr && (delErr as { code?: string }).code !== '42P01') {
    throw new TournamentError(`Could not clear prior votes: ${delErr.message}`, 500)
  }
  return { count: normalized.options.length }
}

/**
 * Set the public page theme for an event (host-only). Requires a registered
 * theme id. Unknown ids are rejected so a typo can't silently break the page.
 */
export async function adminSetTheme(code: string, theme: unknown): Promise<{ theme: string }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (typeof theme !== 'string' || !TOURNAMENT_THEMES[theme]) {
    throw new TournamentError('Unknown theme.', 400)
  }
  const { error } = await sb.from('tournaments').update({ theme }).eq('id', row.id)
  if (error) throw new TournamentError(`Could not update the theme: ${error.message}`, 500)
  return { theme }
}

// ── Snapshot (public read) ──────────────────────────────────────────────--

/**
 * Resolve each player's display identity (username + avatar) from the linked
 * wallet profile, so the public bracket / standings / roster can render the
 * leaderboard-style "avatar + username" (falling back to the handle). Matches
 * on wallet address first, then X handle. Best-effort: any miss or query error
 * simply leaves username/avatar undefined and the UI falls back to the handle.
 */
async function attachProfileIdentity(
  sb: ReturnType<typeof getServiceClient>,
  players: Player[],
): Promise<Player[]> {
  try {
    const addrs = [
      ...new Set(
        players.map((p) => p.walletAddress?.toLowerCase()).filter((a): a is string => !!a),
      ),
    ]
    const handles = [
      ...new Set(players.map((p) => p.xHandle?.toLowerCase()).filter((h): h is string => !!h)),
    ]
    if (addrs.length === 0 && handles.length === 0) return players

    type Ident = { username: string | null; avatarUrl: string | null; country: string | null }
    const byWallet = new Map<string, Ident>()
    const byHandle = new Map<string, Ident>()
    const ingest = (rows: Record<string, unknown>[] | null) => {
      for (const r of rows ?? []) {
        const rec: Ident = {
          username: (r.username as string | null) ?? null,
          avatarUrl: (r.avatar_url as string | null) ?? null,
          country: (r.country as string | null) ?? null,
        }
        const w = r.wallet_address as string | null
        const h = r.x_handle as string | null
        if (w) byWallet.set(w.toLowerCase(), rec)
        if (h) byHandle.set(h.toLowerCase(), rec)
      }
    }
    // Select with `country`, but fall back to the base columns if that column
    // doesn't exist yet (deploy landed before migration 013). This keeps
    // username/avatar enrichment working during the migration window.
    const cols = 'wallet_address, username, x_handle, avatar_url, country'
    const baseCols = 'wallet_address, username, x_handle, avatar_url'
    const selectProfiles = async (column: 'wallet_address' | 'x_handle', values: string[]) => {
      const withCountry = await sb.from('wallet_profiles').select(cols).in(column, values)
      if (!withCountry.error) return withCountry.data as Record<string, unknown>[] | null
      const base = await sb.from('wallet_profiles').select(baseCols).in(column, values)
      return base.data as Record<string, unknown>[] | null
    }
    if (addrs.length) ingest(await selectProfiles('wallet_address', addrs))
    if (handles.length) ingest(await selectProfiles('x_handle', handles))

    return players.map((p) => {
      const rec =
        (p.walletAddress && byWallet.get(p.walletAddress.toLowerCase())) ||
        (p.xHandle && byHandle.get(p.xHandle.toLowerCase())) ||
        null
      return rec
        ? { ...p, username: rec.username, avatarUrl: rec.avatarUrl, country: rec.country }
        : p
    })
  } catch {
    return players
  }
}

/**
 * Attach cross-tournament wallet reliability (score + lifetime no-show count) to
 * each player, looked up by wallet in one batched query. PAID snapshots only -
 * skipped entirely for free events to avoid the extra round-trip. Best-effort:
 * a missing table / failed lookup just leaves the fields undefined (neutral).
 */
async function attachReliability(players: Player[]): Promise<Player[]> {
  const rel = await getReliabilityMany(players.map((p) => p.walletAddress))
  if (rel.size === 0) return players
  return players.map((p) => {
    const r = p.walletAddress ? rel.get(p.walletAddress.toLowerCase()) : undefined
    return r ? { ...p, reliabilityScore: r.score, noShowCount: r.noShows } : p
  })
}

// Last lazy-enforcement epoch ms per tournament id (in-process throttle). Keeps
// a burst of concurrent page loads from each running a full deadline sweep.
const lastLazyEnforce = new Map<string, number>()
const LAZY_ENFORCE_WINDOW_MS = 5000

export async function getSnapshotByCode(code: string): Promise<TournamentSnapshot> {
  const row = await fetchTournamentRowByCode(code)
  const tournament = rowToTournament(row)

  // Lazy on-read enforcement (live paid events): players are actively loading
  // the page, so if this is a running PAID tournament whose current round is
  // past its hard deadline, opportunistically resolve it BEFORE we read the
  // bracket - that advances an active event near-instantly regardless of cron.
  // Wrapped so a failure never breaks the snapshot read; the single-tournament
  // enforcement is idempotent + concurrency-safe (see enforceRoundDeadlines).
  if (tournament.isPaid && tournament.status === 'running') {
    try {
      // Single-flight throttle: many concurrent page loads for a live event would
      // otherwise each await a full enforceRoundDeadlines pass. Skip re-running
      // within a small window per tournament; cron and later reads still cover
      // any gap. Best-effort only - never blocks or breaks the read.
      const lastRun = lastLazyEnforce.get(tournament.id) ?? 0
      if (Date.now() - lastRun >= LAZY_ENFORCE_WINDOW_MS) {
        const preRounds = await fetchRounds(tournament.id)
        const current = preRounds[preRounds.length - 1]
        const due =
          current &&
          current.status !== 'complete' &&
          current.endsAt != null &&
          new Date(current.endsAt).getTime() <= Date.now()
        if (due) {
          lastLazyEnforce.set(tournament.id, Date.now())
          await enforceRoundDeadlines(tournament.id)
        }
      }
    } catch {
      /* enforcement hiccup must never block a public read; cron will catch up */
    }
  }

  // Fetch AFTER any enforcement so the returned snapshot reflects the advance.
  const [players, rounds, matches, poll, awardedPrizes] = await Promise.all([
    fetchPlayers(tournament.id),
    fetchRounds(tournament.id),
    fetchMatches(tournament.id),
    fetchPollResults(tournament.id, tournament.pollOptions ?? POLL_OPTIONS),
    fetchAwardedPrizes(tournament.id),
  ])
  const sb = getServiceClient()
  const matchIds = matches.map((m) => m.id)
  let proposals: ReturnType<typeof rowToProposal>[] = []
  if (matchIds.length > 0) {
    const { data } = await sb
      .from('schedule_proposals')
      .select('*')
      .in('match_id', matchIds)
      .order('created_at', { ascending: true })
    proposals = (data ?? []).map(rowToProposal)
  }
  const standings = computeStandings(players, matches)
  // Leader reveal: resolve each player's Leader card from their (private) deck
  // list. The Leader is public ONCE PLAY BEGINS (it sits face-up on the table
  // and the metagame is tracked by it), so revealing it then never leaks the
  // hidden 50-card list.
  //
  // But WHILE SIGN-UPS ARE OPEN the leader must stay hidden. The snapshot is
  // served by unauthenticated, cached endpoints, so exposing leaders during
  // `enrolling` would let a late registrant scout the field and pick a counter-
  // leader before committing - an unfair information edge. So we only surface
  // leaders once the tournament is `running` (bracket drawn) or `complete`.
  //
  // Deck contents themselves are private WHILE the event runs (host + the
  // owning player only): the snapshot is public and cached, so stripping the
  // text keeps opponents from pre-match meta-gaming. Standard tournament
  // etiquette is closed lists during play, published once the event concludes
  // - so once the tournament is `complete` we expose the full lists as a
  // public metagame archive. `hasDeckList` signals submitted/missing in any
  // phase.
  const decksPublic = tournament.status === 'complete'
  const leadersPublic =
    tournament.status === 'running' || tournament.status === 'complete'
  const withLeader = (p: Player): Player => {
    const leader = leadersPublic ? extractLeader(p.deckList) : null
    return {
      ...p,
      leaderCardId: leader?.id ?? null,
      leaderName: leader?.name ?? null,
      leaderImage: leader?.image ?? null,
    }
  }
  const publicPlayers = players.map((p) => {
    const enriched = withLeader(p)
    if (decksPublic) return enriched
    return enriched.deckList == null ? enriched : { ...enriched, deckList: null }
  })
  const playersWithIdentity = await attachProfileIdentity(sb, publicPlayers)
  // Reliability is a PAID-only enrichment (surfaced in the paid admin approval
  // queue). Free events skip the lookup entirely.
  const playersFinal = tournament.isPaid
    ? await attachReliability(playersWithIdentity)
    : playersWithIdentity
  return {
    tournament,
    players: playersFinal,
    rounds,
    matches,
    proposals,
    standings,
    poll,
    awardedPrizes,
  }
}

// ── Public deck audit (paid games) ─────────────────────────────────────────

/**
 * Read-only, UNAUTHENTICATED deck-audit payload for a PAID tournament. Lists
 * every competitor with their identity, final result, and (once revealed) their
 * registered decklist so anyone can compare the committed list against a match
 * replay. Two hard guarantees:
 *
 *   1. PAID-ONLY. If the tournament is free/featured (no escrow link) this
 *      throws a 404, so free-event decks can NEVER leak through this endpoint.
 *   2. GATED REVEAL. Deck contents are attached only when `decksPublic` is true.
 *      Before then every entry's `deckList` is null and the UI shows the
 *      "revealed when this event concludes" message.
 */
export async function getPaidDeckAudit(code: string): Promise<PaidDeckAudit> {
  const row = await fetchTournamentRowByCode(code)
  const tournament = rowToTournament(row)

  // PAID-ONLY gate: never expose this surface for free/featured events.
  if (!tournament.isPaid) {
    throw new TournamentError('Deck audit is only available for paid games.', 404)
  }

  // ───────────────────────────────────────────────────────────────────────
  // THE REVEAL GATE. Decklists are public ONLY once the event has concluded.
  // Flip this single line to `true` (or to `tournament.status !== 'enrolling'`,
  // etc.) to change when decks are revealed - e.g. reveal-at-start. Nothing
  // else in this file gates deck visibility for the audit view.
  const decksPublic = tournament.status === 'complete'
  // ───────────────────────────────────────────────────────────────────────

  const [players, matches] = await Promise.all([
    fetchPlayers(tournament.id),
    fetchMatches(tournament.id),
  ])

  // Only real competitors: approved, non-rejected sign-ups. Leaders are public
  // once play has begun (running/complete), matching the main snapshot rule.
  const competitors = players.filter((p) => p.approvalStatus === 'approved')
  const leadersPublic = tournament.status === 'running' || tournament.status === 'complete'
  const standings = computeStandings(competitors, matches)
  const standingById = new Map(standings.map((s) => [s.playerId, s]))

  const sb = getServiceClient()
  const withIdentity = await attachProfileIdentity(sb, competitors)

  const entries: PaidDeckAuditEntry[] = withIdentity.map((p) => {
    const leader = leadersPublic ? extractLeader(p.deckList) : null
    const st = standingById.get(p.id)
    return {
      playerId: p.id,
      xHandle: p.xHandle,
      displayName: p.displayName,
      username: p.username ?? null,
      avatarUrl: p.avatarUrl ?? null,
      country: p.country ?? null,
      walletAddress: p.walletAddress,
      rank: tournament.status === 'complete' && st ? st.rank : null,
      wins: st?.wins ?? 0,
      losses: st?.losses ?? 0,
      draws: st?.draws ?? 0,
      dropped: p.dropped,
      leaderName: leader?.name ?? null,
      leaderImage: leader?.image ?? null,
      hasDeckList: p.hasDeckList,
      // Contents attached ONLY behind the reveal gate.
      deckList: decksPublic ? p.deckList : null,
    }
  })

  // Stable, meaningful order: final placing once complete, else handle A→Z.
  entries.sort((a, b) => {
    if (a.rank != null && b.rank != null) return a.rank - b.rank
    if (a.rank != null) return -1
    if (b.rank != null) return 1
    return a.xHandle.localeCompare(b.xHandle)
  })

  return {
    code: tournament.code,
    name: tournament.name,
    game: tournament.game,
    status: tournament.status,
    theme: tournament.theme,
    decksPublic,
    entries,
  }
}

// ── Dispute battle-log evidence (any tournament) ───────────────────────────

/**
 * Attach an OPTCG Sim battle log (a URL and/or pasted text) to a DISPUTED
 * match, as evidence for the organizer to read before settling the winner.
 * Available for ANY tournament (paid or free/featured). Gated hard on three
 * things that must always hold: only a PARTICIPANT of the match, only while the
 * match is 'disputed', and the same URL-scheme + length validation. Resolves
 * the caller by wallet address first, then X handle, the same as match
 * reporting.
 */
export async function attachDisputeLog(
  code: string,
  matchId: string,
  walletAddress: string,
  xHandle: string | null,
  input: { url?: string | null; text?: string | null },
): Promise<void> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)

  const player = await fetchPlayerByWalletOrHandle(row.id, walletAddress, xHandle)
  if (!player) {
    throw new TournamentError('You are not signed up for this tournament.', 403)
  }

  const { data: mRow, error } = await sb
    .from('matches')
    .select('*')
    .eq('id', matchId)
    .eq('tournament_id', row.id)
    .maybeSingle()
  if (error) throw new TournamentError(error.message, 500)
  if (!mRow) throw new TournamentError('Match not found.', 404)
  const match = rowToMatch(mRow)

  if (match.player1Id !== player.id && match.player2Id !== player.id) {
    throw new TournamentError('You are not a participant in this match.', 403)
  }
  if (match.status !== 'disputed') {
    throw new TournamentError('You can only attach a battle log to a disputed match.', 409)
  }

  const url = typeof input.url === 'string' ? input.url.trim() : ''
  const text = typeof input.text === 'string' ? input.text.trim() : ''
  if (!url && !text) {
    throw new TournamentError('Add a battle-log link or paste the log text.', 422)
  }
  if (url && !/^https?:\/\//i.test(url)) {
    throw new TournamentError('The battle-log link must start with http:// or https://', 422)
  }
  // Keep the pasted text bounded so a paste can't bloat the row.
  const MAX_LOG_CHARS = 20000
  if (text.length > MAX_LOG_CHARS) {
    throw new TournamentError('That battle log is too long. Trim it or share a link instead.', 422)
  }

  const { error: upErr } = await sb
    .from('matches')
    .update({
      dispute_log_url: url || null,
      dispute_log_text: text || null,
      dispute_log_by: walletAddress ? walletAddress.toLowerCase() : null,
      dispute_log_at: nowIso(),
    })
    .eq('id', matchId)
    .eq('tournament_id', row.id)
    // Re-check status in the write so evidence can't land after an admin
    // resolves the dispute in a race.
    .eq('status', 'disputed')
  if (upErr) throw new TournamentError(upErr.message, 500)
}

// ── Active (live) tournament ───────────────────────────────────────────────

/** The one tournament shown at /tournaments - env override or is_live row. */
export async function getLiveTournamentRow() {
  const sb = getServiceClient()
  const pinned = process.env.TOURNAMENT_ACTIVE_CODE?.trim()
  if (pinned) return fetchTournamentRowByCode(pinned)
  const { data, error } = await sb
    .from('tournaments')
    .select('*')
    .eq('is_live', true)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new TournamentError(error.message, 500)
  if (!data) throw new TournamentError('No tournament is live right now.', 404)
  return data
}

export async function getActiveSnapshot(): Promise<TournamentSnapshot> {
  const row = await getLiveTournamentRow()
  return getSnapshotByCode(row.code)
}

/**
 * Public archive of finished events, newest first. One lightweight summary
 * per `complete` tournament (no bracket joins): name, date, headcount, and the
 * champion (final_rank = 1). Players are pulled in a single batched query and
 * grouped in memory so this stays one round-trip regardless of event count.
 */
export async function listCompletedTournaments(): Promise<CompletedTournamentSummary[]> {
  const sb = getServiceClient()
  const { data: tRows, error } = await sb
    .from('tournaments')
    .select('id, code, name, format, created_at')
    .eq('status', 'complete')
    .order('created_at', { ascending: false })
  if (error) throw new TournamentError(error.message, 500)
  const tournaments = tRows ?? []
  if (tournaments.length === 0) return []

  const ids = tournaments.map((t) => t.id as string)
  const { data: pRows } = await sb
    .from('players')
    .select('tournament_id, x_handle, display_name, wallet_address, final_rank, dropped, approval_status, seed')
    .in('tournament_id', ids)

  interface ChampRaw {
    xHandle: string
    displayName: string
    walletAddress: string | null
  }
  const counts = new Map<string, number>()
  const champions = new Map<string, ChampRaw>()
  for (const p of pRows ?? []) {
    const tid = p.tournament_id as string
    // Competitor count = the field we started with: everyone seeded into the
    // bracket at Round 1. Players who dropped mid-event still count (they were
    // part of the starting field); sign-ups that were never seeded (pending) or
    // rejected are excluded. Matches the detail page's competitor chip.
    const seeded = (p.seed ?? null) != null
    const rejected = (p.approval_status ?? 'approved') === 'rejected'
    if (seeded && !rejected) counts.set(tid, (counts.get(tid) ?? 0) + 1)
    if ((p.final_rank ?? null) === 1 && !champions.has(tid)) {
      champions.set(tid, {
        xHandle: (p.x_handle as string) ?? '',
        displayName: (p.display_name as string) ?? '',
        walletAddress: (p.wallet_address as string | null) ?? null,
      })
    }
  }

  // Enrich champions with their profile identity (username + avatar) so the
  // archive list reads like the rest of the site: avatar prepended to the name.
  const champList = [...champions.values()]
  const addrs = [...new Set(champList.map((c) => c.walletAddress?.toLowerCase()).filter((a): a is string => !!a))]
  const handles = [...new Set(champList.map((c) => c.xHandle?.toLowerCase()).filter((h): h is string => !!h))]
  type ChampIdent = { username: string | null; avatarUrl: string | null; country: string | null }
  const byWallet = new Map<string, ChampIdent>()
  const byHandle = new Map<string, ChampIdent>()
  const ingest = (rows: Record<string, unknown>[] | null) => {
    for (const r of rows ?? []) {
      const rec: ChampIdent = {
        username: (r.username as string | null) ?? null,
        avatarUrl: (r.avatar_url as string | null) ?? null,
        country: (r.country as string | null) ?? null,
      }
      const w = r.wallet_address as string | null
      const h = r.x_handle as string | null
      if (w) byWallet.set(w.toLowerCase(), rec)
      if (h) byHandle.set(h.toLowerCase(), rec)
    }
  }
  try {
    const cols = 'wallet_address, username, x_handle, avatar_url, country'
    const baseCols = 'wallet_address, username, x_handle, avatar_url'
    const selectChamps = async (column: 'wallet_address' | 'x_handle', values: string[]) => {
      const withCountry = await sb.from('wallet_profiles').select(cols).in(column, values)
      if (!withCountry.error) return withCountry.data as Record<string, unknown>[] | null
      return (await sb.from('wallet_profiles').select(baseCols).in(column, values)).data as Record<string, unknown>[] | null
    }
    if (addrs.length) ingest(await selectChamps('wallet_address', addrs))
    if (handles.length) ingest(await selectChamps('x_handle', handles))
  } catch {
    // Best-effort: a missing profile just falls back to the handle.
  }

  return tournaments.map((t) => {
    const champ = champions.get(t.id as string) ?? null
    const rec = champ
      ? (champ.walletAddress && byWallet.get(champ.walletAddress.toLowerCase())) ||
        (champ.xHandle && byHandle.get(champ.xHandle.toLowerCase())) ||
        null
      : null
    return {
      code: t.code as string,
      name: t.name as string,
      format: t.format as TournamentFormat,
      createdAt: t.created_at as string,
      playerCount: counts.get(t.id as string) ?? 0,
      champion: champ
        ? {
            xHandle: champ.xHandle,
            displayName: champ.displayName,
            walletAddress: champ.walletAddress,
            username: rec?.username ?? null,
            avatarUrl: rec?.avatarUrl ?? null,
            country: rec?.country ?? null,
          }
        : null,
    }
  })
}

/**
 * Tiny status probe for the global header badge. Reads only the live
 * tournament row (no players/matches/rounds joins) so it's cheap to
 * poll site-wide. Returns `{ live: false }` instead of throwing when
 * nothing is on, since "no tournament" is the normal resting state.
 */
export async function getActiveStatus(): Promise<{
  live: boolean
  status?: string
  code?: string
}> {
  try {
    const row = await getLiveTournamentRow()
    const live = row.status === 'enrolling' || row.status === 'running'
    return { live, status: row.status, code: row.code }
  } catch (err) {
    if (err instanceof TournamentError && err.status === 404) return { live: false }
    throw err
  }
}

// ── Admin-only operations (TOURNAMENT_ADMIN_SECRET) ────────────────────────

export async function adminStartFresh(input: {
  name: string
  signupMinutes: number
  roundMinutes: number
  format?: TournamentFormat
  maxPlayers?: number | null
  rules?: string | null
  contactUrl?: string | null
  theme?: string | null
}): Promise<{ code: string }> {
  const sb = getServiceClient()
  const name = input.name?.trim()
  if (!name) throw new TournamentError('Tournament name is required.')
  const format: TournamentFormat = input.format === 'single-elim' ? 'single-elim' : 'swiss'

  const { data: prevLive } = await sb
    .from('tournaments')
    .select('theme')
    .eq('is_live', true)
    .maybeSingle()
  const inheritedTheme =
    typeof input.theme === 'string' && TOURNAMENT_THEMES[input.theme]
      ? input.theme
      : typeof prevLive?.theme === 'string' && TOURNAMENT_THEMES[prevLive.theme]
        ? prevLive.theme
        : null

  await sb.from('tournaments').update({ is_live: false }).eq('is_live', true)

  const hostToken = generateToken()
  const signupMinutes = Math.max(5, input.signupMinutes || 60)
  const roundMinutes = Math.max(15, input.roundMinutes || 1440)
  const enrollClosesAt = addMinutes(nowIso(), signupMinutes)

  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode('OP')
    const { data, error } = await sb
      .from('tournaments')
      .insert({
        code,
        name,
        game: 'one-piece',
        format,
        status: 'enrolling',
        swiss_rounds: null,
        round_minutes: roundMinutes,
        enroll_closes_at: enrollClosesAt,
        rules: input.rules?.trim() || null,
        contact_url: input.contactUrl?.trim() || null,
        host_token_hash: hashToken(hostToken),
        is_live: true,
        max_players: input.maxPlayers ?? null,
        theme: inheritedTheme,
      })
      .select('*')
      .single()
    if (!error && data) {
      // Auto-populate the fresh event from the waitlist (pending sign-ups).
      // Best-effort: never blocks creation. Dynamic import avoids a static
      // import cycle (waitlist.ts imports TournamentError from this module).
      const { convertWaitlistToTournament } = await import('./waitlist')
      await convertWaitlistToTournament(data.id, { maxPlayers: data.max_players ?? null })
      return { code: data.code }
    }
    lastErr = error
    if (error && (error as { code?: string }).code !== '23505') break
  }
  throw new TournamentError(
    `Could not start tournament: ${(lastErr as Error)?.message ?? 'unknown'}`,
    500,
  )
}

/**
 * Spin up a new PAID game for the always-on /tournaments/paid lobby. Unlike the
 * featured event this never sets is_live and never touches any live event, so
 * many paid games can run in parallel. Forced to Swiss (the format the
 * hard-deadline / double-forfeit autopilot is designed for). Enrollment stays
 * open until the operator starts the bracket (manual start; no signup timer).
 *
 * The `escrow_id` is generated here so the row is "paid" (isPaid) immediately;
 * the on-chain createGame tx (operator-signed) uses this same id. contract
 * address + chain id are stamped from env when the escrow is configured.
 */
export async function adminCreatePaidGame(input: {
  name: string
  entryFeeUsdc?: number
  rakeBps?: number
  payoutPreset: string
  maxPlayers: number
  roundMinutes: number
  game?: TournamentGame
  theme?: string | null
  rules?: string | null
  contactUrl?: string | null
  /** Optional per-lobby region lock. null/undefined = open lobby (default). */
  lobbyRegion?: Region | null
  /**
   * Optional shared join code (a room passcode). When provided and non-empty it
   * is persisted server-side; players must present it to enroll. Trimmed;
   * empty/whitespace/undefined => null = open lobby (no code).
   */
  joinPassword?: string | null
  /**
   * Optional hero background image for the game page. Either a compressed WebP
   * data URL (uploaded/pasted image) or a plain image URL (pasted link).
   * Trimmed; empty/whitespace/undefined => null (use the default arena image).
   */
  heroImage?: string | null
}): Promise<{ code: string }> {
  const sb = getServiceClient()
  const name = input.name?.trim()
  if (!name) throw new TournamentError('Game name is required.')
  if (!isPayoutPreset(input.payoutPreset)) throw new TournamentError('Pick a valid payout preset.')
  const preset: PayoutPreset = input.payoutPreset
  const entryFeeUsdc = Math.floor(input.entryFeeUsdc ?? DEFAULT_ENTRY_FEE_USDC)
  if (!Number.isInteger(entryFeeUsdc) || entryFeeUsdc <= 0) {
    throw new TournamentError('Entry fee must be a positive USDC amount.')
  }
  const rakeBps = Math.floor(input.rakeBps ?? DEFAULT_RAKE_BPS)
  if (rakeBps < 0 || rakeBps > MAX_RAKE_BPS) {
    throw new TournamentError(`Rake must be between 0 and ${MAX_RAKE_BPS} bps.`)
  }
  const cap = Math.floor(input.maxPlayers)
  const depth = payoutDepth(preset)
  if (!Number.isInteger(cap) || cap < depth) {
    throw new TournamentError(`Player cap must be at least the payout depth (${depth}).`)
  }
  const roundMinutes = Math.max(15, input.roundMinutes || 1440)
  const game: TournamentGame = input.game ?? 'one-piece'
  const theme =
    typeof input.theme === 'string' && TOURNAMENT_THEMES[input.theme] ? input.theme : null
  // Open lobby by default; sanitize anything else to a valid region or null.
  const lobbyRegion = sanitizeRegion(input.lobbyRegion)
  // Optional shared join code. Trim; empty/whitespace => null (open lobby).
  const joinPassword =
    typeof input.joinPassword === 'string' && input.joinPassword.trim()
      ? input.joinPassword.trim()
      : null
  // Optional hero image. Trim; empty/whitespace => null (default arena image).
  const heroImage =
    typeof input.heroImage === 'string' && input.heroImage.trim() ? input.heroImage.trim() : null

  const escrowId = randomBytes32Hex()
  const contractAddress = isEscrowConfigured() ? escrowAddress() : null
  const chainId = isEscrowConfigured() ? escrowChainId() : null

  // Open the game on-chain first (operator-signed). If this reverts we never
  // write the DB row, so the mirror and the contract stay consistent. When the
  // operator key isn't configured this is a no-op and the game is DB-only
  // (QC / pre-deploy mode).
  if (isOperatorConfigured()) {
    await createGameOnchain({
      escrowId: escrowId as `0x${string}`,
      entryFee: BigInt(entryFeeUsdc),
      cap,
      rakeBps,
      payoutBps: PAYOUT_PRESETS[preset],
    })
  }

  const hostToken = generateToken()
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateCode('PG')
    const insertRow: Record<string, unknown> = {
      code,
      name,
      game,
      format: 'swiss',
      status: 'enrolling',
      // Store the round count up front (derived from the cap) so the schedule
      // shows a definite "N rounds" instead of a "~" estimate. Paid fields fill
      // to the cap, so this is the planned structure players sign up against.
      swiss_rounds: recommendedSwissRounds(cap),
      round_minutes: roundMinutes,
      enroll_closes_at: null, // manual start; no signup timer
      rules: input.rules?.trim() || null,
      contact_url: input.contactUrl?.trim() || null,
      host_token_hash: hashToken(hostToken),
      is_live: false, // never the featured event
      max_players: cap,
      theme,
      escrow_id: escrowId,
      entry_fee_usdc: entryFeeUsdc,
      rake_bps: rakeBps,
      payout_preset: preset,
      payout_bps: PAYOUT_PRESETS[preset],
      contract_address: contractAddress,
      chain_id: chainId,
    }
    // Only write lobby_region when a region lock was actually requested, so an
    // OPEN lobby (the default) never references the new column and still creates
    // cleanly before migration 021 is applied. A region-locked lobby created
    // pre-migration will surface a clear DB error (that feature needs the column).
    if (lobbyRegion) insertRow.lobby_region = lobbyRegion
    // Only write join_password when a code was actually set, so an open lobby
    // never references the new column and still creates cleanly before
    // migration 024 is applied (mirrors the lobby_region handling above).
    if (joinPassword) insertRow.join_password = joinPassword
    // Only write hero_image when one was supplied, so a game created without an
    // image never references the new column and still creates cleanly before
    // migration 025 is applied (mirrors the lobby_region / join_password handling).
    if (heroImage) insertRow.hero_image = heroImage
    const { data, error } = await sb.from('tournaments').insert(insertRow).select('*').single()
    if (!error && data) return { code: data.code }
    lastErr = error
    if (error && (error as { code?: string }).code !== '23505') break
  }
  throw new TournamentError(
    `Could not create paid game: ${(lastErr as Error)?.message ?? 'unknown'}`,
    500,
  )
}

/**
 * Set or clear the shared join code (room passcode) for an existing tournament.
 * A null/empty/whitespace password CLEARS it (reopens the lobby). Stored
 * server-side in plaintext; the raw value is never exposed publicly (only the
 * derived `joinProtected` boolean is). Reachable only through the
 * admin-secret-gated route.
 */
export async function adminSetJoinPassword({
  code,
  password,
}: {
  code: string
  password: string | null
}): Promise<{ joinProtected: boolean }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  const next = typeof password === 'string' && password.trim() ? password.trim() : null
  const { error } = await sb.from('tournaments').update({ join_password: next }).eq('id', row.id)
  if (error) throw new TournamentError(`Could not update the join code: ${error.message}`, 500)
  return { joinProtected: next != null }
}

/**
 * Read the current raw join code so the operator can re-share it. Returns null
 * when no code is set. This is the ONLY path that exposes the raw value and is
 * reachable only through the admin-secret-gated route - never the public API.
 */
export async function adminGetJoinPassword(code: string): Promise<{ joinPassword: string | null }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  const raw = typeof row.join_password === 'string' && row.join_password.trim() ? row.join_password : null
  return { joinPassword: raw }
}

export async function adminExtendSignup(code: string, extraMinutes: number): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError('Sign-ups are already closed.')
  }
  const base = row.enroll_closes_at && new Date(row.enroll_closes_at) > new Date()
    ? row.enroll_closes_at
    : nowIso()
  await sb
    .from('tournaments')
    .update({ enroll_closes_at: addMinutes(base, Math.max(1, extraMinutes)) })
    .eq('id', row.id)
}

/**
 * Add time to the CURRENT round's deadline (e.g. "+1 hour") without changing the
 * configured round length for future rounds. Mirrors adminExtendSignup: if the
 * active round's deadline is still in the future we extend from there, otherwise
 * (already elapsed) we extend from now so it reopens for the full extra window.
 */
export async function adminExtendRound(code: string, extraMinutes: number): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'running') {
    throw new TournamentError('You can only extend a round while the tournament is running.')
  }
  const rounds = await fetchRounds(row.id)
  const active = rounds.find((r) => r.status === 'active')
  if (!active) {
    throw new TournamentError('There is no active round to extend.')
  }
  const base = active.endsAt && new Date(active.endsAt) > new Date() ? active.endsAt : nowIso()
  await sb
    .from('rounds')
    .update({ ends_at: addMinutes(base, Math.max(1, extraMinutes)) })
    .eq('id', active.id)
}

export async function adminCloseSignup(code: string): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'enrolling') return
  await sb
    .from('tournaments')
    .update({ status: 'enrolling', enroll_closes_at: nowIso() })
    .eq('id', row.id)
}

/**
 * Retarget the player cap (the "X / cap registered" ceiling) while sign-ups are
 * open. This is purely a gate for NEW sign-ups - it never touches or removes
 * anyone already registered, so dropping a 32-cap event to 16 when the field
 * came in smaller is safe (the headline just reads e.g. "13 / 16" instead of
 * "13 / 32"). Pass null to clear the cap (unlimited up to the global guard).
 */
export async function adminSetMaxPlayers(code: string, maxPlayers: number | null): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError('You can only change the player cap while sign-ups are open.')
  }
  let cap: number | null = null
  if (maxPlayers != null) {
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2) {
      throw new TournamentError('Player cap must be a whole number of at least 2.')
    }
    cap = Math.min(maxPlayers, MAX_PLAYERS)
  }
  await sb.from('tournaments').update({ max_players: cap }).eq('id', row.id)
}

/**
 * Retarget the per-round length. Editable any time before the event finishes.
 * The new value applies to every round created from here on; when the event is
 * already running we also re-stamp the active round's deadline from its own
 * start time so the change is visible immediately, not just on the next round.
 */
export async function adminSetRoundMinutes(code: string, roundMinutes: number): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'enrolling' && row.status !== 'running') {
    throw new TournamentError('You can only change round length before the tournament finishes.')
  }
  if (!Number.isInteger(roundMinutes) || roundMinutes < 15) {
    throw new TournamentError('Round length must be a whole number of at least 15 minutes.')
  }
  // Two-week ceiling: a sane backstop so a fat-fingered value can't park a
  // round open effectively forever.
  const minutes = Math.min(roundMinutes, 20160)
  await sb.from('tournaments').update({ round_minutes: minutes }).eq('id', row.id)

  if (row.status === 'running') {
    const rounds = await fetchRounds(row.id)
    const active = rounds.find((r) => r.status === 'active')
    if (active) {
      await sb
        .from('rounds')
        .update({ ends_at: addMinutes(active.startsAt, minutes) })
        .eq('id', active.id)
    }
  }
}

export async function adminApprovePlayer(code: string, playerId: string): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  const { data: updated } = await sb
    .from('players')
    .update({ approval_status: 'approved' })
    .eq('id', playerId)
    .eq('tournament_id', row.id)
    .select('wallet_address')
    .maybeSingle()
  // Paid games only: approval freezes the decklist, so stamp deck_locked_at for
  // auditability. Done as a separate, null-guarded write so a re-approve never
  // rewrites the original lock time, and so free/featured approval behavior is
  // completely unchanged (this block is a no-op for them).
  if (Boolean(row.escrow_id)) {
    await sb
      .from('players')
      .update({ deck_locked_at: nowIso() })
      .eq('id', playerId)
      .eq('tournament_id', row.id)
      .is('deck_locked_at', null)
    // Mirror the approval on-chain: add the player's wallet to the escrow's
    // winner allowlist (signed by the SEPARATE approver key) so the contract
    // will let them be paid at settle. Best-effort - the off-chain approval
    // already succeeded above and must NOT be undone if this fails.
    const wallet = (updated as { wallet_address?: string | null } | null)?.wallet_address
    await approveWinnerOnchainBestEffort(row.escrow_id as Hex, wallet ?? null)
  }
}

/**
 * Add a wallet to a paid game's on-chain winner allowlist via the SEPARATE
 * approver key. Best-effort by design: any failure (key unset, missing wallet,
 * RPC error, or the escrow not created on-chain yet) is logged and swallowed so
 * the off-chain approval is never rolled back. When the approver key is unset
 * we skip quietly - the game then requires a manual on-chain approve before it
 * can settle, mirroring how a missing operator key degrades to manual settle.
 */
async function approveWinnerOnchainBestEffort(
  escrowId: Hex,
  wallet: string | null,
): Promise<void> {
  if (!isApproverConfigured()) return // approver not configured: skip on-chain approve
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) return // no linked wallet to approve
  try {
    await approveWinnerOnchain(escrowId, wallet as Address, true)
  } catch (err) {
    console.warn('[escrow] on-chain winner approve failed (off-chain approval kept):', err)
  }
}

export async function adminRejectPlayer(code: string, playerId: string): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  await sb
    .from('players')
    .update({ approval_status: 'rejected' })
    .eq('id', playerId)
    .eq('tournament_id', row.id)
}

/**
 * Promote one waitlist entry into the current event as a PENDING sign-up.
 * Guardrails: only while the event is still 'enrolling' (before the bracket is
 * drawn), and only when the roster is under its player cap. A full roster must
 * free a slot (reject or drop someone) before a waitlister can take it, which
 * mirrors the public sign-up cap check. The promoted person drops off the
 * waitlist. Returns whether a new row was created (vs. they were already in).
 */
export async function adminPromoteFromWaitlist(
  code: string,
  entryId: string,
): Promise<{ promoted: boolean; alreadyIn: boolean; xHandle: string }> {
  const row = await requireHost(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError(
      'Sign-ups are closed - you can only promote from the waitlist before the bracket starts.',
    )
  }
  const players = await fetchPlayers(row.id)
  const cap = row.max_players ?? MAX_PLAYERS
  // Dropped and rejected sign-ups don't occupy a slot, so either frees room for
  // a waitlist promotion (matches the UI's spotsLeft calc).
  const activeSignups = players.filter((p) => !p.dropped && p.approvalStatus !== 'rejected')
  if (activeSignups.length >= cap) {
    throw new TournamentError(
      'The current sign-ups are full. Reject or drop someone to free a slot before promoting from the waitlist.',
    )
  }
  // Deferred import: waitlist.ts imports TournamentError from this module, so a
  // static import would create a cycle (same pattern as the auto-convert path).
  const { promoteWaitlistEntry } = await import('./waitlist')
  return promoteWaitlistEntry(row.id, entryId)
}

// ── Deck lists ───────────────────────────────────────────────────────────--

/**
 * Player self-submit of their committed deck list. Wallet-backed: the route
 * passes the signed-in wallet + its profile handle, and we match those to the
 * player row in this tournament. Set-once: if a list is already locked we
 * refuse, so a player can never quietly swap decks mid-event. Used by people
 * who entered without a list (waitlist conversions) to fill it in before lock.
 */
export async function submitDeckList(
  code: string,
  walletAddress: string,
  xHandle: string,
  deckListRaw: string,
): Promise<{ deckList: string }> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  if (row.status === 'complete') {
    throw new TournamentError('This tournament is over.')
  }

  const addr = (walletAddress ?? '').toLowerCase()
  const handle = normalizeXHandle(xHandle)
  const players = await fetchPlayers(row.id)
  const player = players.find(
    (p) =>
      p.approvalStatus !== 'rejected' &&
      ((addr && p.walletAddress?.toLowerCase() === addr) || (handle && p.xHandle === handle)),
  )
  if (!player) {
    throw new TournamentError('You are not signed up for this tournament.', 404)
  }
  // Decklist immutability (paid games): once an entrant is APPROVED in a paid
  // (escrow-linked) event, their list is frozen and can never be re-submitted -
  // the deck is the thing the public audit view checks against a replay, so it
  // must not move after approval. This is belt-and-suspenders on top of the
  // set-once guard below (which already blocks overwriting a submitted list for
  // every event): it also covers the narrow case of an approved paid walk-in
  // who somehow still had a null list. Free/featured events are untouched.
  if (Boolean(row.escrow_id) && player.approvalStatus === 'approved') {
    throw new TournamentError(
      'Your deck list is locked. It was frozen when your entry was approved and cannot be changed.',
      409,
    )
  }
  if (player.deckList && player.deckList.trim() !== '') {
    throw new TournamentError('Your deck list is already locked and cannot be changed.', 409)
  }

  const checked = validateDeckList(deckListRaw)
  if (!checked.ok) throw new TournamentError(checked.error)

  // Guard the write on deck_list still being null to avoid a double-submit race.
  const { data, error } = await sb
    .from('players')
    .update({ deck_list: checked.value })
    .eq('id', player.id)
    .is('deck_list', null)
    .select('id')
  if (error) throw new TournamentError(error.message, 500)
  if (!data || data.length === 0) {
    throw new TournamentError('Your deck list is already locked and cannot be changed.', 409)
  }
  return { deckList: checked.value }
}

/**
 * Operator override of a player's deck list (host-gated). Doubles as the typo-
 * fix escape hatch, the way to record a walk-in's list, and the way to correct
 * a malformed submission mid-event (e.g. a player who pasted the wrong deck
 * code) before resorting to a disqualification. Unlike player self-submit -
 * which freezes once the bracket starts so nobody can swap decks mid-event -
 * this operator path stays open through the running event and only locks once
 * the tournament is over.
 */
export async function adminSetDeck(
  code: string,
  playerId: string,
  deckListRaw: string,
): Promise<{ deckList: string }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status === 'complete' || row.status === 'cancelled') {
    throw new TournamentError('Deck lists are locked once the event is over.')
  }
  const checked = validateDeckList(deckListRaw)
  if (!checked.ok) throw new TournamentError(checked.error)

  const { error } = await sb
    .from('players')
    .update({ deck_list: checked.value })
    .eq('id', playerId)
    .eq('tournament_id', row.id)
  if (error) throw new TournamentError(error.message, 500)
  return { deckList: checked.value }
}

/** Operator read of one player's full deck list (host-gated, on demand). The
 * `check` field is the definitive resolve/format validation (see deck-check). */
export async function adminGetDeck(
  code: string,
  playerId: string,
): Promise<{ deckList: string | null; check: DeckCheck | null }> {
  const row = await requireHost(code)
  const players = await fetchPlayers(row.id)
  const player = players.find((p) => p.id === playerId)
  if (!player) throw new TournamentError('Player not found.', 404)
  return {
    deckList: player.deckList,
    check: player.deckList ? checkDeckList(player.deckList) : null,
  }
}

/**
 * Host-gated one-shot audit of every player's deck: runs the definitive
 * resolve/format check (see deck-check) against each stored list in a single
 * round-trip so the admin roster can badge each entry pass/fail without
 * fetching decks one by one. Advisory only - never blocks anything. Dropped and
 * rejected entries are skipped since they're out of the field.
 */
export async function adminAuditDecks(
  code: string,
): Promise<{ playerId: string; hasDeck: boolean; ok: boolean; issues: string[] }[]> {
  const row = await requireHost(code)
  const players = await fetchPlayers(row.id)
  return players
    .filter((p) => !p.dropped && p.approvalStatus !== 'rejected')
    .map((p) => {
      if (!p.deckList) {
        return { playerId: p.id, hasDeck: false, ok: false, issues: ['No deck list submitted.'] }
      }
      const check = checkDeckList(p.deckList)
      return { playerId: p.id, hasDeck: true, ok: check.ok, issues: check.issues }
    })
}

/** How many matched deck-list lines to surface per player, so the operator sees
 * why an entry matched without shipping the whole list to the client. */
const MAX_DECK_SEARCH_SNIPPETS = 3

/**
 * Host-gated substring search across every entrant's submitted deck list.
 * Case-insensitive raw-text match (card ids show up with or without leading
 * zeros and quantity prefixes like "4xST31-036", so a plain substring is the
 * right primitive - not exact-id resolution). Deck text stays server-side: only
 * the matching player ids plus a few context lines cross the wire. Matches
 * regardless of approval status (pending/approved/rejected all count) since the
 * operator is hunting for a card across the whole field; dropped entries are
 * excluded as they're out of the event.
 */
export async function adminSearchDecks(
  code: string,
  query: string,
): Promise<{ playerId: string; matchedLines: string[] }[]> {
  const row = await requireHost(code)
  const needle = (query ?? '').trim().toLowerCase()
  if (!needle) return []
  const players = await fetchPlayers(row.id)
  const matches: { playerId: string; matchedLines: string[] }[] = []
  for (const p of players) {
    if (p.dropped || !p.deckList) continue
    if (!p.deckList.toLowerCase().includes(needle)) continue
    const matchedLines = p.deckList
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.toLowerCase().includes(needle))
      .slice(0, MAX_DECK_SEARCH_SNIPPETS)
    matches.push({ playerId: p.id, matchedLines })
  }
  return matches
}

/**
 * The signed-in player's own deck list for this tournament, resolved from
 * their wallet (or profile handle). Lets a player pull up the list they
 * committed to during the event, and tells the UI whether they still owe one.
 */
export async function getOwnDeck(
  code: string,
  walletAddress: string,
  xHandle: string,
): Promise<{ enrolled: boolean; deckList: string | null }> {
  const row = await fetchTournamentRowByCode(code)
  const addr = (walletAddress ?? '').toLowerCase()
  const handle = normalizeXHandle(xHandle)
  const players = await fetchPlayers(row.id)
  const player = players.find(
    (p) =>
      p.approvalStatus !== 'rejected' &&
      ((addr && p.walletAddress?.toLowerCase() === addr) || (handle && p.xHandle === handle)),
  )
  if (!player) return { enrolled: false, deckList: null }
  return { enrolled: true, deckList: player.deckList }
}

/** Hard caps so a pasted image dump can't bloat the polled snapshot. */
const MAX_PRIZES = 12
const MAX_PRIZE_IMAGE_CHARS = 1_500_000 // ~1.1MB of base64

/**
 * Replace a tournament's whole prize pool. The client compresses pasted
 * images to data URLs before sending; we still guard count + per-image
 * size here so the public snapshot stays lean.
 */
export async function adminSetPrizes(
  code: string,
  prizes: unknown,
): Promise<{ count: number }> {
  const sb = getServiceClient()
  const row = await requireHost(code)

  if (!Array.isArray(prizes)) {
    throw new TournamentError('Prizes must be a list.')
  }
  if (prizes.length > MAX_PRIZES) {
    throw new TournamentError(`At most ${MAX_PRIZES} prize slots.`)
  }

  const clean: TournamentPrize[] = prizes.map((p, i) => {
    const obj = (p ?? {}) as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 120) : ''
    const description =
      typeof obj.description === 'string' ? obj.description.trim().slice(0, 600) : ''
    let image: string | null = null
    if (typeof obj.image === 'string' && obj.image.trim()) {
      const img = obj.image.trim()
      const looksValid = img.startsWith('data:image/') || /^https?:\/\//i.test(img)
      if (!looksValid) {
        throw new TournamentError(`Prize ${i + 1}: image must be a pasted image or a URL.`)
      }
      if (img.length > MAX_PRIZE_IMAGE_CHARS) {
        throw new TournamentError(
          `Prize ${i + 1}: image is too large - paste a smaller one.`,
        )
      }
      image = img
    }
    if (!title && !description && !image) {
      throw new TournamentError(`Prize ${i + 1} is empty - add a title, description, or image.`)
    }
    return { title: title || `Prize ${i + 1}`, description, image }
  })

  const { error } = await sb.from('tournaments').update({ prizes: clean }).eq('id', row.id)
  if (error) throw new TournamentError(error.message, 500)
  return { count: clean.length }
}

/** Hard caps for the badge pool. Images are normalized to a small WebP client- */
const MAX_BADGES = 16
const MAX_BADGE_IMAGE_CHARS = 800_000 // normalized WebP is tiny; generous guard

/**
 * Replace a tournament's whole badge pool. Structurally identical to
 * adminSetPrizes: slot order is placing order, so N slots => the top N finishers
 * each earn the badge for their rank on completion. The client normalizes badge
 * art to a small WebP data URL before sending; we still guard count + size.
 */
export async function adminSetBadges(
  code: string,
  badges: unknown,
): Promise<{ count: number }> {
  const sb = getServiceClient()
  const row = await requireHost(code)

  if (!Array.isArray(badges)) {
    throw new TournamentError('Badges must be a list.')
  }
  if (badges.length > MAX_BADGES) {
    throw new TournamentError(`At most ${MAX_BADGES} badge slots.`)
  }

  const clean: TournamentBadgeSlot[] = badges.map((b, i) => {
    const obj = (b ?? {}) as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 120) : ''
    const description =
      typeof obj.description === 'string' ? obj.description.trim().slice(0, 600) : ''
    let image: string | null = null
    if (typeof obj.image === 'string' && obj.image.trim()) {
      const img = obj.image.trim()
      const looksValid = img.startsWith('data:image/') || /^https?:\/\//i.test(img)
      if (!looksValid) {
        throw new TournamentError(`Badge ${i + 1}: image must be an uploaded image or a URL.`)
      }
      if (img.length > MAX_BADGE_IMAGE_CHARS) {
        throw new TournamentError(`Badge ${i + 1}: image is too large.`)
      }
      image = img
    }
    // A badge is only meaningful with art; a header alone isn't a badge.
    if (!image) {
      throw new TournamentError(`Badge ${i + 1}: add a badge image.`)
    }
    return { title: title || `Top ${i + 1}`, description, image }
  })

  const { error } = await sb.from('tournaments').update({ badges: clean }).eq('id', row.id)
  if (error) throw new TournamentError(error.message, 500)
  return { count: clean.length }
}

/**
 * Replace (or clear) a tournament's single participation badge - the optional
 * badge handed to EVERY participant, independent of placement. Pass null (or a
 * badge with no image) to remove it. If the event is already complete, the badge
 * is granted to all participants immediately (idempotent); otherwise it's handed
 * out automatically when the event finalizes. Clearing removes any awarded rows.
 */
export async function adminSetParticipationBadge(
  code: string,
  badge: unknown,
): Promise<{ count: number; awarded: number }> {
  const sb = getServiceClient()
  const row = await requireHost(code)

  // Normalize / validate. A null (or image-less) badge clears the slot.
  let clean: TournamentBadgeSlot | null = null
  if (badge && typeof badge === 'object' && !Array.isArray(badge)) {
    const obj = badge as Record<string, unknown>
    const title = typeof obj.title === 'string' ? obj.title.trim().slice(0, 120) : ''
    const description =
      typeof obj.description === 'string' ? obj.description.trim().slice(0, 600) : ''
    let image: string | null = null
    if (typeof obj.image === 'string' && obj.image.trim()) {
      const img = obj.image.trim()
      const looksValid = img.startsWith('data:image/') || /^https?:\/\//i.test(img)
      if (!looksValid) {
        throw new TournamentError('Participation badge: image must be an uploaded image or a URL.')
      }
      if (img.length > MAX_BADGE_IMAGE_CHARS) {
        throw new TournamentError('Participation badge: image is too large.')
      }
      image = img
    }
    if (image) clean = { title: title || 'Participant', description, image }
  }

  const { error } = await sb
    .from('tournaments')
    .update({ participation_badge: clean })
    .eq('id', row.id)
  if (error) throw new TournamentError(error.message, 500)

  // Cleared: drop any previously-awarded participation rows and reset the stamp.
  if (!clean) {
    await clearParticipationBadgeAwards(row.id)
    return { count: 0, awarded: 0 }
  }

  // Already complete: grant right now so past events can be badged retroactively.
  // Still running / enrolling: it'll auto-award at completion.
  if (row.status === 'complete') {
    const players = await fetchPlayers(row.id)
    const awarded = await persistParticipationBadge(row.id, clean, players)
    return { count: 1, awarded }
  }
  return { count: 1, awarded: 0 }
}

/**
 * Admin: resolve the (now frozen) prize pool to its winners and lock it in.
 * Only valid once the event is complete - prizes change right up to the end,
 * so we never freeze a still-running pool. `assignments` is one entry per prize
 * slot listing the winning player ids (one slot can have many winners, e.g.
 * "Top 8"). Re-running overwrites the previous award. The live pool itself is
 * NOT modified; we only snapshot it onto the winners.
 */
export async function adminAwardPrizes(
  code: string,
  assignments: unknown,
): Promise<{ count: number }> {
  const row = await requireHost(code)
  const tournament = rowToTournament(row)
  if (tournament.status !== 'complete') {
    throw new TournamentError('Prizes can only be awarded once the tournament is complete.')
  }
  if (!Array.isArray(assignments)) {
    throw new TournamentError('Assignments must be a list.')
  }
  const clean: PrizeAssignment[] = []
  for (const a of assignments) {
    const obj = (a ?? {}) as Record<string, unknown>
    const slotIndex = Number(obj.slotIndex)
    if (!Number.isInteger(slotIndex) || slotIndex < 0 || slotIndex >= tournament.prizes.length) {
      continue
    }
    const ids = Array.isArray(obj.playerIds)
      ? (obj.playerIds.filter((x) => typeof x === 'string' && x) as string[])
      : []
    if (ids.length === 0) continue
    clean.push({ slotIndex, playerIds: Array.from(new Set(ids)) })
  }
  const count = await persistAwardedPrizes(tournament.id, tournament.prizes, clean)
  return { count }
}

export async function adminApproveAllPending(code: string): Promise<number> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  const { data } = await sb
    .from('players')
    .update({ approval_status: 'approved' })
    .eq('tournament_id', row.id)
    .eq('approval_status', 'pending')
    .select('id, wallet_address')
  // Paid games only: stamp deck_locked_at on the rows we just approved (null-
  // guarded so it never overwrites an existing lock). No-op for free/featured.
  if (Boolean(row.escrow_id) && data && data.length > 0) {
    await sb
      .from('players')
      .update({ deck_locked_at: nowIso() })
      .eq('tournament_id', row.id)
      .in(
        'id',
        data.map((r: { id: string }) => r.id),
      )
      .is('deck_locked_at', null)
    // Mirror all these approvals on-chain in one batch (separate approver key).
    // Best-effort: never roll back the off-chain approvals if this fails.
    const wallets = (data as { wallet_address?: string | null }[])
      .map((r) => r.wallet_address)
      .filter((w): w is string => Boolean(w) && /^0x[0-9a-fA-F]{40}$/.test(w as string))
    if (isApproverConfigured() && wallets.length > 0) {
      try {
        await approveWinnersOnchain(row.escrow_id as Hex, wallets as Address[], true)
      } catch (err) {
        console.warn('[escrow] on-chain batch winner approve failed (off-chain kept):', err)
      }
    }
  }
  return data?.length ?? 0
}

/** Close sign-ups and generate round 1 from approved players only. */
export async function adminStartBracket(code: string): Promise<void> {
  const row = await requireHost(code)
  await generateFirstRound(row)
}

/**
 * Manually finalize a running tournament: lock standings as they stand right
 * now, mark it complete, and auto-award prizes (unless a prize-winning spot is
 * an unresolved tie, in which case the host awards manually). This is the same
 * end-state the engine reaches on its own after the last round, exposed as a
 * host control so the operator can reveal the podium on their own schedule.
 *
 * It does NOT start a new event or touch the waitlist, so the public page sits
 * on the podium showcase (waitlist still open for the next event) until the
 * host explicitly starts fresh. Any unreported matches in the current round are
 * locked as-is, so the host should only use this once results are settled.
 */
export async function adminEndTournament(code: string): Promise<void> {
  const row = await requireHost(code)
  if (row.status === 'complete') return // already finalized - idempotent
  if (row.status !== 'running') {
    throw new TournamentError('Only a running tournament can be ended. Start round 1 first.')
  }
  const sb = getServiceClient()

  // HARDENING: lock the result set so the podium can't shift after we freeze it.
  // The cron sweep auto-confirms any match still in `reported` (a single-sided
  // report) regardless of tournament status. If we finalized while such a match
  // was outstanding, computeStandings would exclude it now (only `confirmed` /
  // `bye` count) but a later sweep could confirm it and move the podium. So we
  // confirm the provisional winner that was already stored at report time, up
  // front, making those matches terminal. `pending` (zero reports) and
  // `disputed` matches are inert here: the sweep never touches them and they
  // don't count toward standings, so the frozen podium stays put.
  await sb
    .from('matches')
    .update({ status: 'confirmed', resolved_at: nowIso() })
    .eq('tournament_id', row.id)
    .eq('status', 'reported')

  // Close any still-open round so the lifecycle stays consistent (no round left
  // dangling as "active" once the tournament reads complete).
  await sb.from('rounds').update({ status: 'complete' }).eq('tournament_id', row.id).neq('status', 'complete')

  // Recompute from the now-locked match set so the persisted placements and
  // awarded prizes match exactly what the public podium will render.
  const [players, allMatches] = await Promise.all([fetchPlayers(row.id), fetchMatches(row.id)])
  await finalizeTournament(row.id, players, allMatches)
}

/** Open or close the prize-distribution poll to new votes. */
export async function adminSetPollOpen(code: string, open: boolean): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  const { error } = await sb
    .from('tournaments')
    .update({ poll_open: open })
    .eq('id', row.id)
  if (error) throw new TournamentError(`Could not update the poll: ${error.message}`, 500)
}

// ── Cron sweep ─────────────────────────────────────────────────────────────

/**
 * Hands-off maintenance, run by Vercel Cron:
 *  1. Auto-confirm single-sided reports, but ONLY the common, unambiguous case:
 *     a lone SELF-WIN, and only once the round's deadline has passed (so the
 *     opponent had the entire round to report or dispute the claim). In
 *     practice the winner is usually the only one who bothers to report, so
 *     this clears the bulk of matches automatically.
 *     Every other single-sided report is left 'reported' for admin review:
 *     a self-reported LOSS / opponent-win and a lone DRAW are ambiguous enough
 *     (opponent never confirmed) that the operator eyeballs them instead of the
 *     result auto-locking.
 *  2. We never auto-award a match with ZERO reports - there's no signal to
 *     trust, so it stays pending for an admin to resolve.
 *  3. Advance any round that became fully resolved as a result.
 * Returns a small summary for logging.
 */
export async function sweep(): Promise<{
  enrollmentsClosed: number
  reportsConfirmed: number
  tournamentsAdvanced: number
  fundingReconciled: number
  deadlinesEnforced: number
  settlementsReconciled: number
}> {
  const sb = getServiceClient()
  let reportsConfirmed = 0
  const advanced = new Set<string>()
  const nowMs = Date.now()
  const windowMs = CONFIRM_WINDOW_MINUTES * 60_000
  const ms = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null)

  // Sign-up timers do NOT auto-start brackets - you approve handles and start
  // manually via adminStartBracket. Cron only resolves single-sided reports and
  // advances fully-completed rounds. Matches with no reports are left alone.
  const { data: stale } = await sb.from('matches').select('*').eq('status', 'reported')
  const reported = (stale ?? []).map(rowToMatch)

  // Round deadlines for the rounds these matches belong to (single query).
  const roundIds = [...new Set(reported.map((m) => m.roundId).filter(Boolean))] as string[]
  const endsByRound = new Map<string, string | null>()
  if (roundIds.length) {
    const { data: rs } = await sb.from('rounds').select('id, ends_at').in('id', roundIds)
    for (const r of rs ?? []) endsByRound.set(r.id as string, (r.ends_at as string | null) ?? null)
  }

  for (const match of reported) {
    const only = match.player1Report ?? match.player2Report
    if (!only) continue // guard - a 'reported' match always has exactly one report

    // Auto-confirm ONLY a lone self-win. A self-loss / opponent-win or a lone
    // draw is left 'reported' for admin review rather than auto-confirming.
    if (only !== 'win') continue

    // Hold the self-win until the round deadline so the opponent had the whole
    // round to report or dispute. If no deadline is on record, fall back to the
    // grace window so it can never hang forever.
    const endsMs = match.roundId ? ms(endsByRound.get(match.roundId)) : null
    const reportedMs = ms(match.reportedAt) ?? nowMs
    const ready = endsMs != null ? endsMs <= nowMs : reportedMs + windowMs <= nowMs
    if (!ready) continue

    // Provisional winner was already stored at report time; confirm it.
    await sb
      .from('matches')
      .update({ status: 'confirmed', resolved_at: nowIso() })
      .eq('id', match.id)
    reportsConfirmed++
    advanced.add(match.tournamentId)
  }

  // Advance affected tournaments.
  for (const tid of advanced) {
    try {
      await maybeAdvance(tid)
    } catch {
      /* ignore; next sweep retries */
    }
  }

  // Autopilot: enforce hard round deadlines on running paid games (resolve
  // no-shows, advance). Featured events are untouched.
  let deadlinesEnforced = 0
  try {
    deadlinesEnforced = await enforceRoundDeadlines()
  } catch {
    /* transient; next sweep retries */
  }

  // Read-only reconcile of paid-tournament funding against the chain. No-op
  // (and cheap) when the escrow isn't configured.
  let fundingReconciled = 0
  try {
    fundingReconciled = await reconcilePaidFunding()
  } catch {
    /* chain unreachable; next sweep retries */
  }

  // Autopilot payout retry: settle any complete paid game still Locked on-chain.
  let settlementsReconciled = 0
  try {
    settlementsReconciled = await reconcilePaidSettlements()
  } catch {
    /* chain unreachable; next sweep retries */
  }

  return {
    enrollmentsClosed: 0,
    reportsConfirmed,
    tournamentsAdvanced: advanced.size,
    fundingReconciled,
    deadlinesEnforced,
    settlementsReconciled,
  }
}

// ── Standalone (tournament-agnostic) badges ────────────────────────────────
//
// Hand-granted cosmetic badges the operator can award to any registered user
// at any time, independent of any tournament. Stored in manual_awarded_badges
// (migration 019) and merged onto the profile shelf alongside tournament
// badges. Same snapshot shape (title/description/normalized image data URL).

export interface BadgeRecipient {
  walletAddress: string
  username: string | null
  xHandle: string | null
  avatarUrl: string | null
}

export interface ManualBadgeAward {
  id: string
  walletAddress: string
  username: string | null
  xHandle: string | null
  displayName: string | null
  title: string
  description: string
  image: string | null
  awardedAt: string
}

/**
 * Every registered profile that could receive a badge, i.e. anyone with a
 * username or an X handle set. Newest profiles first. The recipient picker in
 * the admin panel searches/filters this client-side, so we return the whole
 * (small) roster rather than paging.
 */
export async function listBadgeRecipients(): Promise<BadgeRecipient[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('wallet_profiles')
    .select('wallet_address, username, x_handle, avatar_url, created_at')
    .or('username.not.is.null,x_handle.not.is.null')
    .order('created_at', { ascending: false })
    .limit(1000)
  if (error) throw new TournamentError(error.message, 500)
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      walletAddress: row.wallet_address as string,
      username: (row.username as string | null) ?? null,
      xHandle: (row.x_handle as string | null) ?? null,
      avatarUrl: (row.avatar_url as string | null) ?? null,
    }
  })
}

function rowToManualBadge(r: Record<string, unknown>): ManualBadgeAward {
  return {
    id: r.id as string,
    walletAddress: (r.wallet_address as string) ?? '',
    username: null,
    xHandle: (r.x_handle as string | null) ?? null,
    displayName: (r.display_name as string | null) ?? null,
    title: (r.title as string) ?? '',
    description: (r.description as string) ?? '',
    image: (r.image as string | null) ?? null,
    awardedAt: (r.awarded_at as string) ?? '',
  }
}

/**
 * Grant a standalone badge to one registered wallet. Snapshots the recipient's
 * handle/name so the award still reads if they later change their profile.
 */
export async function grantManualBadge(
  walletAddress: string,
  badge: TournamentBadgeSlot,
): Promise<ManualBadgeAward> {
  const wallet = (walletAddress || '').trim().toLowerCase()
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) {
    throw new TournamentError('Pick a valid recipient.', 400)
  }
  if (!badge.title.trim()) throw new TournamentError('Badge needs a title.', 400)
  if (!badge.image) throw new TournamentError('Badge needs an image.', 400)

  const sb = getServiceClient()
  // Snapshot the recipient's current handle/name for display.
  const { data: profile } = await sb
    .from('wallet_profiles')
    .select('username, x_handle')
    .eq('wallet_address', wallet)
    .maybeSingle()
  if (!profile) throw new TournamentError('That wallet has no profile.', 404)

  const row = {
    wallet_address: wallet,
    x_handle: (profile.x_handle as string | null) ?? null,
    display_name: (profile.username as string | null) ?? null,
    title: badge.title.trim(),
    description: badge.description?.trim() ?? '',
    image: badge.image,
  }
  const { data, error } = await sb
    .from('manual_awarded_badges')
    .insert(row)
    .select('id, wallet_address, x_handle, display_name, title, description, image, awarded_at')
    .single()
  if (error) throw new TournamentError(error.message, 500)
  return rowToManualBadge(data as Record<string, unknown>)
}

/** The most recently hand-granted standalone badges, newest first (for undo). */
export async function listRecentManualBadges(limit = 25): Promise<ManualBadgeAward[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('manual_awarded_badges')
    .select('id, wallet_address, x_handle, display_name, title, description, image, awarded_at')
    .order('awarded_at', { ascending: false })
    .limit(limit)
  if (error) throw new TournamentError(error.message, 500)
  return (data ?? []).map((r) => rowToManualBadge(r as Record<string, unknown>))
}

/** Revoke a single hand-granted badge by id. */
export async function revokeManualBadge(id: string): Promise<void> {
  if (!id) throw new TournamentError('Missing badge id.', 400)
  const sb = getServiceClient()
  const { error } = await sb.from('manual_awarded_badges').delete().eq('id', id)
  if (error) throw new TournamentError(error.message, 500)
}
