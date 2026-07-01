/* eslint-disable no-console */
/**
 * Grant the initial 8 badges to the correct wallets, computed from live
 * tournament data (participants + final placements), then upsert into
 * `profile_badges`. Idempotent: re-running never duplicates a grant.
 *
 * Requires migration 014_profile_badges.sql to be applied first.
 *
 * Awards:
 *   beta_tester -> everyone who played "The first one"
 *   beta_king / beta_silver / beta_bronze -> 1st / 2nd / 3rd of "The first one"
 *   og          -> everyone who played EITHER of the first two events
 *   bonk_king / bonk_silver / bonk_bronze -> 1st / 2nd / 3rd of BONK Vol. 1
 *
 * Run (dry-run):  npx tsx scripts/tournament/grant-initial-badges.ts
 * Run (apply):    npx tsx scripts/tournament/grant-initial-badges.ts --apply
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

const FIRST_CODE = 'OP-UUZY4' // "The first one"
const BONK_CODE = 'OP-8BESQ' // "BONK Championship Series Vol. 1"

interface Row {
  x_handle: string | null
  display_name: string | null
  wallet_address: string | null
  final_rank: number | null
  dropped: boolean
  approval_status: string
}

async function main() {
  const apply = process.argv.includes('--apply')
  const env = loadEnvFile('.env.local')
  const url = env.TOURNAMENT_SUPABASE_URL
  const key = env.TOURNAMENT_SUPABASE_SECRET_KEY
  if (!url || !key) throw new Error('Missing TOURNAMENT_SUPABASE_* in .env.local')
  const sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })

  // Resolve wallet for handle-only players via their profile.
  const { data: profs } = await sb.from('wallet_profiles').select('wallet_address, x_handle')
  const walletByHandle = new Map<string, string>()
  for (const p of profs ?? []) {
    const h = (p.x_handle ?? '').trim().toLowerCase().replace(/^@/, '')
    if (h && p.wallet_address) walletByHandle.set(h, String(p.wallet_address).toLowerCase())
  }

  async function tournamentId(code: string): Promise<string> {
    const { data } = await sb.from('tournaments').select('id, name').eq('code', code).single()
    if (!data) throw new Error(`Tournament ${code} not found`)
    console.log(`  ${code} => "${data.name}" (${data.id})`)
    return data.id
  }

  async function players(code: string): Promise<Row[]> {
    const id = await tournamentId(code)
    const { data } = await sb
      .from('players')
      .select('x_handle, display_name, wallet_address, final_rank, dropped, approval_status')
      .eq('tournament_id', id)
    return (data ?? []) as Row[]
  }

  function resolveWallet(r: Row): string | null {
    if (r.wallet_address) return String(r.wallet_address).toLowerCase()
    const h = (r.x_handle ?? '').trim().toLowerCase().replace(/^@/, '')
    return h ? walletByHandle.get(h) ?? null : null
  }

  // A "participant" = approved (rejected sign-ups never actually played).
  const isParticipant = (r: Row) => r.approval_status === 'approved'

  console.log('Resolving tournaments...')
  const first = await players(FIRST_CODE)
  const bonk = await players(BONK_CODE)

  // badge_id -> Map<wallet, handle> (handle kept only for the readable log)
  const grants = new Map<string, Map<string, string>>()
  const add = (badge: string, r: Row) => {
    const w = resolveWallet(r)
    if (!w) {
      console.log(`   ! skip ${badge}: @${r.x_handle} has no wallet`)
      return
    }
    if (!grants.has(badge)) grants.set(badge, new Map())
    grants.get(badge)!.set(w, `@${(r.x_handle ?? '').replace(/^@/, '')}`)
  }

  // Participation badges
  for (const r of first) if (isParticipant(r)) add('beta_tester', r)
  for (const r of [...first, ...bonk]) if (isParticipant(r)) add('og', r)

  // Placement badges
  const place = (rows: Row[], rank: number) => rows.find((r) => r.final_rank === rank && isParticipant(r))
  const g = (badge: string, r: Row | undefined) => {
    if (!r) {
      console.log(`   ! ${badge}: no player found at that rank`)
      return
    }
    add(badge, r)
  }
  g('beta_king', place(first, 1))
  g('beta_silver', place(first, 2))
  g('beta_bronze', place(first, 3))
  g('bonk_king', place(bonk, 1))
  g('bonk_silver', place(bonk, 2))
  g('bonk_bronze', place(bonk, 3))

  console.log('\nPlanned grants:')
  const rows: { wallet_address: string; badge_id: string }[] = []
  for (const [badge, wallets] of grants) {
    const names = [...wallets.values()].sort()
    console.log(`  ${badge} (${wallets.size}): ${names.join(', ')}`)
    for (const w of wallets.keys()) rows.push({ wallet_address: w, badge_id: badge })
  }
  console.log(`\nTotal grant rows: ${rows.length}`)

  if (!apply) {
    console.log('\nDRY RUN. Re-run with --apply to write to profile_badges.')
    return
  }

  const { error } = await sb.from('profile_badges').upsert(rows, { onConflict: 'wallet_address,badge_id', ignoreDuplicates: true })
  if (error) throw new Error('upsert failed: ' + error.message)
  console.log('\nApplied. profile_badges upserted.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
