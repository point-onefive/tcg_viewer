#!/usr/bin/env node
/**
 * READ-ONLY prod diagnostic: lists the live tournament and every player with
 * their approval_status, so we can (a) confirm no sign-ups are lost and
 * (b) see why "approve all" might not be taking. Mutates nothing.
 *
 * Usage: node scripts/tournament/inspect-pending.mjs
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const url = env.TOURNAMENT_SUPABASE_URL
const key = env.TOURNAMENT_SUPABASE_SECRET_KEY
if (!url || !key) throw new Error('Missing TOURNAMENT_SUPABASE_* in .env.local')

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function main() {
  console.log('Project:', url)

  const { data: tours, error: tErr } = await sb
    .from('tournaments')
    .select('id, code, name, status, is_live, format, max_players, created_at')
    .order('created_at', { ascending: false })
  if (tErr) throw new Error('tournaments query: ' + tErr.message)

  console.log(`\nTournaments (${tours.length}):`)
  for (const t of tours) {
    console.log(`  ${t.is_live ? '★ LIVE' : '      '} ${t.code}  ${t.status.padEnd(9)} ${t.format ?? '?'}  "${t.name}"  (${t.id})`)
  }

  const live = tours.find((t) => t.is_live) ?? tours[0]
  if (!live) {
    console.log('\nNo tournaments found.')
    return
  }
  console.log(`\nInspecting: ${live.code} (${live.id})`)

  const { data: players, error: pErr } = await sb
    .from('players')
    .select('id, display_name, x_handle, approval_status, created_at')
    .eq('tournament_id', live.id)
    .order('created_at', { ascending: true })
  if (pErr) throw new Error('players query: ' + pErr.message)

  const byStatus = {}
  for (const p of players) byStatus[p.approval_status] = (byStatus[p.approval_status] ?? 0) + 1
  console.log(`\nPlayers (${players.length}) by status:`, JSON.stringify(byStatus))

  console.log('\nAll players:')
  for (const p of players) {
    console.log(`  [${(p.approval_status ?? 'NULL').padEnd(8)}] @${p.x_handle ?? '(no handle)'}  name="${p.display_name}"  ${p.id}`)
  }

  // Look for case-insensitive handle collisions that could trip the unique
  // partial index (tournament_id, lower(x_handle)) where status != rejected.
  const seen = new Map()
  const collisions = []
  for (const p of players) {
    if (p.approval_status === 'rejected' || !p.x_handle) continue
    const k = p.x_handle.toLowerCase()
    if (seen.has(k)) collisions.push(k)
    else seen.set(k, p.id)
  }
  console.log('\nHandle collisions (non-rejected):', collisions.length ? collisions : 'none')
}

main().catch((e) => {
  console.error('ERROR:', e.message || e)
  process.exit(1)
})
