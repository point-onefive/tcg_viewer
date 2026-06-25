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
  TournamentPrize,
  TournamentSnapshot,
  AwardedPrize,
} from './types'
import { formatXLabel, isValidXHandle, normalizeXHandle } from './x-handle'
import { validateDeckList } from './deck-list'
import { extractLeader } from './leader'
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

export async function enroll(
  code: string,
  xHandleRaw: string,
  deckListRaw?: string | null,
  walletAddress?: string | null,
): Promise<EnrollResult> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError('Sign-ups are closed for this tournament.')
  }
  if (row.enroll_closes_at && new Date(row.enroll_closes_at) <= new Date()) {
    throw new TournamentError('The sign-up window has ended.')
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
  const activeSignups = players.filter((p) => p.approvalStatus !== 'rejected')
  if (activeSignups.length >= cap) {
    throw new TournamentError('This tournament is full.')
  }
  if (players.some((p) => p.xHandle === xHandle && p.approvalStatus !== 'rejected')) {
    throw new TournamentError('That X handle is already registered.')
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
      player_token_hash: hashToken(playerToken),
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new TournamentError(`Could not sign up: ${error?.message ?? 'unknown'}`, 500)
  }
  return { player: rowToPlayer(data), playerToken }
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
  const players = await fetchPlayers(row.id)
  const active = players.filter(
    (p) => !p.dropped && p.approvalStatus === 'approved',
  )
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

  const tournament = rowToTournament(await fetchTournamentRowByCode(row.code))
  const pairings =
    row.format === 'swiss'
      ? pairSwiss(seededPlayers, [])
      : pairSingleElimFirstRound(seededPlayers)

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

  const { error: upErr } = await sb
    .from('matches')
    .update({
      status: 'confirmed',
      winner_id: winnerId,
      player1_report: result === 'draw' ? 'draw' : result === 'p1' ? 'win' : 'loss',
      player2_report: result === 'draw' ? 'draw' : result === 'p2' ? 'win' : 'loss',
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

export async function dropSelf(code: string, playerToken: string): Promise<void> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByToken(row.id, playerToken)
  if (!player) throw new TournamentError('Not authorized (invalid player token).', 403)
  await sb.from('players').update({ dropped: true }).eq('id', player.id)
}

export async function hostDropPlayer(
  code: string,
  hostToken: string,
  playerId: string,
): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  assertHostToken(row, hostToken)
  await sb
    .from('players')
    .update({ dropped: true })
    .eq('id', playerId)
    .eq('tournament_id', row.id)
}

// ── Round advancement ──────────────────────────────────────────────────────

/** True when every match in the round is resolved (confirmed or bye). */
function roundFullyResolved(matches: Match[]): boolean {
  return matches.length > 0 && matches.every((m) => m.status === 'confirmed' || m.status === 'bye')
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
  const assignments: PrizeAssignment[] = []
  prizes.forEach((_, i) => {
    const winner = standings[i]
    if (winner) assignments.push({ slotIndex: i, playerIds: [winner.playerId] })
  })
  if (assignments.length === 0) return
  await persistAwardedPrizes(tournamentId, prizes, assignments)
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

  // Mark the round complete.
  await sb.from('rounds').update({ status: 'complete' }).eq('id', current.id)

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
  const totalRounds = tournament.swissRounds ?? recommendedSwissRounds(players.filter((p) => !p.dropped).length)
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

// ── Snapshot (public read) ──────────────────────────────────────────────--

export async function getSnapshotByCode(code: string): Promise<TournamentSnapshot> {
  const row = await fetchTournamentRowByCode(code)
  const tournament = rowToTournament(row)
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
  // list and expose it ALWAYS. The Leader is public during play (it is on the
  // table and the metagame is tracked by it), so revealing it never leaks the
  // hidden 50-card list.
  //
  // Deck contents themselves are private WHILE the event runs (host + the
  // owning player only): the snapshot is public and cached, so stripping the
  // text keeps opponents from pre-match meta-gaming. Standard tournament
  // etiquette is closed lists during play, published once the event concludes
  // - so once the tournament is `complete` we expose the full lists as a
  // public metagame archive. `hasDeckList` signals submitted/missing in any
  // phase.
  const decksPublic = tournament.status === 'complete'
  const withLeader = (p: Player): Player => {
    const leader = extractLeader(p.deckList)
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
  return {
    tournament,
    players: publicPlayers,
    rounds,
    matches,
    proposals,
    standings,
    poll,
    awardedPrizes,
  }
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
    .select('tournament_id, x_handle, display_name, final_rank, dropped, approval_status')
    .in('tournament_id', ids)

  const counts = new Map<string, number>()
  const champions = new Map<string, { xHandle: string; displayName: string }>()
  for (const p of pRows ?? []) {
    const tid = p.tournament_id as string
    const rejected = (p.approval_status ?? 'approved') === 'rejected'
    if (!rejected) counts.set(tid, (counts.get(tid) ?? 0) + 1)
    if ((p.final_rank ?? null) === 1 && !champions.has(tid)) {
      champions.set(tid, {
        xHandle: (p.x_handle as string) ?? '',
        displayName: (p.display_name as string) ?? '',
      })
    }
  }

  return tournaments.map((t) => ({
    code: t.code as string,
    name: t.name as string,
    format: t.format as TournamentFormat,
    createdAt: t.created_at as string,
    playerCount: counts.get(t.id as string) ?? 0,
    champion: champions.get(t.id as string) ?? null,
  }))
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
}): Promise<{ code: string }> {
  const sb = getServiceClient()
  const name = input.name?.trim()
  if (!name) throw new TournamentError('Tournament name is required.')
  const format: TournamentFormat = input.format === 'single-elim' ? 'single-elim' : 'swiss'

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

export async function adminApprovePlayer(code: string, playerId: string): Promise<void> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  await sb
    .from('players')
    .update({ approval_status: 'approved' })
    .eq('id', playerId)
    .eq('tournament_id', row.id)
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
 * Operator override of a player's deck list. Allowed only before the bracket
 * is generated (status 'enrolling'), so it doubles as the typo-fix escape
 * hatch and the way to record a walk-in's list. Once the bracket starts, lists
 * are frozen for everyone.
 */
export async function adminSetDeck(
  code: string,
  playerId: string,
  deckListRaw: string,
): Promise<{ deckList: string }> {
  const sb = getServiceClient()
  const row = await requireHost(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError('Deck lists are locked once the bracket has started.')
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

/** Operator read of one player's full deck list (host-gated, on demand). */
export async function adminGetDeck(
  code: string,
  playerId: string,
): Promise<{ deckList: string | null }> {
  const row = await requireHost(code)
  const players = await fetchPlayers(row.id)
  const player = players.find((p) => p.id === playerId)
  if (!player) throw new TournamentError('Player not found.', 404)
  return { deckList: player.deckList }
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
    .select('id')
  return data?.length ?? 0
}

/** Close sign-ups and generate round 1 from approved players only. */
export async function adminStartBracket(code: string): Promise<void> {
  const row = await requireHost(code)
  await generateFirstRound(row)
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
 *  1. Auto-close enrollment for tournaments whose enroll timer elapsed.
 *  2. Auto-confirm single-sided reports past the confirmation window
 *     (this is the "loser ghosts → winner still advances" guarantee).
 *  3. Advance any round that became fully resolved as a result.
 * Returns a small summary for logging.
 */
export async function sweep(): Promise<{
  enrollmentsClosed: number
  reportsConfirmed: number
  tournamentsAdvanced: number
}> {
  const sb = getServiceClient()
  let reportsConfirmed = 0
  const advanced = new Set<string>()

  // Sign-up timers do NOT auto-start brackets - you approve handles and start
  // manually via adminStartBracket. Cron only resolves ghosted reports and
  // advances fully-completed rounds.
  const cutoff = addMinutes(nowIso(), -CONFIRM_WINDOW_MINUTES)
  const { data: stale } = await sb
    .from('matches')
    .select('*')
    .eq('status', 'reported')
    .lte('reported_at', cutoff)
  for (const mRow of stale ?? []) {
    const match = rowToMatch(mRow)
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

  return {
    enrollmentsClosed: 0,
    reportsConfirmed,
    tournamentsAdvanced: advanced.size,
  }
}
