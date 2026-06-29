/* eslint-disable no-console */
/**
 * Pure reproduction of the Swiss rematch bug - no DB. Simulates a dominance
 * field (higher skill always wins) using the real pairing.ts + standings, the
 * same way maybeAdvance() drives them, and counts repeated pairings.
 *
 * Run: npx tsx --conditions=react-server scripts/tournament/repro-pairing.ts
 */
import { pairSwiss, computeStandings, recommendedSwissRounds } from '../../src/lib/tournament/pairing'
import type { Match, Player } from '../../src/lib/tournament/types'

function mkPlayers(n: number): Player[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i + 1).padStart(2, '0')}`,
    tournamentId: 't',
    displayName: `@sim_${String(i + 1).padStart(2, '0')}`,
    xHandle: `sim_${String(i + 1).padStart(2, '0')}`,
    approvalStatus: 'approved',
    discordHandle: null,
    walletAddress: null,
    seed: i + 1,
    region: null,
    dropped: false,
    deckList: 'x',
    hasDeckList: true,
    leaderCardId: null,
    leaderName: null,
    leaderImage: null,
    createdAt: new Date(Date.now() + i).toISOString(),
  }))
}

const skill = (id: string) => Number(id.replace('p', ''))
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)

function simulate(n: number): { rounds: number; rematches: number; pairingsPerRound: string[][] } {
  const players = mkPlayers(n)
  const matches: Match[] = []
  const rounds = recommendedSwissRounds(n)
  const seen = new Set<string>()
  let rematches = 0
  const pairingsPerRound: string[][] = []
  let matchNo = 0
  for (let r = 1; r <= rounds; r++) {
    const pairings = pairSwiss(players, matches)
    const desc: string[] = []
    for (const [a, b] of pairings) {
      matchNo++
      if (b == null) {
        matches.push(mkMatch(matchNo, r, a, null, 'bye', a))
        desc.push(`${a}(bye)`)
        continue
      }
      const k = pairKey(a, b)
      if (seen.has(k)) {
        rematches++
        desc.push(`${a}v${b} *REMATCH*`)
      } else {
        desc.push(`${a}v${b}`)
      }
      seen.add(k)
      const winner = skill(a) >= skill(b) ? a : b
      matches.push(mkMatch(matchNo, r, a, b, 'confirmed', winner))
    }
    pairingsPerRound.push(desc)
  }
  return { rounds, rematches, pairingsPerRound }
}

function mkMatch(
  number: number,
  roundNo: number,
  p1: string,
  p2: string | null,
  status: Match['status'],
  winnerId: string | null,
): Match {
  return {
    id: `m${number}`,
    roundId: `r${roundNo}`,
    tournamentId: 't',
    number,
    player1Id: p1,
    player2Id: p2,
    status,
    player1Report: null,
    player2Report: null,
    winnerId,
    scheduledAt: null,
    reportedAt: null,
    resolvedAt: null,
  }
}

let bad = 0
console.log('── Dominance ordering (deterministic) ──')
for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 24, 32, 64, 128, 256]) {
  const t0 = Date.now()
  const { rounds, rematches, pairingsPerRound } = simulate(n)
  const ms = Date.now() - t0
  const avoidable = n - 1 >= rounds // more opponents than rounds => rematch avoidable
  const flag = rematches > 0 && avoidable ? '  <-- AVOIDABLE REMATCH' : ''
  if (rematches > 0 && avoidable) bad++
  console.log(`n=${String(n).padStart(3)} rounds=${rounds} rematches=${rematches} (${ms}ms)${flag}`)
  if (rematches > 0 && avoidable) {
    pairingsPerRound.forEach((p, i) => console.log(`     R${i + 1}: ${p.join('  ')}`))
  }
}

// Randomized outcomes (not just dominance) to exercise different bracket shapes.
console.log('\n── Randomized outcomes (200 trials/size) ──')
function simulateRandom(n: number, seed: number): number {
  let s = seed
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const players = mkPlayers(n)
  const matches: Match[] = []
  const rounds = recommendedSwissRounds(n)
  const seen = new Set<string>()
  let rematches = 0
  let no = 0
  for (let r = 1; r <= rounds; r++) {
    for (const [a, b] of pairSwiss(players, matches)) {
      no++
      if (b == null) {
        matches.push(mkMatch(no, r, a, null, 'bye', a))
        continue
      }
      const k = pairKey(a, b)
      if (seen.has(k)) rematches++
      seen.add(k)
      const winner = rnd() < 0.5 ? a : b
      matches.push(mkMatch(no, r, a, b, 'confirmed', winner))
    }
  }
  return rematches
}
let randBad = 0
for (const n of [4, 5, 6, 7, 8, 9, 11, 13, 16, 24, 32]) {
  const rounds = recommendedSwissRounds(n)
  const avoidable = n - 1 >= rounds
  let worst = 0
  for (let trial = 0; trial < 200; trial++) worst = Math.max(worst, simulateRandom(n, trial * 7 + 1))
  const flag = worst > 0 && avoidable ? '  <-- AVOIDABLE REMATCH' : ''
  if (worst > 0 && avoidable) randBad++
  console.log(`n=${String(n).padStart(3)} rounds=${rounds} worstRematches=${worst}${flag}`)
}

console.log(`\n${bad} dominance + ${randBad} randomized field size(s) with an AVOIDABLE rematch`)
process.exit(bad + randBad === 0 ? 0 : 1)
