import type { Match, Player, StandingRow } from './types'

// ─────────────────────────────────────────────────────────────────────────
// Pairing engine - pure functions, no DB. Given the current players and the
// history of matches, produce the next round's pairings. Two formats:
//
//   swiss        - fixed number of rounds, nobody eliminated. Pair players of
//                  similar score, never repeat a pairing, give the bye to the
//                  lowest-ranked still-unpaired player who hasn't had one.
//   single-elim  - only winners advance; seeds meet in standard bracket order
//                  with byes for the top seeds when N isn't a power of two.
//
// A "pairing" is a tuple [player1Id, player2Id|null]; null player2 = a bye
// (player1 advances automatically, recorded as a 'bye' match / free win).
// ─────────────────────────────────────────────────────────────────────────

export type Pairing = [string, string | null]

const POINTS_WIN = 3
const POINTS_DRAW = 1

/** Recommended Swiss round count for a field of N players (ceil(log2 N), min 3). */
export function recommendedSwissRounds(playerCount: number): number {
  if (playerCount <= 1) return 1
  return Math.max(3, Math.ceil(Math.log2(playerCount)))
}

/** Smallest power of two >= n. */
function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

// ── Standings ────────────────────────────────────────────────────────────--

/**
 * Compute standings from the full match history. Match points use the Swiss
 * convention (win 3 / draw 1 / loss 0). Opponent-win-% (OMW) is the standard
 * Swiss tiebreak: the average match-win-rate of everyone you played, floored
 * at 1/3 per opponent so a player isn't punished for facing someone who later
 * dropped (mirrors real TCG software).
 */
export function computeStandings(players: Player[], matches: Match[]): StandingRow[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const wins = new Map<string, number>()
  const losses = new Map<string, number>()
  const draws = new Map<string, number>()
  const opponents = new Map<string, string[]>()
  const games = new Map<string, number>() // decided matches (excl. byes)
  const gameWins = new Map<string, number>() // wins in decided matches only
  const gameDraws = new Map<string, number>() // draws in decided matches only

  for (const p of players) {
    wins.set(p.id, 0)
    losses.set(p.id, 0)
    draws.set(p.id, 0)
    opponents.set(p.id, [])
    games.set(p.id, 0)
    gameWins.set(p.id, 0)
    gameDraws.set(p.id, 0)
  }

  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)

  for (const match of matches) {
    // Only resolved matches count toward the record.
    if (match.status === 'bye') {
      // Bye = a free win, but doesn't add an opponent for tiebreaks.
      inc(wins, match.player1Id)
      continue
    }
    if (match.status !== 'confirmed') continue
    const p1 = match.player1Id
    const p2 = match.player2Id
    if (!p2) {
      inc(wins, p1)
      continue
    }
    opponents.get(p1)?.push(p2)
    opponents.get(p2)?.push(p1)
    inc(games, p1)
    inc(games, p2)
    if (match.winnerId === p1) {
      inc(wins, p1)
      inc(gameWins, p1)
      inc(losses, p2)
    } else if (match.winnerId === p2) {
      inc(wins, p2)
      inc(gameWins, p2)
      inc(losses, p1)
    } else {
      inc(draws, p1)
      inc(draws, p2)
      inc(gameDraws, p1)
      inc(gameDraws, p2)
    }
  }

  const matchWinRate = (id: string): number => {
    const w = gameWins.get(id) ?? 0
    const d = gameDraws.get(id) ?? 0
    const total = games.get(id) ?? 0 // byes excluded from the rate
    if (total <= 0) return 1 / 3
    const rate = (w * POINTS_WIN + d * POINTS_DRAW) / (total * POINTS_WIN)
    return Math.max(rate, 1 / 3)
  }

  const rows: StandingRow[] = players.map((p) => {
    const w = wins.get(p.id) ?? 0
    const l = losses.get(p.id) ?? 0
    const d = draws.get(p.id) ?? 0
    const opps = opponents.get(p.id) ?? []
    const oppWinPct = opps.length
      ? opps.reduce((s, o) => s + matchWinRate(o), 0) / opps.length
      : 0
    return {
      playerId: p.id,
      displayName: byId.get(p.id)?.displayName ?? '-',
      dropped: p.dropped,
      wins: w,
      losses: l,
      draws: d,
      points: w * POINTS_WIN + d * POINTS_DRAW,
      oppWinPct,
      rank: 0,
    }
  })

  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.oppWinPct - a.oppWinPct ||
      b.wins - a.wins ||
      a.displayName.localeCompare(b.displayName),
  )
  rows.forEach((r, i) => (r.rank = i + 1))
  return rows
}

// ── Swiss pairing ──────────────────────────────────────────────────────────

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

/**
 * Build the set of pairings already played (so Swiss never repeats one) and
 * the set of players who have already received a bye.
 */
function history(matches: Match[]): { played: Set<string>; hadBye: Set<string> } {
  const played = new Set<string>()
  const hadBye = new Set<string>()
  for (const m of matches) {
    if (m.player2Id) played.add(pairKey(m.player1Id, m.player2Id))
    else hadBye.add(m.player1Id)
  }
  return { played, hadBye }
}

/**
 * Greedy Swiss pairing within score brackets. Players are ranked by standings;
 * we walk top→bottom, pairing each unpaired player with the next available
 * opponent they haven't faced. Falls back to allowing a rematch only if no
 * legal pairing exists (rare, tiny fields). The lowest-ranked leftover who
 * hasn't had a bye gets the bye.
 */
export function pairSwiss(players: Player[], matches: Match[]): Pairing[] {
  const active = players.filter((p) => !p.dropped)
  const standings = computeStandings(active, matches)
  const order = standings.map((s) => s.playerId)
  const { played, hadBye } = history(matches)

  const pairings: Pairing[] = []
  const used = new Set<string>()

  // Assign the bye first if the field is odd: lowest-ranked player without one.
  if (order.length % 2 === 1) {
    let byePlayer: string | null = null
    for (let i = order.length - 1; i >= 0; i--) {
      if (!hadBye.has(order[i])) {
        byePlayer = order[i]
        break
      }
    }
    if (byePlayer == null) byePlayer = order[order.length - 1] // everyone had one
    used.add(byePlayer)
    pairings.push([byePlayer, null])
  }

  for (let i = 0; i < order.length; i++) {
    const a = order[i]
    if (used.has(a)) continue
    used.add(a)
    // Find the best opponent: nearest in standings not yet faced.
    let opponent: string | null = null
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]
      if (used.has(b)) continue
      if (played.has(pairKey(a, b))) continue
      opponent = b
      break
    }
    // No fresh opponent? allow the nearest rematch as a last resort.
    if (opponent == null) {
      for (let j = i + 1; j < order.length; j++) {
        const b = order[j]
        if (!used.has(b)) {
          opponent = b
          break
        }
      }
    }
    if (opponent != null) {
      used.add(opponent)
      pairings.push([a, opponent])
    }
  }
  return pairings
}

// ── Single-elimination pairing ───────────────────────────────────────────--

/**
 * Standard seeded bracket order for a power-of-two size. Returns an array of
 * seed positions (1-based) arranged so 1 meets the lowest seed, 2 the next,
 * etc., with proper recursive interleaving (1v8,4v5,3v6,2v7 for 8, etc.).
 */
function seededBracketOrder(size: number): number[] {
  let rounds: number[] = [1, 2]
  while (rounds.length < size) {
    const next: number[] = []
    const sum = rounds.length * 2 + 1
    for (const s of rounds) {
      next.push(s)
      next.push(sum - s)
    }
    rounds = next
  }
  return rounds
}

/**
 * First-round single-elim pairings from seeds. Players ordered by seed (1 =
 * top). When N isn't a power of two, the top seeds get byes (their slot is
 * paired against an empty slot → recorded as a bye match).
 */
export function pairSingleElimFirstRound(players: Player[]): Pairing[] {
  const active = [...players]
    .filter((p) => !p.dropped)
    .sort((a, b) => (a.seed ?? 9999) - (b.seed ?? 9999))
  const n = active.length
  if (n === 0) return []
  const size = nextPow2(n)
  const order = seededBracketOrder(size) // seed positions, 1-based

  const pairings: Pairing[] = []
  for (let i = 0; i < order.length; i += 2) {
    const seedA = order[i]
    const seedB = order[i + 1]
    const a = active[seedA - 1] ?? null
    const b = active[seedB - 1] ?? null
    if (a && b) pairings.push([a.id, b.id])
    else if (a && !b) pairings.push([a.id, null]) // top seed bye
    else if (!a && b) pairings.push([b.id, null])
    // both empty → skip
  }
  return pairings
}

/**
 * Advance a single-elim bracket: take the winners of the just-completed round
 * (in match order) and pair them sequentially. An odd winner count yields one
 * bye. Returns null when only one player remains (tournament is over).
 */
export function pairSingleElimNext(prevRoundMatches: Match[]): Pairing[] | null {
  const ordered = [...prevRoundMatches].sort((a, b) => a.number - b.number)
  const advancers: string[] = []
  for (const m of ordered) {
    if (m.status === 'bye') advancers.push(m.player1Id)
    else if (m.winnerId) advancers.push(m.winnerId)
  }
  if (advancers.length <= 1) return null
  const pairings: Pairing[] = []
  for (let i = 0; i < advancers.length; i += 2) {
    const a = advancers[i]
    const b = advancers[i + 1] ?? null
    pairings.push([a, b])
  }
  return pairings
}
