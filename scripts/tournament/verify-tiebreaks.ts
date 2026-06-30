/* eslint-disable no-console */
/**
 * READ-ONLY deep verification of the live tournament's tiebreakers. For the top
 * N players it prints every opponent faced, that opponent's decided-game record
 * + match-win-rate (the exact value OMW averages, floored at 1/3), and a hand
 * recomputed OMW/OOMW so we can confirm the engine matches the math by hand.
 *
 * Run: npx tsx scripts/tournament/verify-tiebreaks.ts
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { computeStandings } from '../../src/lib/tournament/pairing'
import { rowToPlayer, rowToMatch, rowToTournament } from '../../src/lib/tournament/mappers'

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(path)) return out
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')
  }
  return out
}

async function main() {
  const env = loadEnvFile('.env.local')
  const sb = createClient(env.TOURNAMENT_SUPABASE_URL!, env.TOURNAMENT_SUPABASE_SECRET_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data: tours } = await sb.from('tournaments').select('*').order('created_at', { ascending: false })
  const liveRow = (tours ?? []).find((t: any) => t.is_live) ?? (tours ?? [])[0]
  const t = rowToTournament(liveRow)
  const { data: playerRows } = await sb.from('players').select('*').eq('tournament_id', t.id)
  const { data: matchRows } = await sb.from('matches').select('*').eq('tournament_id', t.id)
  const allPlayers = (playerRows ?? []).map(rowToPlayer)
  const matches = (matchRows ?? []).map(rowToMatch)
  const active = allPlayers.filter((p) => p.approvalStatus !== 'rejected')
  const nm = (id: string) => allPlayers.find((p) => p.id === id)?.displayName?.replace(/^@/, '') ?? id.slice(0, 6)

  // Decided-game record (byes excluded) + match-win-rate, exactly as the engine.
  const rec = new Map<string, { w: number; l: number; d: number; g: number }>()
  for (const p of active) rec.set(p.id, { w: 0, l: 0, d: 0, g: 0 })
  const oppList = new Map<string, string[]>()
  for (const p of active) oppList.set(p.id, [])
  for (const m of matches) {
    if (m.status !== 'confirmed' || !m.player2Id) continue
    const a = rec.get(m.player1Id), b = rec.get(m.player2Id)
    if (!a || !b) continue
    a.g++; b.g++
    oppList.get(m.player1Id)!.push(m.player2Id)
    oppList.get(m.player2Id)!.push(m.player1Id)
    if (m.winnerId === m.player1Id) { a.w++; b.l++ }
    else if (m.winnerId === m.player2Id) { b.w++; a.l++ }
    else { a.d++; b.d++ }
  }
  const mwr = (id: string) => {
    const r = rec.get(id)!
    if (r.g <= 0) return 1 / 3
    return Math.max((r.w * 3 + r.d) / (r.g * 3), 1 / 3)
  }

  const standings = computeStandings(active, matches)
  console.log(`Tournament: ${t.name} (${t.code})  status=${t.status}\n`)

  // Open (undecided) matches - OMW is provisional until these resolve.
  const open = matches.filter((m) => m.status !== 'confirmed' && m.status !== 'bye' && m.player2Id)
  console.log(`Open matches still affecting OMW: ${open.length}`)
  for (const m of open) console.log(`  ${nm(m.player1Id)} vs ${nm(m.player2Id!)} [${m.status}]`)

  const TOP = 6
  for (const s of standings.slice(0, TOP)) {
    const opps = oppList.get(s.playerId) ?? []
    const parts = opps.map((o) => {
      const r = rec.get(o)!
      return `${nm(o)}(${r.w}-${r.l}-${r.d}, mwr=${(mwr(o) * 100).toFixed(1)}%)`
    })
    const handOmw = opps.length ? opps.reduce((x, o) => x + mwr(o), 0) / opps.length : 0
    console.log(`\n#${s.rank} ${nm(s.playerId)}  ${s.wins}-${s.losses}-${s.draws}  pts=${s.points}`)
    console.log(`   opponents: ${parts.join('  ')}`)
    console.log(`   engine OMW=${(s.oppWinPct * 100).toFixed(2)}%   hand OMW=${(handOmw * 100).toFixed(2)}%   ${Math.abs(handOmw - s.oppWinPct) < 1e-9 ? 'MATCH' : 'MISMATCH!!'}`)
    console.log(`   engine OOMW=${(s.oppOppWinPct * 100).toFixed(2)}%`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
