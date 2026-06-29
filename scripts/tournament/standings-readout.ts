/* eslint-disable no-console */
/**
 * READ-ONLY prod read-out of the live tournament's standings using the exact
 * same `computeStandings` the app uses. Never writes. Loads PROD creds from
 * .env.local (TOURNAMENT_SUPABASE_*).
 *
 * Run:
 *   npx tsx scripts/tournament/standings-readout.ts
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { computeStandings } from '../../src/lib/tournament/pairing'
import { rowToPlayer, rowToMatch, rowToRound, rowToTournament } from '../../src/lib/tournament/mappers'

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
  const env = loadEnvFile('.env.local')
  const url = env.TOURNAMENT_SUPABASE_URL
  const key = env.TOURNAMENT_SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing TOURNAMENT_SUPABASE_* in .env.local')
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  console.log('Connected to PROD tournament DB (read-only).\n')

  const { data: tours, error: tErr } = await sb
    .from('tournaments')
    .select('*')
    .order('created_at', { ascending: false })
  if (tErr) throw new Error('tournaments: ' + tErr.message)
  const liveRow = (tours ?? []).find((t: any) => t.is_live) ?? (tours ?? [])[0]
  if (!liveRow) return console.log('No tournaments found.')
  const t = rowToTournament(liveRow)
  console.log(`Tournament: "${t.name}" (${t.code})  format=${t.format}  status=${t.status}  swissRounds=${t.swissRounds}`)

  const { data: playerRows, error: pErr } = await sb
    .from('players')
    .select('*')
    .eq('tournament_id', t.id)
  if (pErr) throw new Error('players: ' + pErr.message)
  const allPlayers = (playerRows ?? []).map(rowToPlayer)

  const { data: roundRows, error: rErr } = await sb
    .from('rounds')
    .select('*')
    .eq('tournament_id', t.id)
    .order('number', { ascending: true })
  if (rErr) throw new Error('rounds: ' + rErr.message)
  const rounds = (roundRows ?? []).map(rowToRound)

  const { data: matchRows, error: mErr } = await sb
    .from('matches')
    .select('*')
    .eq('tournament_id', t.id)
  if (mErr) throw new Error('matches: ' + mErr.message)
  const matches = (matchRows ?? []).map(rowToMatch)

  // Players who count for standings: approved (not rejected) and not dropped.
  const active = allPlayers.filter((p) => p.approvalStatus !== 'rejected')
  const byStatus: Record<string, number> = {}
  for (const p of allPlayers) byStatus[p.approvalStatus] = (byStatus[p.approvalStatus] ?? 0) + 1
  console.log(`Players: ${allPlayers.length} total`, JSON.stringify(byStatus), `| dropped=${allPlayers.filter((p) => p.dropped).length}`)

  // Round progress.
  const roundsByStatus: Record<string, number[]> = {}
  for (const r of rounds) (roundsByStatus[r.status] ??= []).push(r.number)
  console.log(`\nRounds (${rounds.length}):`)
  for (const r of rounds) {
    const ms = matches.filter((m) => m.roundId === r.id)
    const done = ms.filter((m) => m.status === 'confirmed' || m.status === 'bye').length
    const pending = ms.filter((m) => m.status !== 'confirmed' && m.status !== 'bye')
    console.log(
      `  R${r.number}  ${r.status.padEnd(9)}  ${done}/${ms.length} decided` +
        (pending.length ? `  | OPEN: ${pending.map((m) => `${name(m.player1Id)} vs ${m.player2Id ? name(m.player2Id) : 'BYE'} [${m.status}]`).join(', ')}` : ''),
    )
  }

  // Standings via the real engine.
  const standings = computeStandings(active, matches)
  const confirmedRounds = rounds.filter((r) => r.status === 'complete').length
  console.log(`\nStandings (after ${confirmedRounds} completed round(s)):`)
  console.log('  #  player              W-L-D  pts   OMW%    OOMW%   tie')
  for (const s of standings) {
    if (s.dropped) continue
    console.log(
      `  ${String(s.rank).padStart(2)} ${s.displayName.replace(/^@/, '').padEnd(18)} ${s.wins}-${s.losses}-${s.draws}   ${String(s.points).padStart(2)}   ${(s.oppWinPct * 100).toFixed(1).padStart(5)}%  ${(s.oppOppWinPct * 100).toFixed(1).padStart(5)}%  ${s.tied ? `T${s.tieGroup}` : ''}`,
    )
  }

  const undefeated = standings.filter((s) => !s.dropped && s.losses === 0 && s.draws === 0)
  console.log(`\nUndefeated (no losses, no draws): ${undefeated.length}`)
  for (const s of undefeated) console.log(`  ${s.displayName.replace(/^@/, '')}  ${s.wins}-0-0  OMW ${(s.oppWinPct * 100).toFixed(1)}%`)

  function name(id: string) {
    return allPlayers.find((p) => p.id === id)?.displayName?.replace(/^@/, '') ?? id.slice(0, 6)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
