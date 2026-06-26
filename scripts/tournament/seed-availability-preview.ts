/* eslint-disable no-console */
/**
 * Seed self-declared availability onto PREVIEW wallet profiles so we can eyeball
 * the public-profile availability UI end-to-end. Loads PREVIEW tournament creds
 * from .env.preview.local. Never touches prod.
 *
 *   npx tsx scripts/tournament/seed-availability-preview.ts          # dry list
 *   npx tsx scripts/tournament/seed-availability-preview.ts --write  # apply
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

// A spread of timezones + believable blocks so the viewer-conversion is obvious.
const PRESETS = [
  { tz: 'America/New_York', weekday: [12, 13, 20, 21, 22], weekend: [10, 11, 12, 21] },
  { tz: 'America/Los_Angeles', weekday: [18, 19, 20, 21], weekend: [9, 10, 11, 19, 20] },
  { tz: 'Europe/London', weekday: [19, 20, 21], weekend: [14, 15, 16, 20] },
  { tz: 'Europe/Berlin', weekday: [20, 21, 22], weekend: [11, 12, 13, 21] },
  { tz: 'Asia/Tokyo', weekday: [21, 22, 23], weekend: [10, 11, 12, 22] },
  { tz: 'Australia/Sydney', weekday: [19, 20, 21], weekend: [9, 10, 11, 20] },
  { tz: 'Asia/Kolkata', weekday: [21, 22], weekend: [11, 12, 13] },
  { tz: 'America/Sao_Paulo', weekday: [20, 21, 22], weekend: [15, 16, 17] },
]

async function main() {
  const write = process.argv.includes('--write')
  const env = loadEnvFile('.env.preview.local')
  const url = env.TOURNAMENT_SUPABASE_URL
  const key = env.TOURNAMENT_SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing TOURNAMENT_SUPABASE_* in .env.preview.local')
  const sb = createClient(url, key, { auth: { persistSession: false } })
  console.log(`Connected to PREVIEW tournament DB (${write ? 'WRITE' : 'read-only'}).`)
  console.log(`  ${url}\n`)

  const { data: profiles, error } = await sb
    .from('wallet_profiles')
    .select('wallet_address, username, x_handle, availability')
    .order('username', { ascending: true })
  if (error) throw new Error(`wallet_profiles read failed: ${error.message}`)

  const named = (profiles ?? []).filter((p) => p.username)
  console.log(`Found ${profiles?.length ?? 0} profiles (${named.length} with a username):`)
  for (const p of profiles ?? []) {
    const a = p.availability as { tz?: string } | null
    console.log(
      `  ${(p.username ?? '(no username)').padEnd(18)} ${(p.x_handle ?? '').padEnd(18)} ${
        a?.tz ? `avail=${a.tz}` : 'avail=-'
      }`,
    )
  }

  if (!write) {
    console.log('\nDry run. Re-run with --write to seed availability onto the named profiles above.')
    return
  }

  if (named.length === 0) {
    console.log('\nNo named profiles to seed.')
    return
  }

  console.log('\nSeeding availability...')
  let i = 0
  for (const p of named) {
    const preset = PRESETS[i % PRESETS.length]
    i++
    const { error: ue } = await sb
      .from('wallet_profiles')
      .update({ availability: preset })
      .eq('wallet_address', p.wallet_address)
    if (ue) {
      console.log(`  x ${p.username}: ${ue.message}`)
    } else {
      console.log(`  ✓ ${String(p.username).padEnd(18)} -> ${preset.tz}`)
    }
  }
  console.log('\nDone. Open the preview leaderboard and click these players to see the public view.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
