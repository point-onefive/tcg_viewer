import type { Match, Player, StandingRow } from './types'
import type { Region } from './region'

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
/** Match result from one player's perspective (byes are tracked separately). */
export type HeadToHeadResult = 'win' | 'loss' | 'draw'

/**
 * Per-match tallies shared by the standings ranker and the transparency
 * breakdown, so both read from the exact same numbers.
 */
interface MatchTally {
  wins: Map<string, number>
  losses: Map<string, number>
  draws: Map<string, number>
  byes: Map<string, number>
  opponents: Map<string, string[]>
  results: Map<string, { opponentId: string; result: HeadToHeadResult }[]>
  games: Map<string, number> // decided matches (excl. byes)
  gameWins: Map<string, number> // wins in decided matches only
  gameDraws: Map<string, number> // draws in decided matches only
}

function tallyMatches(players: Player[], matches: Match[]): MatchTally {
  const t: MatchTally = {
    wins: new Map(),
    losses: new Map(),
    draws: new Map(),
    byes: new Map(),
    opponents: new Map(),
    results: new Map(),
    games: new Map(),
    gameWins: new Map(),
    gameDraws: new Map(),
  }
  for (const p of players) {
    t.wins.set(p.id, 0)
    t.losses.set(p.id, 0)
    t.draws.set(p.id, 0)
    t.byes.set(p.id, 0)
    t.opponents.set(p.id, [])
    t.results.set(p.id, [])
    t.games.set(p.id, 0)
    t.gameWins.set(p.id, 0)
    t.gameDraws.set(p.id, 0)
  }

  const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by)
  const rec = (id: string, opponentId: string, result: HeadToHeadResult) =>
    t.results.get(id)?.push({ opponentId, result })

  for (const match of matches) {
    // Only resolved matches count toward the record.
    if (match.status === 'bye') {
      // Bye = a free win, but doesn't add an opponent for tiebreaks.
      inc(t.wins, match.player1Id)
      inc(t.byes, match.player1Id)
      continue
    }
    // Double forfeit (hard-deadline no-show by both players): a loss for BOTH,
    // counted as a played game with zero game-wins so it correctly drags each
    // player's match-win-rate. Never a draw - that would reward stalling.
    if (match.status === 'double_forfeit') {
      const a = match.player1Id
      const b = match.player2Id
      if (!b) {
        inc(t.losses, a)
        inc(t.games, a)
        continue
      }
      t.opponents.get(a)?.push(b)
      t.opponents.get(b)?.push(a)
      inc(t.games, a)
      inc(t.games, b)
      inc(t.losses, a)
      inc(t.losses, b)
      rec(a, b, 'loss')
      rec(b, a, 'loss')
      continue
    }
    if (match.status !== 'confirmed') continue
    const p1 = match.player1Id
    const p2 = match.player2Id
    if (!p2) {
      inc(t.wins, p1)
      inc(t.byes, p1)
      continue
    }
    t.opponents.get(p1)?.push(p2)
    t.opponents.get(p2)?.push(p1)
    inc(t.games, p1)
    inc(t.games, p2)
    if (match.winnerId === p1) {
      inc(t.wins, p1)
      inc(t.gameWins, p1)
      inc(t.losses, p2)
      rec(p1, p2, 'win')
      rec(p2, p1, 'loss')
    } else if (match.winnerId === p2) {
      inc(t.wins, p2)
      inc(t.gameWins, p2)
      inc(t.losses, p1)
      rec(p2, p1, 'win')
      rec(p1, p2, 'loss')
    } else {
      inc(t.draws, p1)
      inc(t.draws, p2)
      inc(t.gameDraws, p1)
      inc(t.gameDraws, p2)
      rec(p1, p2, 'draw')
      rec(p2, p1, 'draw')
    }
  }
  return t
}

/** Match-win-rate for one player, floored at 1/3 (as fed into opponents' OMW). */
function makeMatchWinRate(t: MatchTally) {
  return (id: string): number => {
    const w = t.gameWins.get(id) ?? 0
    const d = t.gameDraws.get(id) ?? 0
    const total = t.games.get(id) ?? 0 // byes excluded from the rate
    if (total <= 0) return 1 / 3
    const rate = (w * POINTS_WIN + d * POINTS_DRAW) / (total * POINTS_WIN)
    return Math.max(rate, 1 / 3)
  }
}

/** OMW map: each player's average opponent match-win-rate. */
function computeOmw(players: Player[], t: MatchTally, matchWinRate: (id: string) => number) {
  const omw = new Map<string, number>()
  for (const p of players) {
    const opps = t.opponents.get(p.id) ?? []
    omw.set(p.id, opps.length ? opps.reduce((s, o) => s + matchWinRate(o), 0) / opps.length : 0)
  }
  return omw
}

/**
 * Per-player transparency breakdown: the exact opponents faced, each opponent's
 * match-win-rate as counted toward OMW, and the resulting OMW/OOMW. Uses the
 * same tally as computeStandings so the figures always match the ranking.
 */
export interface OpponentBreakdown {
  opponentId: string
  result: HeadToHeadResult
  matchWinRate: number
}
export interface StandingBreakdown {
  opponents: OpponentBreakdown[]
  byes: number
  omw: number
  oomw: number
}
export function computeStandingsBreakdown(players: Player[], matches: Match[]): Map<string, StandingBreakdown> {
  const t = tallyMatches(players, matches)
  const matchWinRate = makeMatchWinRate(t)
  const omw = computeOmw(players, t, matchWinRate)
  const oomwOf = (id: string): number => {
    const opps = t.opponents.get(id) ?? []
    return opps.length ? opps.reduce((s, o) => s + Math.max(omw.get(o) ?? 1 / 3, 1 / 3), 0) / opps.length : 0
  }
  const out = new Map<string, StandingBreakdown>()
  for (const p of players) {
    const results = t.results.get(p.id) ?? []
    out.set(p.id, {
      opponents: results.map((r) => ({
        opponentId: r.opponentId,
        result: r.result,
        matchWinRate: matchWinRate(r.opponentId),
      })),
      byes: t.byes.get(p.id) ?? 0,
      omw: omw.get(p.id) ?? 0,
      oomw: oomwOf(p.id),
    })
  }
  return out
}

export function computeStandings(players: Player[], matches: Match[]): StandingRow[] {
  const byId = new Map(players.map((p) => [p.id, p]))
  const t = tallyMatches(players, matches)
  const wins = t.wins
  const losses = t.losses
  const draws = t.draws
  const matchWinRate = makeMatchWinRate(t)

  // OMW (opponent match-win %): average of each opponent's match-win-rate.
  const omw = computeOmw(players, t, matchWinRate)
  // OOMW (opponents' opponents' win %): the deeper strength-of-schedule tiebreak
  // used by standard TCG software. Floor each opponent's OMW at 1/3 (mirrors the
  // match-win-rate floor) so facing someone who later collapsed isn't punishing.
  const oomw = (id: string): number => {
    const opps = t.opponents.get(id) ?? []
    return opps.length ? opps.reduce((s, o) => s + Math.max(omw.get(o) ?? 1 / 3, 1 / 3), 0) / opps.length : 0
  }

  // Fully deterministic final tiebreak for players who are dead-even on every
  // MERIT tiebreak: order by seed (ascending; unseeded last), then by wallet
  // address (ascending, case-insensitive). This is arbitrary-but-stable, NOT a
  // merit signal, so it only fixes the DISPLAY order - the `tied` flag below
  // still marks these players so a paid game never auto-awards a differing
  // prize across a real tie (paidWinnerAddresses defers those to manual settle).
  const finalTiebreak = (aId: string, bId: string): number => {
    const pa = byId.get(aId)
    const pb = byId.get(bId)
    const sa = pa?.seed ?? Number.MAX_SAFE_INTEGER
    const sb = pb?.seed ?? Number.MAX_SAFE_INTEGER
    if (sa !== sb) return sa - sb
    const wa = (pa?.walletAddress ?? '').toLowerCase()
    const wb = (pb?.walletAddress ?? '').toLowerCase()
    return wa < wb ? -1 : wa > wb ? 1 : 0
  }

  // Head-to-head wins counted only within a given set of players (a tie group),
  // so it stays transitive when sorting (we rank by the count, not by pairwise
  // results that could cycle).
  const headToHeadWins = (id: string, group: Set<string>): number => {
    let w = 0
    for (const m of matches) {
      if (m.status !== 'confirmed' || m.winnerId !== id) continue
      const opp = m.player1Id === id ? m.player2Id : m.player2Id === id ? m.player1Id : null
      if (opp && group.has(opp)) w++
    }
    return w
  }

  const rows: StandingRow[] = players.map((p) => {
    const w = wins.get(p.id) ?? 0
    const l = losses.get(p.id) ?? 0
    const d = draws.get(p.id) ?? 0
    return {
      playerId: p.id,
      displayName: byId.get(p.id)?.displayName ?? '-',
      dropped: p.dropped,
      wins: w,
      losses: l,
      draws: d,
      points: w * POINTS_WIN + d * POINTS_DRAW,
      oppWinPct: omw.get(p.id) ?? 0,
      oppOppWinPct: oomw(p.id),
      rank: 0,
      tied: false,
      tieGroup: null,
    }
  })

  const approxEq = (a: number, b: number) => Math.abs(a - b) < 1e-9
  const played = (r: StandingRow) => r.wins + r.losses + r.draws > 0

  // Primary order by match points, then OMW. Stable sort keeps the input order
  // (signup order) for anything still equal, which we then refine on merit.
  rows.sort((a, b) => b.points - a.points || b.oppWinPct - a.oppWinPct)

  // Refine each (points, OMW) cluster with merit tiebreakers only:
  //   head-to-head (within the cluster) -> OOMW -> total wins.
  // Anyone still dead-equal after all of those is flagged `tied` (never broken
  // by name) so an award can't be handed out on a non-merit basis.
  let groupCounter = 0
  let i = 0
  while (i < rows.length) {
    let j = i + 1
    while (j < rows.length && rows[j].points === rows[i].points && approxEq(rows[j].oppWinPct, rows[i].oppWinPct)) j++
    if (j - i > 1) {
      const cluster = rows.slice(i, j)
      const ids = new Set(cluster.map((r) => r.playerId))
      const h2h = new Map(cluster.map((r) => [r.playerId, headToHeadWins(r.playerId, ids)]))
      cluster.sort(
        (a, b) =>
          (h2h.get(b.playerId) ?? 0) - (h2h.get(a.playerId) ?? 0) ||
          b.oppOppWinPct - a.oppOppWinPct ||
          b.wins - a.wins ||
          finalTiebreak(a.playerId, b.playerId),
      )
      for (let k = 0; k < cluster.length; k++) rows[i + k] = cluster[k]
      // Flag runs that remain exactly equal on every merit tiebreaker.
      let k = 0
      while (k < cluster.length) {
        let l = k + 1
        while (
          l < cluster.length &&
          h2h.get(cluster[l].playerId) === h2h.get(cluster[k].playerId) &&
          approxEq(cluster[l].oppOppWinPct, cluster[k].oppOppWinPct) &&
          cluster[l].wins === cluster[k].wins
        )
          l++
        const tiedRun = cluster.slice(k, l).filter(played)
        if (tiedRun.length > 1) {
          groupCounter++
          for (const r of tiedRun) {
            r.tied = true
            r.tieGroup = groupCounter
          }
        }
        k = l
      }
    }
    i = j
  }

  rows.forEach((r, idx) => (r.rank = idx + 1))
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
 * Find a rematch-free perfect matching of `order` (players in standings order),
 * preferring opponents nearest in the standings. Returns null when NO pairing
 * without a rematch exists for this set.
 *
 * This is a depth-first search that pairs the highest unpaired player with the
 * nearest legal (not-yet-faced) opponent, then recurses; if the rest can't be
 * matched it backtracks and tries the next-nearest opponent. Because we always
 * try the nearest opponent first, the first solution found is also the most
 * "score-bracketed" one - so we keep the greedy's pairing quality while gaining
 * the guarantee that a rematch is never forced when one is avoidable.
 *
 * `budget` caps the search so a pathological field can't hang the request; if
 * it's exhausted we give up (caller falls back to the rematch-tolerant greedy).
 */
function matchNoRepeat(
  order: string[],
  played: Set<string>,
  budget: { steps: number },
  region?: RegionPref,
): Pairing[] | null {
  if (order.length === 0) return []
  if (budget.steps-- <= 0) return null
  const a = order[0]
  const rest = order.slice(1)
  // Candidate iteration order. Default = nearest-in-standings first (the rest
  // array is already in standings order). When a region preference is active we
  // reorder candidates so that, WITHIN the same score bracket (equal points), a
  // same-region opponent is tried before a cross-region one. Tiers are strictly
  // points-first, so this never pulls a pairing out of its score bracket - it
  // only breaks ties inside it, keeping full Swiss integrity.
  const indices = region
    ? rest
        .map((_, i) => i)
        .sort((i, j) => regionTier(a, rest[i], region) - regionTier(a, rest[j], region) || i - j)
    : rest.map((_, i) => i)
  for (const i of indices) {
    const b = rest[i]
    if (played.has(pairKey(a, b))) continue
    const remaining = rest.slice(0, i).concat(rest.slice(i + 1))
    const sub = matchNoRepeat(remaining, played, budget, region)
    if (sub) return [[a, b], ...sub]
  }
  return null
}

/** Region preference inputs: per-player points + region, only when meaningful. */
interface RegionPref {
  points: Map<string, number>
  region: Map<string, Region | null>
}

/**
 * Tier for candidate `b` relative to player `a` (lower = preferred):
 *   0 = same score bracket AND same (known) region
 *   1 = same score bracket
 *   2 = different score bracket
 * Used only to break ties inside a bracket, so cross-bracket order is unchanged.
 */
function regionTier(a: string, b: string, pref: RegionPref): number {
  const samePoints = (pref.points.get(a) ?? 0) === (pref.points.get(b) ?? 0)
  if (!samePoints) return 2
  const ra = pref.region.get(a) ?? null
  const rb = pref.region.get(b) ?? null
  return ra && rb && ra === rb ? 0 : 1
}

/**
 * Rematch-tolerant greedy fallback: pairs each unpaired player (top→bottom)
 * with the nearest remaining opponent, allowing a rematch. Only used when no
 * rematch-free matching exists (e.g. a 2-player field over 3 rounds), so the
 * round can still be generated rather than stalling.
 */
function greedyAllowRematch(order: string[]): Pairing[] {
  const pairings: Pairing[] = []
  const used = new Set<string>()
  for (let i = 0; i < order.length; i++) {
    const a = order[i]
    if (used.has(a)) continue
    used.add(a)
    for (let j = i + 1; j < order.length; j++) {
      const b = order[j]
      if (used.has(b)) continue
      used.add(b)
      pairings.push([a, b])
      break
    }
  }
  return pairings
}

/**
 * Swiss pairing within score brackets. Players are ranked by standings; the
 * lowest-ranked player without a bye gets the bye when the field is odd, and
 * the rest are matched so that a previously-played pairing is NEVER repeated
 * unless no rematch-free pairing exists at all (only possible when the field is
 * smaller than the round count, e.g. 2 players over 3 rounds). We try the
 * nearest-in-standings opponent first, so pairings stay tightly score-bracketed.
 */
export function pairSwiss(players: Player[], matches: Match[]): Pairing[] {
  // Exclude dropped AND rejected players. Round 1 is seeded from approved-only,
  // but later rounds receive the full roster, so a rejected sign-up would
  // otherwise leak into the field (and grab a bye as the unranked odd one out).
  const active = players.filter((p) => !p.dropped && p.approvalStatus !== 'rejected')
  // Round 1 has no results, so computeStandings would tie everyone on 0 points
  // and fall through to its name tiebreak - making round-1 pairings alphabetical
  // and giving repeat entrants the same first-round opponent every event. Use the
  // randomly-assigned seed order for round 1 instead, so it is genuinely random.
  // From round 2 on there are real results to rank by, so standings drive it.
  const isFirstRound = matches.length === 0
  const standings = isFirstRound ? null : computeStandings(active, matches)
  const order = isFirstRound
    ? [...active]
        .sort((a, b) => (a.seed ?? Number.MAX_SAFE_INTEGER) - (b.seed ?? Number.MAX_SAFE_INTEGER))
        .map((p) => p.id)
    : standings!.map((s) => s.playerId)
  const { played, hadBye } = history(matches)

  // Soft same-region preference: a no-op unless at least two DISTINCT known
  // regions are present in the field (so a single-region or all-unspecified
  // field - e.g. every current player - pairs exactly as before). It only ever
  // reorders opponents inside a score bracket, never across brackets.
  const distinctRegions = new Set(
    active.map((p) => p.region).filter((r): r is Region => r != null),
  )
  let regionPref: RegionPref | undefined
  if (distinctRegions.size >= 2) {
    const points = new Map<string, number>()
    if (standings) for (const s of standings) points.set(s.playerId, s.points)
    // Round 1 has no results: leave points empty (all default to 0), so the
    // whole field is one bracket and the preference simply favors same-region
    // opponents within the random seed order.
    const region = new Map<string, Region | null>(active.map((p) => [p.id, p.region]))
    regionPref = { points, region }
  }

  const pairings: Pairing[] = []

  // Assign the bye first if the field is odd: lowest-ranked player without one.
  let toPair = order
  if (order.length % 2 === 1) {
    let byePlayer: string | null = null
    for (let i = order.length - 1; i >= 0; i--) {
      if (!hadBye.has(order[i])) {
        byePlayer = order[i]
        break
      }
    }
    if (byePlayer == null) byePlayer = order[order.length - 1] // everyone had one
    pairings.push([byePlayer, null])
    toPair = order.filter((id) => id !== byePlayer)
  }

  // Prefer a matching with no rematches; fall back to the rematch-tolerant
  // greedy only when one genuinely doesn't exist (tiny fields).
  const noRepeat = matchNoRepeat(toPair, played, { steps: 200_000 }, regionPref)
  const rest = noRepeat ?? greedyAllowRematch(toPair)
  pairings.push(...rest)
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
    .filter((p) => !p.dropped && p.approvalStatus !== 'rejected')
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
