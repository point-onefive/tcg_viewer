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
  CreateTournamentInput,
  CreateTournamentResult,
  EnrollResult,
  Match,
  Player,
  ReportedResult,
  Round,
  Tournament,
  TournamentSnapshot,
} from './types'

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

// ── Enroll ─────────────────────────────────────────────────────────────────

export async function enroll(
  code: string,
  displayName: string,
  discordHandle?: string | null,
): Promise<EnrollResult> {
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  if (row.status !== 'enrolling') {
    throw new TournamentError('Enrollment for this tournament is closed.')
  }
  if (row.enroll_closes_at && new Date(row.enroll_closes_at) <= new Date()) {
    throw new TournamentError('The enrollment window has ended.')
  }
  const name = displayName?.trim()
  if (!name) throw new TournamentError('A display name is required to enroll.')

  const players = await fetchPlayers(row.id)
  if (players.length >= MAX_PLAYERS) {
    throw new TournamentError('This tournament is full.')
  }
  if (players.some((p) => p.displayName.toLowerCase() === name.toLowerCase())) {
    throw new TournamentError('That display name is already taken in this tournament.')
  }

  const playerToken = generateToken()
  const { data, error } = await sb
    .from('players')
    .insert({
      tournament_id: row.id,
      display_name: name,
      discord_handle: discordHandle?.trim() || null,
      player_token_hash: hashToken(playerToken),
    })
    .select('*')
    .single()
  if (error || !data) {
    throw new TournamentError(`Could not enroll: ${error?.message ?? 'unknown'}`, 500)
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
  const active = players.filter((p) => !p.dropped)
  if (active.length < MIN_PLAYERS_TO_START) {
    throw new TournamentError('Need at least 2 players to start.')
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
  const sb = getServiceClient()
  const row = await fetchTournamentRowByCode(code)
  const player = await fetchPlayerByToken(row.id, playerToken)
  if (!player) throw new TournamentError('Not authorized (invalid player token).', 403)

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
      await sb.from('tournaments').update({ status: 'complete' }).eq('id', tournamentId)
      return
    }
    await insertRoundWithMatches(tournament, current.number + 1, next)
    return
  }

  // Swiss
  const totalRounds = tournament.swissRounds ?? recommendedSwissRounds(players.filter((p) => !p.dropped).length)
  if (current.number >= totalRounds) {
    await sb.from('tournaments').update({ status: 'complete' }).eq('id', tournamentId)
    return
  }
  const next = pairSwiss(players, allMatches)
  if (next.length === 0) {
    await sb.from('tournaments').update({ status: 'complete' }).eq('id', tournamentId)
    return
  }
  await insertRoundWithMatches(tournament, current.number + 1, next)
}

// ── Snapshot (public read) ──────────────────────────────────────────────--

export async function getSnapshotByCode(code: string): Promise<TournamentSnapshot> {
  const row = await fetchTournamentRowByCode(code)
  const tournament = rowToTournament(row)
  const [players, rounds, matches] = await Promise.all([
    fetchPlayers(tournament.id),
    fetchRounds(tournament.id),
    fetchMatches(tournament.id),
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
  return { tournament, players, rounds, matches, proposals, standings }
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
  let enrollmentsClosed = 0
  let reportsConfirmed = 0
  const advanced = new Set<string>()

  // 1. Enrollment timers.
  const { data: enrolling } = await sb
    .from('tournaments')
    .select('*')
    .eq('status', 'enrolling')
    .not('enroll_closes_at', 'is', null)
    .lte('enroll_closes_at', nowIso())
  for (const row of enrolling ?? []) {
    try {
      await generateFirstRound(row)
      enrollmentsClosed++
    } catch {
      // Not enough players, etc. — leave it open; host can extend or close.
    }
  }

  // 2. Single-sided reports past the confirm window.
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

  // 3. Advance affected tournaments.
  for (const tid of advanced) {
    try {
      await maybeAdvance(tid)
    } catch {
      /* ignore; next sweep retries */
    }
  }

  return {
    enrollmentsClosed,
    reportsConfirmed,
    tournamentsAdvanced: advanced.size,
  }
}
