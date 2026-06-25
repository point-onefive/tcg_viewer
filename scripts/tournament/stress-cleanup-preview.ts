/* eslint-disable no-console */
/* PREVIEW ONLY. Mark all stress-test tournaments (SIM / DROP names) complete so
 * they stop occupying the "active" slot, and report what remains active. */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function load(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(path)) return out
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    const l = raw.trim()
    if (!l || l.startsWith('#') || !l.includes('=')) continue
    const i = l.indexOf('=')
    let v = l.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[l.slice(0, i).trim()] = v
  }
  return out
}
const root = new URL('../../', import.meta.url).pathname
const pv = load(root + '.env.preview.local')
const prod = load(root + '.env.local')
if (!pv.TOURNAMENT_SUPABASE_URL) throw new Error('no preview env')
if (pv.TOURNAMENT_SUPABASE_URL === prod.TOURNAMENT_SUPABASE_URL) throw new Error('ABORT: preview == prod')
const sb = createClient(pv.TOURNAMENT_SUPABASE_URL, pv.TOURNAMENT_SUPABASE_SECRET_KEY, { auth: { persistSession: false } })

async function main() {
  const { data: tests } = await sb
    .from('tournaments')
    .select('id,code,name,status')
    .neq('status', 'complete')
    .or('name.like.SIM %,name.like.DROP %,name.like.SIM isolation%')
  for (const t of tests ?? []) {
    await sb.from('tournaments').update({ status: 'complete' }).eq('id', t.id)
    console.log(`completed test tournament ${t.code} (${t.name})`)
  }
  const { data: active } = await sb
    .from('tournaments')
    .select('code,name,status,created_at')
    .neq('status', 'complete')
    .order('created_at', { ascending: false })
  console.log('\nRemaining non-complete tournaments (newest first):')
  for (const t of active ?? []) console.log(`  ${t.code}  ${t.status}  ${t.name}`)
  console.log(active && active.length ? `\nActive now: ${active[0].code} (${active[0].name})` : '\nNo active tournament.')
  process.exit(0)
}
main().catch((e) => {
  console.error('FATAL', e?.message || e)
  process.exit(2)
})
