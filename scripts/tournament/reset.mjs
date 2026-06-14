#!/usr/bin/env node
/**
 * DANGER: wipes ALL tournament data (tournaments + cascades to players,
 * rounds, matches, schedule_proposals). Intended for clearing test data
 * before a real launch.
 *
 * Usage:  node scripts/tournament/reset.mjs --yes
 *
 * Reads TOURNAMENT_SUPABASE_URL / TOURNAMENT_SUPABASE_SECRET_KEY from
 * .env.local. Refuses to run without the explicit --yes flag.
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--yes')) {
  console.error('Refusing to wipe without --yes. Run: node scripts/tournament/reset.mjs --yes')
  process.exit(1)
}

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
if (!url || !key) throw new Error('Missing TOURNAMENT_SUPABASE_URL / TOURNAMENT_SUPABASE_SECRET_KEY in .env.local')

const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

async function count(table) {
  const { count } = await sb.from(table).select('*', { count: 'exact', head: true })
  return count ?? 0
}

const tables = ['schedule_proposals', 'matches', 'rounds', 'players', 'tournaments']

async function main() {
  console.log('Before:')
  for (const t of tables) console.log(`  ${t}: ${await count(t)}`)

  // Delete tournaments; FK cascade clears the rest. Delete child tables too in
  // case any are unparented. Filter matches everything (id is never this uuid).
  const ALL = '00000000-0000-0000-0000-000000000000'
  for (const t of tables) {
    const { error } = await sb.from(t).delete().neq('id', ALL)
    if (error) console.log(`  (${t} delete: ${error.message})`)
  }

  console.log('After:')
  for (const t of tables) console.log(`  ${t}: ${await count(t)}`)
  console.log('Done — all tournament data cleared.')
}

main().catch((e) => {
  console.error('ERROR:', e.message || e)
  process.exit(1)
})
