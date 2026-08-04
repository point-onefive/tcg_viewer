/* eslint-disable no-console */
// One-off: list every X handle that has enrolled in any tournament.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '../../')
for (const raw of fs.readFileSync(path.join(ROOT, '.env.local'), 'utf8').split('\n')) {
  const line = raw.trim()
  if (!line || line.startsWith('#') || !line.includes('=')) continue
  const i = line.indexOf('=')
  const k = line.slice(0, i).trim()
  let v = line.slice(i + 1).trim()
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
  if (process.env[k] === undefined) process.env[k] = v
}

const sb = createClient(
  process.env.TOURNAMENT_SUPABASE_URL as string,
  process.env.TOURNAMENT_SUPABASE_SECRET_KEY as string,
  { auth: { persistSession: false } },
)

async function main() {
  const { data, error } = await sb
    .from('players')
    .select('x_handle, display_name, approval_status, tournament_id')
  if (error) {
    console.error(error.message)
    process.exit(1)
  }
  const rows = data ?? []
  const norm = (r: any): string => {
    const h = (r.x_handle ?? r.display_name ?? '').toString().replace(/^@/, '').trim()
    return h
  }
  // dedupe case-insensitively, keep first-seen casing
  const seen = new Map<string, string>()
  for (const r of rows) {
    const h = norm(r)
    if (!h) continue
    const key = h.toLowerCase()
    if (!seen.has(key)) seen.set(key, h)
  }
  const handles = [...seen.values()].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()))

  console.log(`\nTotal player rows: ${rows.length}`)
  console.log(`Unique handles: ${handles.length}\n`)
  console.log('--- @-tag list (space-separated) ---')
  console.log(handles.map((h) => `@${h}`).join(' '))
  console.log('\n--- one per line ---')
  console.log(handles.map((h) => `@${h}`).join('\n'))
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
