/* eslint-disable no-console */
/**
 * PREVIEW ONLY. Restore/patch the stored self-reports on a match (by its number
 * in the active round) without touching the winner. Used to repair rows that an
 * older adminSetResult had overwritten to look complementary.
 *
 *   npx tsx --conditions=react-server scripts/tournament/preview-set-reports.ts --match 1 --p1 loss --p2 loss
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
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, i).trim()] = v
  }
  return out
}

const root = new URL('../../', import.meta.url).pathname
const preview = loadEnvFile(root + '.env.preview.local')
const prod = loadEnvFile(root + '.env.local')
const URL_ = preview.TOURNAMENT_SUPABASE_URL
const KEY = preview.TOURNAMENT_SUPABASE_SECRET_KEY
if (!URL_ || !KEY) throw new Error('Missing preview TOURNAMENT_SUPABASE_* in .env.preview.local')
if (URL_ === prod.TOURNAMENT_SUPABASE_URL) throw new Error('ABORT: preview URL == prod URL.')

const args = process.argv
const num = Number(args[args.indexOf('--match') + 1])
const p1 = args[args.indexOf('--p1') + 1] || null
const p2 = args[args.indexOf('--p2') + 1] || null

async function main() {
  const sb = createClient(URL_, KEY, { auth: { persistSession: false } })
  const { data: tour } = await sb
    .from('tournaments')
    .select('id,code')
    .neq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (!tour) throw new Error('No active tournament found on preview.')

  const { data: rounds } = await sb
    .from('rounds')
    .select('id,number,status')
    .eq('tournament_id', tour.id)
    .eq('status', 'active')
  const roundIds = (rounds ?? []).map((r) => r.id)
  const { data: matches } = await sb
    .from('matches')
    .select('id,number,player1_report,player2_report,winner_id,status')
    .in('round_id', roundIds)
    .eq('number', num)
  const m = matches?.[0]
  if (!m) throw new Error(`No match #${num} in the active round.`)

  console.log(`Before: M${m.number} status=${m.status} p1=${m.player1_report} p2=${m.player2_report}`)
  const { error } = await sb
    .from('matches')
    .update({ player1_report: p1, player2_report: p2 })
    .eq('id', m.id)
  if (error) throw new Error(error.message)
  console.log(`After:  M${m.number} p1=${p1} p2=${p2} (winner untouched)`)
  process.exit(0)
}

main().catch((e) => {
  console.error('FATAL:', e?.message || e)
  process.exit(2)
})
