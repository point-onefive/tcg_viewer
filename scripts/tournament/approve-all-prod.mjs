#!/usr/bin/env node
/**
 * Approve every pending player in the live tournament — mirrors exactly what
 * the admin "Approve all pending" button does server-side (service-role
 * update pending -> approved). Non-destructive; only flips approval_status.
 *
 * Usage: node scripts/tournament/approve-all-prod.mjs --yes
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

if (!process.argv.includes('--yes')) {
  console.error('Refusing without --yes. Run: node scripts/tournament/approve-all-prod.mjs --yes')
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
const sb = createClient(env.TOURNAMENT_SUPABASE_URL, env.TOURNAMENT_SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

async function main() {
  const { data: tours } = await sb
    .from('tournaments')
    .select('id, code, name, is_live, created_at')
    .order('created_at', { ascending: false })
  const live = tours.find((t) => t.is_live) ?? tours[0]
  console.log(`Live tournament: ${live.code} (${live.id})`)

  const { data: updated, error } = await sb
    .from('players')
    .update({ approval_status: 'approved' })
    .eq('tournament_id', live.id)
    .eq('approval_status', 'pending')
    .select('id, x_handle')

  if (error) {
    console.error('UPDATE FAILED:', JSON.stringify(error, null, 2))
    process.exit(1)
  }
  console.log(`Approved ${updated.length}:`, updated.map((p) => '@' + p.x_handle).join(', '))

  const { data: after } = await sb
    .from('players')
    .select('approval_status')
    .eq('tournament_id', live.id)
  const counts = {}
  for (const p of after) counts[p.approval_status] = (counts[p.approval_status] ?? 0) + 1
  console.log('Status now:', JSON.stringify(counts))
}

main().catch((e) => {
  console.error('ERROR:', e.message || e)
  process.exit(1)
})
