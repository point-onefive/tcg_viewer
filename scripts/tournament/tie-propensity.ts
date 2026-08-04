/* eslint-disable no-console */
/**
 * Monte-Carlo estimate of how often a Swiss event's PODIUM (top 3) needs each
 * tiebreaker layer, using the real pairing + standings engine with random match
 * outcomes. Answers: does OMW decide placement most of the time, and how often
 * would we truly need a tiebreaker game?
 *
 * Run: npx tsx scripts/tournament/tie-propensity.ts [trialsPerConfig]
 */
import type { Match, Player } from '../../src/lib/tournament/types'
import { pairSwiss, computeStandings } from '../../src/lib/tournament/pairing'

function mkPlayers(n: number): Player[] {
  // Random seeds 1..n (round 1 ordering); only a few fields are read by the engine.
  const order = [...Array(n).keys()]
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[order[i], order[j]] = [order[j], order[i]]
  }
  return order.map((seedIdx, k) => ({
    id: `p${k}`,
    tournamentId: 't',
    displayName: `p${k}`,
    xHandle: `p${k}`,
    approvalStatus: 'approved',
    discordHandle: null,
    walletAddress: null,
    seed: seedIdx + 1,
    dropped: false,
    deckList: null,
    hasDeckList: false,
    leaderCardId: null,
    leaderName: null,
    leaderImage: null,
    createdAt: new Date().toISOString(),
  })) as unknown as Player[]
}

// Rank purely by points then OMW (no deeper breakers): returns true when the
// top-3 boundaries are each uniquely separated by points+OMW alone.
function podiumSeparatedByOmwOnly(players: Player[], matches: Match[]): boolean {
  const s = computeStandings(players, matches)
  const key = (r: (typeof s)[number]) => [r.points, Math.round(r.oppWinPct * 1e9)].join(':')
  // Sort a copy by points,OMW only and check ranks 1-2 and 2-3 differ in key.
  const byPo = [...s].sort((a, b) => b.points - a.points || b.oppWinPct - a.oppWinPct)
  for (let i = 0; i < 3 && i + 1 < byPo.length; i++) {
    if (key(byPo[i]) === key(byPo[i + 1])) return false
  }
  return true
}

function simOne(n: number, rounds: number) {
  const players = mkPlayers(n)
  const matches: Match[] = []
  let mnum = 0
  for (let r = 0; r < rounds; r++) {
    const pairings = pairSwiss(players, matches)
    for (const [a, b] of pairings) {
      mnum++
      if (b == null) {
        matches.push({ id: `m${mnum}`, roundId: `r${r}`, tournamentId: 't', number: mnum, player1Id: a, player2Id: null, status: 'bye', player1Report: null, player2Report: null, winnerId: a, scheduledAt: null, reportedAt: null, resolvedAt: null, disputeLogUrl: null, disputeLogText: null, disputeLogBy: null, disputeLogAt: null })
      } else {
        const winner = Math.random() < 0.5 ? a : b
        matches.push({ id: `m${mnum}`, roundId: `r${r}`, tournamentId: 't', number: mnum, player1Id: a, player2Id: b, status: 'confirmed', player1Report: null, player2Report: null, winnerId: winner, scheduledAt: null, reportedAt: null, resolvedAt: null, disputeLogUrl: null, disputeLogText: null, disputeLogBy: null, disputeLogAt: null })
      }
    }
  }
  const final = computeStandings(players, matches)
  const omwOnly = podiumSeparatedByOmwOnly(players, matches)
  // Unbreakable after the full chain (points->OMW->H2H->OOMW): any top-3 row flagged tied.
  const top3Tied = final.slice(0, 3).some((row) => row.tied)
  return { omwOnly, top3Tied }
}

function run(n: number, rounds: number, trials: number) {
  let omwOnly = 0
  let top3Tied = 0
  for (let i = 0; i < trials; i++) {
    const r = simOne(n, rounds)
    if (r.omwOnly) omwOnly++
    if (r.top3Tied) top3Tied++
  }
  const pct = (x: number) => ((x / trials) * 100).toFixed(2) + '%'
  console.log(
    `  ${String(n).padStart(3)} players / ${rounds} rounds  ->  ` +
      `points+OMW alone settles podium: ${pct(omwOnly).padStart(7)}  |  ` +
      `true tiebreaker game needed (top-3 still tied after OMW+H2H+OOMW): ${pct(top3Tied)}`,
  )
}

function main() {
  const trials = Number(process.argv[2] ?? 30000)
  console.log(`Monte-Carlo over ${trials.toLocaleString()} random events per config (50/50 match outcomes, no draws):\n`)
  run(8, 3, trials)
  run(16, 4, trials)
  run(32, 5, trials)
  run(64, 6, trials)
}

main()
