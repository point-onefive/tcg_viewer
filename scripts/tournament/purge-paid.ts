/* eslint-disable no-console */
/**
 * ONE-OFF paid-tournament purge tool (Base Sepolia + Supabase).
 *
 * Safely tears down specific PAID lobbies (escrow_id set, is_live=false) that
 * the demo harness did NOT create. For each target it:
 *   1) verifies it is paid AND not the featured/free live event,
 *   2) reads on-chain state + per-player funded/refunded flags,
 *   3) if the on-chain game is still OPEN (Funding or Locked) cancels it
 *      on-chain (operator-signed cancelGame, the same path adminCancelPaidGame
 *      uses) so every funded deposit becomes withdrawable,
 *   4) re-reads on-chain state to confirm Cancelled + funds withdrawable,
 *   5) deletes its DB rows (waitlist explicitly, then the tournament row so
 *      players / rounds / matches / proposals / poll_votes cascade).
 *
 * Modes:
 *   npx tsx scripts/tournament/purge-paid.ts --inventory
 *   npx tsx scripts/tournament/purge-paid.ts --purge [--codes=PG-A,PG-B] [--dry-run]
 *
 * SAFETY:
 *   - NEVER touches the featured/free event (is_live=true). Any target that is
 *     is_live or has no escrow_id aborts that target loudly.
 *   - On-chain cancel is serialized (each awaits its receipt) so operator nonces
 *     never collide. Post-cancel reads poll to ride out RPC replica lag.
 *   - No secrets are printed.
 *
 * Re-execs itself once with --conditions=react-server so the service layer
 * (which imports `server-only`) loads cleanly (same trick as demo-tournament.ts).
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

if (!process.env.__PURGE_REEXEC) {
  const res = spawnSync(
    'npx',
    ['tsx', '--conditions=react-server', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __PURGE_REEXEC: '1' }, cwd: REPO_ROOT },
  )
  process.exit(res.status ?? 1)
}

// ── react-server child from here down ──────────────────────────────────────

import { createPublicClient, http, formatEther, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia, base } from 'viem/chains'
import type { SupabaseClient } from '@supabase/supabase-js'

const DEFAULT_CODES = ['PG-4VSNV', 'PG-9GPJV', 'PG-HBJ8R', 'PG-86EKG']

const RPC_URL = process.env.TOURNAMENT_ESCROW_RPC_URL as string
const OPERATOR_KEY = process.env.TOURNAMENT_ESCROW_OPERATOR_KEY as Hex
const CHAIN_ID = Number(process.env.TOURNAMENT_ESCROW_CHAIN_ID)

const STATE_NAME: Record<number, string> = {
  0: 'None',
  1: 'Funding',
  2: 'Locked',
  3: 'Paid',
  4: 'Cancelled',
}

function argValue(name: string): string | undefined {
  const pref = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(pref))
  return hit ? hit.slice(pref.length) : undefined
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 19)
  console.log(`[${ts}] ${msg}`)
}
function banner(lines: string[]): void {
  const width = Math.max(...lines.map((l) => l.length)) + 4
  const bar = '='.repeat(width)
  console.log('\n' + bar)
  for (const l of lines) console.log('  ' + l)
  console.log(bar + '\n')
}
function usdc(units: number | bigint): string {
  const n = typeof units === 'bigint' ? Number(units) : units
  const d = n / 1_000_000
  return `$${Number.isInteger(d) ? d.toFixed(0) : d.toFixed(2)}`
}

const publicClient = createPublicClient({
  chain: CHAIN_ID === base.id ? base : baseSepolia,
  transport: http(RPC_URL),
})
const operatorAddress = privateKeyToAccount(OPERATOR_KEY).address

async function loadSupabase(): Promise<SupabaseClient> {
  const mod = (await import(path.join(REPO_ROOT, 'src/lib/tournament/supabase.ts'))) as {
    getServiceClient(): SupabaseClient
  }
  return mod.getServiceClient()
}
type ServiceModule = {
  adminCancelPaidGame(code: string): Promise<{ txHash: string | null }>
  listOpenPaidGames(): Promise<{ code: string; name: string; status: string }[]>
}
async function loadService(): Promise<ServiceModule> {
  return (await import(path.join(REPO_ROOT, 'src/lib/tournament/service.ts'))) as ServiceModule
}
type EscrowModule = {
  getOnchainGame(id: Hex): Promise<{
    state: number
    entryFee: bigint
    cap: number
    fundedCount: number
    pot: bigint
  }>
  getFundingStatus(id: Hex, wallet: Hex): Promise<{ funded: boolean; refunded: boolean }>
  escrowAddress(): Hex
}
async function loadEscrow(): Promise<EscrowModule> {
  return (await import(path.join(REPO_ROOT, 'src/lib/tournament/escrow.ts'))) as EscrowModule
}

interface TRow {
  id: string
  code: string
  name: string
  status: string
  escrow_id: string | null
  is_live: boolean | null
  entry_fee_usdc: number | null
}

async function fetchByCode(sb: SupabaseClient, code: string): Promise<TRow | null> {
  const { data, error } = await sb
    .from('tournaments')
    .select('id, code, name, status, escrow_id, is_live, entry_fee_usdc')
    .eq('code', code)
    .maybeSingle()
  if (error) throw new Error(`fetch ${code}: ${error.message}`)
  return (data as TRow) ?? null
}

async function playersOf(
  sb: SupabaseClient,
  tid: string,
): Promise<{ id: string; wallet_address: string | null; funded: boolean; refunded: boolean }[]> {
  const { data, error } = await sb
    .from('players')
    .select('id, wallet_address, funded, refunded')
    .eq('tournament_id', tid)
  if (error) throw new Error(`players ${tid}: ${error.message}`)
  return (data ?? []) as {
    id: string
    wallet_address: string | null
    funded: boolean
    refunded: boolean
  }[]
}

async function countRows(sb: SupabaseClient, table: string, col: string, val: string): Promise<number> {
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true })
    .eq(col, val)
  if (error) return -1 // table may not exist (e.g. tournament_waitlist absent)
  return count ?? 0
}

async function onchainSummary(esc: EscrowModule, escrowId: Hex): Promise<string> {
  try {
    const g = await esc.getOnchainGame(escrowId)
    return `state=${STATE_NAME[g.state] ?? g.state} fundedCount=${g.fundedCount} pot=${usdc(g.pot)} entryFee=${usdc(g.entryFee)}`
  } catch (e) {
    return `on-chain read failed: ${e instanceof Error ? e.message : String(e)}`
  }
}

// ── Inventory (read-only) ──────────────────────────────────────────────────

async function runInventory(): Promise<void> {
  const sb = await loadSupabase()
  const esc = await loadEscrow()

  banner(['PAID-TOURNAMENT INVENTORY (read-only)', `escrow ${esc.escrowAddress()}  chain ${CHAIN_ID}`])

  const opBal = await publicClient.getBalance({ address: operatorAddress })
  log(`Operator ${operatorAddress} balance: ${formatEther(opBal)} ETH`)

  // Featured/free event(s).
  const { data: liveRows } = await sb
    .from('tournaments')
    .select('id, code, name, status, is_live, escrow_id')
    .eq('is_live', true)
  const live = (liveRows ?? []) as TRow[]
  banner(['FEATURED / FREE (is_live=true) - MUST NOT be touched', ...(
    live.length ? live.map((t) => `  ${t.code}  "${t.name}"  status=${t.status}  escrow_id=${t.escrow_id ?? 'null'}`) : ['  (none)']
  )])

  // All paid games.
  const { data: paidRows } = await sb
    .from('tournaments')
    .select('id, code, name, status, escrow_id, is_live, entry_fee_usdc')
    .not('escrow_id', 'is', null)
    .order('created_at', { ascending: false })
  const paid = (paidRows ?? []) as TRow[]
  console.log(`\nALL PAID GAMES (escrow_id set): ${paid.length}`)
  for (const t of paid) {
    const chain = await onchainSummary(esc, t.escrow_id as Hex)
    const isDemo = t.name.startsWith('DEMO ')
    const players = await playersOf(sb, t.id)
    const fundedDb = players.filter((p) => p.funded && !p.refunded)
    console.log(
      `  ${t.code}  "${t.name}"${isDemo ? ' [DEMO]' : ''}  status=${t.status}  is_live=${t.is_live}  fundedPlayers(db)=${fundedDb.length}`,
    )
    console.log(`      chain: ${chain}`)
    for (const p of fundedDb) {
      if (!p.wallet_address) {
        console.log(`      funded player ${p.id} has NO wallet_address (db funded flag only)`)
        continue
      }
      try {
        const fs2 = await esc.getFundingStatus(t.escrow_id as Hex, p.wallet_address as Hex)
        console.log(`      ${p.wallet_address}  onchain funded=${fs2.funded} refunded=${fs2.refunded}`)
      } catch (e) {
        console.log(`      ${p.wallet_address}  onchain read failed: ${e instanceof Error ? e.message : e}`)
      }
    }
  }

  // Demo wallet_profiles / reliability leftovers.
  const { data: demoProfiles } = await sb
    .from('wallet_profiles')
    .select('wallet_address, x_handle')
    .ilike('x_handle', 'demo\\_%')
  const dps = (demoProfiles ?? []) as { wallet_address: string; x_handle: string }[]
  console.log(`\nDEMO wallet_profiles (x_handle like demo_%): ${dps.length}`)
  for (const d of dps) console.log(`  ${d.wallet_address}  @${d.x_handle}`)

  // Target codes existence check.
  const codes = (argValue('codes')?.split(',').map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_CODES
  console.log(`\nTARGET PRE-UPGRADE LOBBIES: ${codes.join(', ')}`)
  for (const code of codes) {
    const row = await fetchByCode(sb, code)
    if (!row) {
      console.log(`  ${code}: NOT FOUND`)
      continue
    }
    const paidFlag = Boolean(row.escrow_id)
    console.log(
      `  ${code}: found  paid=${paidFlag}  is_live=${row.is_live}  status=${row.status}  "${row.name}"`,
    )
  }
}

// ── Purge ──────────────────────────────────────────────────────────────────

interface PurgeResult {
  code: string
  cancelTx: string | null
  cancelSkippedReason?: string
  onchainBefore: string
  onchainAfter: string
  deleted: Record<string, number>
  withdrawable: { wallet: string; funded: boolean; refunded: boolean }[]
}

async function pollForState(
  esc: EscrowModule,
  escrowId: Hex,
  want: number,
  tries = 30,
): Promise<number> {
  let last = -1
  for (let i = 0; i < tries; i++) {
    try {
      const g = await esc.getOnchainGame(escrowId)
      last = g.state
      if (g.state === want) return g.state
    } catch {
      /* replica lag / transient */
    }
    await sleep(2000)
  }
  return last
}

async function runPurge(): Promise<void> {
  const dryRun = hasFlag('dry-run')
  const sb = await loadSupabase()
  const svc = await loadService()
  const esc = await loadEscrow()
  const codes = (argValue('codes')?.split(',').map((s) => s.trim()).filter(Boolean)) ?? DEFAULT_CODES

  banner([
    dryRun ? 'PURGE (DRY RUN - no writes)' : 'PURGE (LIVE - will cancel on-chain + delete rows)',
    `targets: ${codes.join(', ')}`,
    `escrow ${esc.escrowAddress()}  chain ${CHAIN_ID}`,
  ])

  const opBefore = await publicClient.getBalance({ address: operatorAddress })
  log(`Operator ${operatorAddress} balance before: ${formatEther(opBefore)} ETH`)

  const wlBefore = (await sb.from('tournament_waitlist').select('*', { count: 'exact', head: true })).count ?? -1
  const liveBefore = (await sb.from('tournaments').select('code,name,status').eq('is_live', true))
    .data as { code: string; name: string; status: string }[] | null
  log(`Global tournament_waitlist rows before: ${wlBefore}`)
  log(`Featured/free (is_live) before: ${(liveBefore ?? []).map((t) => `${t.code} "${t.name}" (${t.status})`).join('; ') || '(none)'}`)

  const results: PurgeResult[] = []
  const demoWalletsSeen = new Set<string>()

  for (const code of codes) {
    banner([`TARGET ${code}`])
    const row = await fetchByCode(sb, code)
    if (!row) {
      log(`  ${code}: NOT FOUND - skipping.`)
      continue
    }
    // Hard safety gates.
    if (!row.escrow_id) {
      log(`  ${code}: NOT PAID (no escrow_id) - REFUSING to touch. Skipping.`)
      continue
    }
    if (row.is_live) {
      log(`  ${code}: is_live=TRUE (featured/free event) - REFUSING to touch. Skipping.`)
      continue
    }
    const escrowId = row.escrow_id as Hex
    const onchainBefore = await onchainSummary(esc, escrowId)
    log(`  ${code}: "${row.name}" status=${row.status}`)
    log(`  chain before: ${onchainBefore}`)

    const players = await playersOf(sb, row.id)
    const fundedDb = players.filter((p) => p.funded && !p.refunded)
    for (const p of players) {
      const prof = await sb
        .from('wallet_profiles')
        .select('x_handle')
        .eq('wallet_address', (p.wallet_address ?? '').toLowerCase())
        .maybeSingle()
      const handle = (prof.data as { x_handle?: string } | null)?.x_handle
      if (handle && handle.startsWith('demo_') && p.wallet_address) {
        demoWalletsSeen.add(p.wallet_address.toLowerCase())
      }
    }
    log(`  funded players (db, not refunded): ${fundedDb.length}`)

    // Read on-chain funded status for each funded player (pre-cancel record).
    for (const p of fundedDb) {
      if (!p.wallet_address) continue
      try {
        const st = await esc.getFundingStatus(escrowId, p.wallet_address as Hex)
        log(`    ${p.wallet_address} onchain funded=${st.funded} refunded=${st.refunded}`)
      } catch {
        /* ignore */
      }
    }

    // Count DB rows for reporting before delete. NOTE: tournament_waitlist is
    // GLOBAL (no tournament_id; only a converted_tournament_id back-reference
    // with `on delete set null`). It belongs to the featured/free flow, so we
    // NEVER delete from it. We only count how many waitlist rows were converted
    // INTO this paid game (expected 0) for the report; the tournament delete
    // safely nulls any such back-reference.
    const deleted: Record<string, number> = {
      'waitlist_converted_refs (not deleted)': await countRows(
        sb,
        'tournament_waitlist',
        'converted_tournament_id',
        row.id,
      ),
      poll_votes: await countRows(sb, 'poll_votes', 'tournament_id', row.id),
      matches: await countRows(sb, 'matches', 'tournament_id', row.id),
      rounds: await countRows(sb, 'rounds', 'tournament_id', row.id),
      players: players.length,
      tournaments: 1,
    }

    let cancelTx: string | null = null
    let cancelSkippedReason: string | undefined

    // Decide whether an on-chain cancel is needed (state Funding or Locked).
    let stateNum = -1
    try {
      stateNum = (await esc.getOnchainGame(escrowId)).state
    } catch {
      /* handled below */
    }

    if (dryRun) {
      log(`  [dry-run] would cancel on-chain if state in {Funding,Locked} (state=${STATE_NAME[stateNum] ?? stateNum}) then delete rows.`)
      results.push({
        code,
        cancelTx: null,
        cancelSkippedReason: 'dry-run',
        onchainBefore,
        onchainAfter: onchainBefore,
        deleted,
        withdrawable: [],
      })
      continue
    }

    if (stateNum === 1 /* Funding */ || stateNum === 2 /* Locked */) {
      log(`  cancelling on-chain (operator cancelGame)...`)
      try {
        const res = await svc.adminCancelPaidGame(code) // on-chain cancel + flips status=cancelled, awaits receipt
        cancelTx = res.txHash
        log(`  on-chain cancel tx: ${cancelTx ?? '(no tx)'}`)
      } catch (e) {
        cancelSkippedReason = e instanceof Error ? e.message : String(e)
        log(`  CANCEL FAILED: ${cancelSkippedReason} - STOPPING this target (not deleting rows).`)
        results.push({ code, cancelTx, cancelSkippedReason, onchainBefore, onchainAfter: onchainBefore, deleted: {}, withdrawable: [] })
        continue
      }
      // Confirm Cancelled on-chain (ride out replica lag).
      const finalState = await pollForState(esc, escrowId, 4 /* Cancelled */)
      log(`  chain state after cancel: ${STATE_NAME[finalState] ?? finalState}`)
      if (finalState !== 4) {
        log(`  WARNING: on-chain state is not Cancelled yet (${STATE_NAME[finalState] ?? finalState}). STOPPING this target (not deleting rows).`)
        results.push({ code, cancelTx, cancelSkippedReason: 'state not Cancelled after cancel', onchainBefore, onchainAfter: await onchainSummary(esc, escrowId), deleted: {}, withdrawable: [] })
        continue
      }
    } else if (stateNum === 3 /* Paid */) {
      cancelSkippedReason = 'already settled on-chain (Paid); funds already distributed'
      log(`  ${cancelSkippedReason} - no cancel needed.`)
    } else {
      cancelSkippedReason = `on-chain state ${STATE_NAME[stateNum] ?? stateNum}; no open funds to cancel`
      log(`  ${cancelSkippedReason} - no cancel needed.`)
      // Still flip DB mirror to cancelled for consistency before delete (best-effort).
    }

    // Verify each funded player's stake is withdrawable (funded && !refunded on-chain).
    const withdrawable: { wallet: string; funded: boolean; refunded: boolean }[] = []
    for (const p of fundedDb) {
      if (!p.wallet_address) continue
      try {
        const st = await esc.getFundingStatus(escrowId, p.wallet_address as Hex)
        withdrawable.push({ wallet: p.wallet_address, funded: st.funded, refunded: st.refunded })
      } catch {
        withdrawable.push({ wallet: p.wallet_address, funded: false, refunded: false })
      }
    }

    // Delete DB rows. The global tournament_waitlist is deliberately left alone
    // (see note above). players / rounds / matches / schedule_proposals /
    // poll_votes all cascade from the tournament row delete, and any
    // waitlist.converted_tournament_id back-reference is nulled (set null).
    const { error: delErr } = await sb.from('tournaments').delete().eq('id', row.id)
    if (delErr) {
      log(`  DELETE FAILED for ${code}: ${delErr.message}`)
      results.push({ code, cancelTx, cancelSkippedReason, onchainBefore, onchainAfter: await onchainSummary(esc, escrowId), deleted: {}, withdrawable })
      continue
    }
    log(`  deleted tournament row + cascaded players/rounds/matches/proposals/poll_votes.`)

    results.push({
      code,
      cancelTx,
      cancelSkippedReason,
      onchainBefore,
      onchainAfter: await onchainSummary(esc, escrowId),
      deleted,
      withdrawable,
    })
  }

  // Best-effort cleanup of demo wallet leftovers we touched.
  if (!dryRun && demoWalletsSeen.size > 0) {
    const arr = [...demoWalletsSeen]
    try {
      await sb.from('wallet_reliability').delete().in('wallet_address', arr)
    } catch {
      /* table may be absent */
    }
    try {
      await sb.from('wallet_profiles').delete().in('wallet_address', arr)
    } catch {
      /* best-effort */
    }
    log(`Removed demo wallet_profiles/reliability for ${arr.length} wallet(s) referenced by targets.`)
  }

  const opAfter = await publicClient.getBalance({ address: operatorAddress })

  // ── Final report ─────────────────────────────────────────────────────────
  const lines: string[] = ['PURGE SUMMARY']
  for (const r of results) {
    lines.push(`  ${r.code}:`)
    lines.push(`    cancel tx: ${r.cancelTx ?? (r.cancelSkippedReason ? `(skipped: ${r.cancelSkippedReason})` : '(none)')}`)
    lines.push(`    chain before: ${r.onchainBefore}`)
    lines.push(`    chain after:  ${r.onchainAfter}`)
    const delStr = Object.entries(r.deleted).map(([k, v]) => `${k}=${v}`).join(', ')
    lines.push(`    deleted rows: ${delStr || '(none)'}`)
    if (r.withdrawable.length) {
      for (const w of r.withdrawable) {
        lines.push(`    withdrawable: ${w.wallet} funded=${w.funded} refunded=${w.refunded}`)
      }
    } else {
      lines.push(`    withdrawable: (no funded players)`)
    }
  }
  banner(lines)

  log(`Operator balance after: ${formatEther(opAfter)} ETH`)
  const spent = opBefore - opAfter
  log(`Operator ETH spent this run: ${formatEther(spent)} ETH`)

  // Post-purge verification.
  const open = await svc.listOpenPaidGames()
  const wlAfter = (await sb.from('tournament_waitlist').select('*', { count: 'exact', head: true })).count ?? -1
  const liveAfter = (await sb.from('tournaments').select('code,name,status').eq('is_live', true))
    .data as { code: string; name: string; status: string }[] | null
  banner([
    'VERIFICATION',
    `listOpenPaidGames() -> ${open.length} game(s)` + (open.length ? ':' : ''),
    ...open.map((g) => `  ${g.code} "${g.name}" status=${g.status}`),
    `global tournament_waitlist rows: ${wlBefore} -> ${wlAfter} (must be unchanged)`,
    `featured/free (is_live) after: ${(liveAfter ?? []).map((t) => `${t.code} "${t.name}" (${t.status})`).join('; ') || '(none)'}`,
  ])
}

async function main(): Promise<void> {
  if (!RPC_URL || !OPERATOR_KEY || !process.env.TOURNAMENT_ESCROW_ADDRESS) {
    throw new Error('Missing TOURNAMENT_ESCROW_* env in .env.local.')
  }
  if (!process.env.TOURNAMENT_SUPABASE_URL || !process.env.TOURNAMENT_SUPABASE_SECRET_KEY) {
    throw new Error('Missing TOURNAMENT_SUPABASE_* env in .env.local.')
  }
  if (hasFlag('inventory')) return runInventory()
  if (hasFlag('purge')) return runPurge()
  console.log(
    [
      'Usage:',
      '  npx tsx scripts/tournament/purge-paid.ts --inventory',
      '  npx tsx scripts/tournament/purge-paid.ts --purge [--codes=PG-A,PG-B] [--dry-run]',
    ].join('\n'),
  )
  process.exit(1)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
