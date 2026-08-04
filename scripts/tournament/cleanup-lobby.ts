/* eslint-disable no-console */
/**
 * One-off: fully remove a paid lobby (on-chain cancel + DB delete).
 *
 * Safe by design:
 *   - Dry-run unless you pass --confirm.
 *   - REFUSES to touch a game that has any funded player (would need refunds).
 *   - Only cancels on-chain when the game is Open (state 1); skips otherwise.
 *   - Deletes matches, players, waitlist rows for the lobby, then the tournament.
 *
 * Usage:
 *   npx tsx scripts/tournament/cleanup-lobby.ts --code=PG-XXXXX            # dry run
 *   npx tsx scripts/tournament/cleanup-lobby.ts --code=PG-XXXXX --confirm  # execute
 *
 * Uses whatever escrow chain .env.local points at (currently Base mainnet).
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
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (process.env[k] === undefined) process.env[k] = v
  }
}

loadEnvFile(path.join(REPO_ROOT, '.env.local'))

if (!process.env.__CL_REEXEC) {
  const res = spawnSync(
    'npx',
    ['tsx', '--conditions=react-server', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __CL_REEXEC: '1' }, cwd: REPO_ROOT },
  )
  process.exit(res.status ?? 1)
}

import { createClient } from '@supabase/supabase-js'
import type { Hex } from 'viem'

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.split('=')[1] : undefined
}
const CODE = arg('code')
const CONFIRM = process.argv.includes('--confirm')

async function main() {
  if (!CODE) {
    console.error('missing --code=PG-XXXXX')
    process.exit(1)
  }
  const escrow = await import('../../src/lib/tournament/escrow')
  const escrowWrite = await import('../../src/lib/tournament/escrow-write')

  const sb = createClient(
    process.env.TOURNAMENT_SUPABASE_URL as string,
    process.env.TOURNAMENT_SUPABASE_SECRET_KEY as string,
    { auth: { persistSession: false } },
  )

  const { data: t, error } = await sb
    .from('tournaments')
    .select('id, code, name, status, escrow_id, chain_id, contract_address')
    .eq('code', CODE)
    .single()
  if (error || !t) {
    console.error(`lobby ${CODE} not found: ${error?.message ?? 'no row'}`)
    process.exit(1)
  }

  const { data: players } = await sb
    .from('players')
    .select('id, funded, refunded, x_handle')
    .eq('tournament_id', t.id)
  const funded = (players ?? []).filter((p) => p.funded && !p.refunded)

  console.log(`\nLOBBY ${t.code}  "${t.name}"  status=${t.status}`)
  console.log(`  chain_id=${t.chain_id}  escrow_id=${t.escrow_id ?? '(none)'}`)
  console.log(`  players=${players?.length ?? 0}  funded(unrefunded)=${funded.length}`)

  let onchainState = -1
  if (t.escrow_id) {
    try {
      const g = await escrow.getOnchainGame(t.escrow_id as Hex)
      onchainState = g.state
      console.log(
        `  on-chain: state=${g.state} (0=None 1=Open 2=Locked 3=Settled 4=Cancelled) fundedCount=${g.fundedCount} pot=${g.pot}`,
      )
    } catch (e) {
      console.log(`  on-chain read failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  if (funded.length > 0) {
    console.error('\nABORT: this lobby has funded players. Refund them via admin first; refusing to delete.')
    process.exit(2)
  }

  if (!CONFIRM) {
    console.log('\n[dry run] pass --confirm to cancel on-chain (if Open) and delete the DB rows.')
    process.exit(0)
  }

  if (t.escrow_id && onchainState === 1) {
    console.log('\ncancelling on-chain (operator)...')
    const tx = await escrowWrite.cancelGameOnchain(t.escrow_id as Hex)
    console.log(`  cancel tx: ${tx ?? '(operator not configured - skipped)'}`)
  } else {
    console.log(`\nskip on-chain cancel (state=${onchainState}); nothing to cancel.`)
  }

  console.log('deleting DB rows...')
  await sb.from('matches').delete().eq('tournament_id', t.id)
  await sb.from('players').delete().eq('tournament_id', t.id)
  await sb.from('tournament_waitlist').delete().eq('tournament_id', t.id)
  const del = await sb.from('tournaments').delete().eq('id', t.id)
  if (del.error) {
    console.error(`  tournament delete failed: ${del.error.message}`)
    process.exit(3)
  }

  const { data: check } = await sb.from('tournaments').select('id').eq('code', CODE).maybeSingle()
  console.log(check ? '  WARNING: row still present' : `  ${CODE} fully removed.`)
  console.log('\nDONE.')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
