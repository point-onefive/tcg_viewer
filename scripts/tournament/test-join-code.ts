/* eslint-disable no-console */
/**
 * Focused test for the per-tournament JOIN CODE gate.
 *
 * Exercises the exact service-layer path the app uses (no dev server, no
 * browser wallet needed):
 *   1. set a join code on an existing enrolling lobby (adminSetJoinPassword)
 *   2. read it back (adminGetJoinPassword)
 *   3. assert the PUBLIC snapshot exposes only `joinProtected`, never the raw code
 *   4. enroll with NO code            -> must throw "needs a join code"
 *   5. enroll with the WRONG code     -> must throw "not correct"
 *   6. enroll with the RIGHT code     -> must succeed
 *   7. cleanup: remove the probe player and clear the code (lobby restored)
 *
 * Usage:  npx tsx scripts/tournament/test-join-code.ts --code=PG-XXXXX
 * Requires migration 024 (join_password column) to be applied to the DB the
 * app points at. Only touches the ONE lobby you pass in; never the featured
 * event. Never prints secrets other than the throwaway code it sets itself.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '../../')

function loadEnvFile(file: string): void {
  if (!fs.existsSync(file)) return
  for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

loadEnvFile(path.join(REPO_ROOT, '.env.local'))

if (!process.env.__JC_REEXEC) {
  const res = spawnSync(
    'npx',
    ['tsx', '--conditions=react-server', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __JC_REEXEC: '1' }, cwd: REPO_ROOT },
  )
  process.exit(res.status ?? 1)
}

import { createClient } from '@supabase/supabase-js'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

function arg(name: string, dflt: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : dflt
}

const CODE = arg('code', 'PG-Z5QX2')
const JOIN = 'APAC-TEST-42'
const HANDLE = 'jc_probe'
const DECK = 'OP01-001\n' + Array.from({ length: 50 }, () => 'OP01-016').join('\n')

let passed = 0
let failed = 0
function ok(label: string) {
  passed++
  console.log(`  PASS  ${label}`)
}
function bad(label: string, detail?: string) {
  failed++
  console.log(`  FAIL  ${label}${detail ? ` -> ${detail}` : ''}`)
}

async function expectThrow(label: string, needle: string, fn: () => Promise<unknown>) {
  try {
    await fn()
    bad(label, 'expected a rejection but it resolved')
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.toLowerCase().includes(needle.toLowerCase())) ok(`${label} (rejected: "${msg}")`)
    else bad(label, `wrong error: "${msg}"`)
  }
}

async function main() {
  const svc = await import('../../src/lib/tournament/service')
  const probe = privateKeyToAccount(generatePrivateKey()).address

  const sb = createClient(
    process.env.TOURNAMENT_SUPABASE_URL as string,
    process.env.TOURNAMENT_SUPABASE_SECRET_KEY as string,
    { auth: { persistSession: false } },
  )

  // A real player has a wallet_profiles row (created at SIWE login); players
  // FK-references it. Seed one for the probe so the RIGHT-code path can complete
  // the insert. Removed in cleanup.
  const up = await sb.from('wallet_profiles').upsert(
    { wallet_address: probe.toLowerCase(), x_handle: HANDLE },
    { onConflict: 'wallet_address' },
  )
  if (up.error) bad('seed probe wallet_profiles', up.error.message)

  console.log(`\nJOIN-CODE GATE TEST  lobby=${CODE}  probe=${probe}\n`)

  // Precondition: lobby exists and is enrolling.
  const snap0 = await svc.getSnapshotByCode(CODE)
  if (!snap0) {
    bad('lobby exists', 'snapshot null - create a paid lobby first and pass --code=')
    return finish()
  }
  if (snap0.tournament.status !== 'enrolling') {
    bad('lobby is enrolling', `status=${snap0.tournament.status}`)
    return finish()
  }
  ok('lobby exists and is enrolling')

  // 1) set the code
  const setRes = await svc.adminSetJoinPassword({ code: CODE, password: JOIN })
  setRes.joinProtected ? ok('adminSetJoinPassword -> joinProtected true') : bad('adminSetJoinPassword joinProtected')

  // 2) read it back
  const got = await svc.adminGetJoinPassword(CODE)
  got.joinPassword === JOIN ? ok('adminGetJoinPassword returns the raw code (admin-only)') : bad('adminGetJoinPassword', String(got.joinPassword))

  // 3) public snapshot exposes only the flag, never the raw code
  const snap1 = await svc.getSnapshotByCode(CODE)
  snap1?.tournament.joinProtected === true ? ok('snapshot.tournament.joinProtected === true') : bad('snapshot joinProtected flag')
  const serialized = JSON.stringify(snap1)
  !serialized.includes(JOIN) ? ok('raw code is NOT present anywhere in the public snapshot') : bad('LEAK: raw code found in snapshot')

  // 4/5/6) enroll gate
  await expectThrow('enroll with NO code is rejected', 'needs a join code', () =>
    svc.enroll(CODE, HANDLE, DECK, probe, null, undefined),
  )
  await expectThrow('enroll with WRONG code is rejected', 'not correct', () =>
    svc.enroll(CODE, HANDLE, DECK, probe, null, 'nope-wrong'),
  )
  try {
    const res = await svc.enroll(CODE, HANDLE, DECK, probe, null, JOIN)
    res?.player?.id ? ok('enroll with the RIGHT code succeeds') : bad('enroll right code', 'no player returned')
  } catch (e) {
    bad('enroll with the RIGHT code succeeds', e instanceof Error ? e.message : String(e))
  }

  // 7) cleanup: remove probe player, clear the code
  const { data: t } = await sb.from('tournaments').select('id').eq('code', CODE).single()
  if (t?.id) {
    const del = await sb.from('players').delete().eq('tournament_id', t.id).eq('wallet_address', probe.toLowerCase())
    del.error ? bad('cleanup: delete probe player', del.error.message) : ok('cleanup: probe player removed')
  }
  const cleared = await svc.adminSetJoinPassword({ code: CODE, password: null })
  cleared.joinProtected === false ? ok('cleanup: join code cleared (lobby back to open)') : bad('cleanup: clear code')

  await sb.from('wallet_profiles').delete().eq('wallet_address', probe.toLowerCase())

  finish()
}

function finish() {
  console.log(`\n${failed === 0 ? 'ALL GREEN' : 'FAILURES'}: ${passed} passed, ${failed} failed\n`)
  process.exit(failed === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
