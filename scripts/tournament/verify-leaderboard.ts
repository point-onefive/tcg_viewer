/* eslint-disable no-console */
/**
 * READ-ONLY verification of the all-time leaderboard after the wallet_standings
 * view fix (migration 010). Loads the PRODUCTION tournament creds from
 * .env.local and only ever SELECTs - it never writes.
 *
 * It prints:
 *   1. The top of the leaderboard as the view now returns it.
 *   2. A per-status breakdown for any player whose handle matches the filter
 *      arg (default "ravel"), so we can see confirmed wins vs byes vs provisional.
 *
 * Run:
 *   npx tsx scripts/tournament/verify-leaderboard.ts [handleSubstring]
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(path)) return out
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[k] = v
  }
  return out
}

async function main() {
  const needle = (process.argv[2] ?? 'ravel').toLowerCase()
  const env = loadEnvFile('.env.local')
  const url = env.TOURNAMENT_SUPABASE_URL
  const key = env.TOURNAMENT_SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing TOURNAMENT_SUPABASE_* in .env.local')
  const sb = createClient(url, key, { auth: { persistSession: false } })

  console.log('Connected to PROD tournament DB (read-only).\n')

  // 1. Top of leaderboard as the view returns it.
  const { data: board, error: be } = await sb
    .from('wallet_standings')
    .select('username, x_handle, wins, losses, draws, tournaments_played')
    .not('username', 'is', null)
    .order('wins', { ascending: false })
    .order('tournaments_played', { ascending: false })
    .limit(8)
  if (be) throw new Error(`leaderboard read failed: ${be.message}`)
  console.log('Top of leaderboard (post-fix):')
  for (const r of board ?? []) {
    const total = (r.wins ?? 0) + (r.losses ?? 0) + (r.draws ?? 0)
    const pct = total > 0 ? Math.round((r.wins / total) * 100) : 0
    console.log(
      `  ${String(r.username).padEnd(16)} ${r.wins}-${r.losses}-${r.draws}  ${pct}%  (${r.tournaments_played} events)`,
    )
  }

  // 2. Per-status breakdown for the matching player(s).
  const { data: players, error: pe } = await sb
    .from('players')
    .select('id, x_handle, wallet_address, tournament_id')
  if (pe) throw new Error(`players read failed: ${pe.message}`)
  const mine = (players ?? []).filter((p) => (p.x_handle ?? '').toLowerCase().includes(needle))
  if (mine.length === 0) {
    console.log(`\nNo player handle contains "${needle}".`)
    return
  }
  const ids = new Set(mine.map((p) => p.id))
  const { data: matches, error: me } = await sb
    .from('matches')
    .select('player1_id, player2_id, winner_id, status')
  if (me) throw new Error(`matches read failed: ${me.message}`)

  let confirmedWins = 0
  let byeWins = 0
  let provisionalWins = 0
  let losses = 0
  let draws = 0
  for (const m of matches ?? []) {
    const involves = ids.has(m.player1_id) || (m.player2_id && ids.has(m.player2_id))
    if (!involves) continue
    const iWon = ids.has(m.winner_id)
    if (m.status === 'bye' && iWon) byeWins++
    else if (m.status === 'confirmed' && iWon) confirmedWins++
    else if (m.status === 'confirmed' && m.winner_id && !iWon) losses++
    else if (m.status === 'confirmed' && !m.winner_id) draws++
    else if (m.status === 'reported' && iWon) provisionalWins++
  }
  console.log(`\nBreakdown for "${needle}" (${mine[0].x_handle}):`)
  console.log(`  confirmed wins (counted)   : ${confirmedWins}`)
  console.log(`  byes (NOT counted now)     : ${byeWins}`)
  console.log(`  provisional/reported wins  : ${provisionalWins}  (must be 0 on the board)`)
  console.log(`  confirmed losses           : ${losses}`)
  console.log(`  confirmed draws            : ${draws}`)
  console.log(`  => leaderboard should show : ${confirmedWins}-${losses}-${draws}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
