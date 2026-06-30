/* eslint-disable no-console */
/**
 * READ-ONLY: enumerate EVERY possible outcome of the still-open round-4 matches
 * (each: p1 win / p2 win / draw) and recompute final standings with the real
 * engine for each combination. Reports whether 2nd/3rd (or any podium spot) can
 * change. Never writes.
 *
 * Run: npx tsx scripts/tournament/sim-r4-outcomes.ts
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'
import { computeStandings } from '../../src/lib/tournament/pairing'
import { rowToPlayer, rowToMatch, rowToTournament } from '../../src/lib/tournament/mappers'
import type { Match } from '../../src/lib/tournament/types'

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
  const baseMatches = (matchRows ?? []).map(rowToMatch)
  const active = allPlayers.filter((p) => p.approvalStatus !== 'rejected')
  const nm = (id: string | null) =>
    id ? allPlayers.find((p) => p.id === id)?.displayName?.replace(/^@/, '') ?? id.slice(0, 6) : 'BYE'

  const open = baseMatches.filter((m) => m.status !== 'confirmed' && m.status !== 'bye' && m.player2Id)
  console.log(`Open matches: ${open.length}`)
  for (const m of open) console.log(`  ${nm(m.player1Id)} vs ${nm(m.player2Id)}`)

  // Outcomes per match: p1 win, p2 win, draw.
  const outcomes: ('p1' | 'p2' | 'draw')[] = ['p1', 'p2', 'draw']
  const combos: ('p1' | 'p2' | 'draw')[][] = []
  const rec = (acc: ('p1' | 'p2' | 'draw')[], depth: number) => {
    if (depth === open.length) { combos.push([...acc]); return }
    for (const o of outcomes) { acc.push(o); rec(acc, depth + 1); acc.pop() }
  }
  rec([], 0)

  const podiumSet = new Map<string, number>() // "1st|2nd|3rd" -> count
  const second = new Set<string>()
  const third = new Set<string>()
  const first = new Set<string>()

  for (const combo of combos) {
    const sim: Match[] = baseMatches.map((m) => {
      const idx = open.findIndex((o) => o.id === m.id)
      if (idx === -1) return m
      const o = combo[idx]
      return {
        ...m,
        status: 'confirmed',
        winnerId: o === 'p1' ? m.player1Id : o === 'p2' ? m.player2Id : null,
      } as Match
    })
    const s = computeStandings(active, sim).filter((r) => !r.dropped)
    const p1 = nm(s[0].playerId), p2 = nm(s[1].playerId), p3 = nm(s[2].playerId)
    first.add(p1); second.add(p2); third.add(p3)
    const key = `${p1} | ${p2} | ${p3}`
    podiumSet.set(key, (podiumSet.get(key) ?? 0) + 1)
  }

  console.log(`\nEnumerated ${combos.length} outcome combinations.`)
  console.log(`\nDistinct possible 1st: ${[...first].join(', ')}`)
  console.log(`Distinct possible 2nd: ${[...second].join(', ')}`)
  console.log(`Distinct possible 3rd: ${[...third].join(', ')}`)
  console.log(`\nPodium combinations seen (1st | 2nd | 3rd  ->  #combos):`)
  for (const [k, c] of [...podiumSet.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k}   -> ${c}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
