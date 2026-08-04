/* eslint-disable no-console */
/**
 * DEMO HARNESS for the paid-tournament flow (Base Sepolia + Supabase).
 *
 * A non-technical operator can WATCH a real paid tournament run end to end in
 * the browser, or be FORCED to intervene through the admin panel. Bots do all
 * the work (enroll, fund on-chain, report results); the human only observes or
 * resolves a dispute.
 *
 * The harness drives the SERVICE layer directly (the exact functions the app's
 * route handlers call) and signs on-chain deposits with throwaway bot wallets
 * via viem. It never talks to the dev server. The operator's browser (served by
 * the dev server, reading the same Supabase DB) reflects every write.
 *
 * Modes:
 *   npx tsx scripts/tournament/demo-tournament.ts --mode=auto      [--players=4] [--entry=100000] [--pace=15]
 *   npx tsx scripts/tournament/demo-tournament.ts --mode=intervene [--players=4] ...
 *   npx tsx scripts/tournament/demo-tournament.ts --cleanup
 *
 * SAFETY: only ever touches games this harness created (names prefixed "DEMO ").
 * It never touches the operator's real games or the featured/free event. It
 * never prints secrets. Bot gas is floated from the operator wallet in tiny
 * amounts and swept back.
 *
 * NOTE ON MODULE CONDITIONS: the service layer imports `server-only`, which
 * throws unless Node runs with `--conditions=react-server`. So the documented
 * commands above work as-is, this file RE-EXECS itself once with that flag.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap: load .env.local, then re-exec under --conditions=react-server so
// importing the service layer (which pulls `server-only`) does not throw. We do
// the re-exec BEFORE importing anything server-only, so the outer process never
// touches it.
// ─────────────────────────────────────────────────────────────────────────

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

if (!process.env.__DEMO_REEXEC) {
  const res = spawnSync(
    'npx',
    ['tsx', '--conditions=react-server', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __DEMO_REEXEC: '1' }, cwd: REPO_ROOT },
  )
  process.exit(res.status ?? 1)
}

// Everything below only runs in the re-exec'd (react-server) child.

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  getAddress,
  parseEventLogs,
  type Hex,
  type Address,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TournamentSnapshot, Player, Match } from '../../src/lib/tournament/types'
import type { PayoutPreset } from '../../src/lib/tournament/paid'

// ── Typed views of the service + supabase modules we import at runtime ──────

type ReportedResult = 'win' | 'loss' | 'draw'

interface DemoService {
  adminCreatePaidGame(input: {
    name: string
    entryFeeUsdc?: number
    rakeBps?: number
    payoutPreset: string
    maxPlayers: number
    roundMinutes: number
    game?: string
    lobbyRegion?: string | null
  }): Promise<{ code: string }>
  enroll(
    code: string,
    xHandle: string,
    deckList?: string | null,
    walletAddress?: string | null,
    region?: string | null,
  ): Promise<{ player: Player; playerToken: string }>
  adminApprovePlayer(code: string, playerId: string): Promise<void>
  confirmDeposit(code: string, walletAddress: string, txHash: string): Promise<Player>
  adminStartBracket(code: string): Promise<void>
  reportResultByWallet(
    code: string,
    matchId: string,
    walletAddress: string,
    xHandle: string | null,
    result: ReportedResult,
  ): Promise<void>
  adminSetResult(code: string, matchId: string, result: 'p1' | 'p2' | 'draw'): Promise<void>
  attachDisputeLog(
    code: string,
    matchId: string,
    walletAddress: string,
    xHandle: string | null,
    input: { url?: string | null; text?: string | null },
  ): Promise<void>
  getSnapshotByCode(code: string): Promise<TournamentSnapshot>
  adminCancelPaidGame(code: string): Promise<{ txHash: string | null }>
}

interface SupaModule {
  getServiceClient(): SupabaseClient
}

// ── On-chain constants + minimal ABIs ──────────────────────────────────────

const ESCROW_ADDRESS = getAddress(
  (process.env.TOURNAMENT_ESCROW_ADDRESS ?? '') as string,
) as Address
const RPC_URL = process.env.TOURNAMENT_ESCROW_RPC_URL as string
const OPERATOR_KEY = process.env.TOURNAMENT_ESCROW_OPERATOR_KEY as Hex

const ERC20_ABI = [
  {
    type: 'function',
    name: 'allowance',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'balanceOf',
    stateMutability: 'view',
    inputs: [{ name: 'account', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'mint',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
] as const

const ESCROW_ABI = [
  {
    type: 'function',
    name: 'usdc',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claimable',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'account', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'getGame',
    stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'state', type: 'uint8' },
      { name: 'entryFee', type: 'uint256' },
      { name: 'cap', type: 'uint32' },
      { name: 'fundedCount', type: 'uint32' },
      { name: 'rakeBps', type: 'uint16' },
      { name: 'pot', type: 'uint256' },
      { name: 'lockedAt', type: 'uint64' },
      { name: 'payoutBps', type: 'uint16[]' },
    ],
  },
  {
    type: 'event',
    name: 'Settled',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'winners', type: 'address[]', indexed: false },
      { name: 'amounts', type: 'uint256[]', indexed: false },
      { name: 'rake', type: 'uint256', indexed: false },
      { name: 'platform', type: 'address', indexed: false },
    ],
  },
] as const

const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC_URL) })
const operatorAccount = privateKeyToAccount(OPERATOR_KEY)
const operatorWallet = createWalletClient({
  account: operatorAccount,
  chain: baseSepolia,
  transport: http(RPC_URL),
})

// ── Small utilities ────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const bigMax = (a: bigint, b: bigint) => (a > b ? a : b)
const WATCH_BASE = argValue('base') ?? 'http://localhost:3000'

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

// A light, non-empty deck list. Validation is intentionally lenient (non-empty,
// under the size caps); contents need not be a legal deck for the demo.
const DEMO_DECK_LIST = [
  '1xOP01-001',
  '4xOP01-016',
  '4xOP01-024',
  '4xOP01-025',
  '4xOP01-026',
  '4xOP01-029',
  '4xOP01-031',
  '4xOP01-033',
  '4xOP01-040',
  '4xOP01-047',
  '2xOP01-051',
  '2xOP01-062',
  '2xOP01-091',
  '2xST01-006',
  '3xST01-007',
  '4xOP01-120',
].join('\n')

// ── CLI args ───────────────────────────────────────────────────────────────

function argValue(name: string): string | undefined {
  const pref = `--${name}=`
  const hit = process.argv.find((a) => a.startsWith(pref))
  return hit ? hit.slice(pref.length) : undefined
}
function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`)
}
function intArg(name: string, fallback: number): number {
  const v = argValue(name)
  if (v == null) return fallback
  const n = Number(v)
  return Number.isFinite(n) ? Math.floor(n) : fallback
}

// ── Persistent state (throwaway bot keys, so --cleanup can sweep gas) ───────

interface BotRecord {
  address: string
  pk: string
  handle: string
}
interface RunRecord {
  code: string
  mode: string
  createdAt: string
  bots: BotRecord[]
}
interface DemoState {
  runs: RunRecord[]
}

const STATE_FILE = path.join(HERE, '.demo-state.json')

function loadState(): DemoState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as DemoState
    }
  } catch {
    /* corrupt or missing state resets to empty */
  }
  return { runs: [] }
}
function saveState(s: DemoState): void {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2))
}
function recordRun(run: RunRecord): void {
  const s = loadState()
  s.runs = s.runs.filter((r) => r.code !== run.code)
  s.runs.push(run)
  saveState(s)
}
function forgetRun(code: string): void {
  const s = loadState()
  s.runs = s.runs.filter((r) => r.code !== code)
  saveState(s)
}

// ── Module loaders (runtime string imports keep tsc happy + defer server-only)

async function loadService(): Promise<DemoService> {
  const mod = (await import(path.join(REPO_ROOT, 'src/lib/tournament/service.ts'))) as unknown
  return mod as DemoService
}
async function loadSupabase(): Promise<SupabaseClient> {
  const mod = (await import(path.join(REPO_ROOT, 'src/lib/tournament/supabase.ts'))) as unknown
  return (mod as SupaModule).getServiceClient()
}

// ── Bot wallets ──────────────────────────────────────────────────────────--

interface Bot {
  handle: string
  pk: Hex
  address: Address
  wallet: ReturnType<typeof createWalletClient>
}

function makeBots(n: number): Bot[] {
  const bots: Bot[] = []
  const seen = new Set<string>()
  while (bots.length < n) {
    const suffix = Math.random().toString(36).slice(2, 6)
    const handle = `demo_${suffix}`
    if (seen.has(handle) || suffix.length < 4) continue
    seen.add(handle)
    const pk = generatePrivateKey()
    const account = privateKeyToAccount(pk)
    bots.push({
      handle,
      pk,
      address: account.address,
      wallet: createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) }),
    })
  }
  return bots
}

// ── On-chain helpers ─────────────────────────────────────────────────────--

async function readUsdcToken(): Promise<Address> {
  const token = (await publicClient.readContract({
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'usdc',
  })) as Address
  return getAddress(token)
}

/** Tiny per-bot gas float sized to current gas price (min 0.0004 ETH). */
async function gasFloatWei(): Promise<bigint> {
  const gp = await publicClient.getGasPrice()
  return bigMax(gp * BigInt(1_000_000), parseEther('0.0004'))
}

async function fundBotGas(bot: Bot, amount: bigint): Promise<void> {
  const hash = await operatorWallet.sendTransaction({
    account: operatorAccount,
    chain: baseSepolia,
    to: bot.address,
    value: amount,
  })
  await publicClient.waitForTransactionReceipt({ hash })
  // Poll for replica lag so the bot's own txs don't fail on a stale balance.
  for (let i = 0; i < 30; i++) {
    const bal = await publicClient.getBalance({ address: bot.address })
    if (bal >= amount) return
    await sleep(1000)
  }
}

async function mintUsdc(bot: Bot, token: Address, amount: bigint): Promise<void> {
  const hash = await bot.wallet.writeContract({
    account: bot.wallet.account!,
    chain: baseSepolia,
    address: token,
    abi: ERC20_ABI,
    functionName: 'mint',
    args: [bot.address, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  for (let i = 0; i < 30; i++) {
    const bal = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [bot.address],
    })) as bigint
    if (bal >= amount) return
    await sleep(1000)
  }
}

async function approveUsdc(bot: Bot, token: Address, amount: bigint): Promise<void> {
  const current = (await publicClient.readContract({
    address: token,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [bot.address, ESCROW_ADDRESS],
  })) as bigint
  if (current >= amount) return
  const hash = await bot.wallet.writeContract({
    account: bot.wallet.account!,
    chain: baseSepolia,
    address: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [ESCROW_ADDRESS, amount],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  // Poll allowance before the dependent deposit (RPC replica lag).
  for (let i = 0; i < 30; i++) {
    const a = (await publicClient.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [bot.address, ESCROW_ADDRESS],
    })) as bigint
    if (a >= amount) return
    await sleep(1000)
  }
}

async function depositToEscrow(bot: Bot, escrowId: Hex): Promise<Hex> {
  const hash = await bot.wallet.writeContract({
    account: bot.wallet.account!,
    chain: baseSepolia,
    address: ESCROW_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'deposit',
    args: [escrowId],
  })
  await publicClient.waitForTransactionReceipt({ hash })
  return hash
}

/** Sweep a bot's leftover gas back to the operator. Best-effort. */
async function sweepBotGas(pk: Hex): Promise<bigint> {
  try {
    const account = privateKeyToAccount(pk)
    const wallet = createWalletClient({ account, chain: baseSepolia, transport: http(RPC_URL) })
    const bal = await publicClient.getBalance({ address: account.address })
    const gp = await publicClient.getGasPrice()
    const cost = gp * BigInt(21_000)
    const buffer = cost * BigInt(3) // headroom so the sweep tx itself never underpays
    if (bal <= buffer) return BigInt(0)
    const value = bal - buffer
    const hash = await wallet.sendTransaction({
      account,
      chain: baseSepolia,
      to: operatorAccount.address,
      value,
    })
    await publicClient.waitForTransactionReceipt({ hash })
    return value
  } catch {
    return BigInt(0)
  }
}

// ── Payout preset selection ──────────────────────────────────────────────--

/**
 * Choose a payout preset that is GUARANTEED to settle cleanly on autopilot for
 * the way this harness drives results (a strict seed-order dominance, so
 * standings come out fully separated with no boundary ties):
 *  - a 4-player Swiss is a perfect round-robin, so top3 yields a strict
 *    3-0 / 2-1 / 1-2 / 0-3 order with three distinct paid winners.
 *  - any other field defaults to wta (only the sole undefeated leader is paid,
 *    which is always unambiguous), avoiding a merit-tie at a payout boundary
 *    that paidWinnerAddresses would (correctly) refuse to auto-settle.
 * intervene mode always uses wta: the operator's dispute ruling can perturb the
 * lower placements, but the seed-1 champion stays undefeated and unique.
 */
function pickPreset(mode: string, players: number): PayoutPreset {
  const override = argValue('payout') as PayoutPreset | undefined
  if (override) return override
  if (mode === 'auto' && players === 4) return 'top3'
  return 'wta'
}

// ── Setup shared by both run modes ─────────────────────────────────────────

interface RunContext {
  svc: DemoService
  code: string
  escrowId: Hex
  bots: Bot[]
  token: Address
  entry: bigint
}

async function setupGame(mode: string): Promise<RunContext> {
  const svc = await loadService()
  const sb = await loadSupabase()
  const players = intArg('players', 4)
  const entryUnits = intArg('entry', 100_000) // 6-decimal USDC units (default $0.10)
  const entry = BigInt(entryUnits)
  const rake = intArg('rake', 1500)
  const preset = pickPreset(mode, players)

  banner([
    `DEMO paid tournament - mode=${mode}`,
    `players=${players}  entry=${usdc(entry)}  rake=${rake}bps  payout=${preset}`,
  ])

  // 1) Create the paid game (opens it on-chain, operator-signed).
  const name = `DEMO ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`
  log(`Creating paid game "${name}" (on-chain createGame + DB row)...`)
  const { code } = await svc.adminCreatePaidGame({
    name,
    entryFeeUsdc: entryUnits,
    rakeBps: rake,
    payoutPreset: preset,
    maxPlayers: players,
    roundMinutes: 30, // >= 15; deadlines never fire since we drive results
    game: 'one-piece',
    lobbyRegion: null, // open lobby, no region lock
  })
  const snap0 = await svc.getSnapshotByCode(code)
  const escrowId = snap0.tournament.escrowId as Hex

  banner([
    `GAME CREATED: ${code}`,
    `WATCH:  ${WATCH_BASE}/tournaments/paid/${code}`,
    `LOBBY:  ${WATCH_BASE}/tournaments/paid`,
  ])

  // 2) Generate bots and record them first, so a crash still lets --cleanup
  //    find + sweep their gas.
  const bots = makeBots(players)
  recordRun({
    code,
    mode,
    createdAt: new Date().toISOString(),
    bots: bots.map((b) => ({ address: b.address, pk: b.pk, handle: b.handle })),
  })

  const token = await readUsdcToken()
  const float = await gasFloatWei()
  log(`Settlement token (escrow.usdc()): ${token}`)
  log(`Per-bot gas float: ${formatEther(float)} ETH`)

  // 3) Enroll -> approve -> fund each bot, one at a time so the operator sees
  //    applications appear then funded counts climb on the live page.
  let funded = 0
  for (const bot of bots) {
    // players.wallet_address is a FK to wallet_profiles; seed a minimal profile
    // for each throwaway bot so its enrollment (with a wallet) is accepted.
    const { error: profErr } = await sb
      .from('wallet_profiles')
      .upsert(
        { wallet_address: bot.address.toLowerCase(), x_handle: bot.handle },
        { onConflict: 'wallet_address' },
      )
    if (profErr) throw new Error(`Could not seed wallet profile: ${profErr.message}`)

    log(`[@${bot.handle}] enrolling (${bot.address})...`)
    const { player } = await svc.enroll(code, bot.handle, DEMO_DECK_LIST, bot.address, 'amer')
    log(`[@${bot.handle}] approving entry...`)
    await svc.adminApprovePlayer(code, player.id)

    log(`[@${bot.handle}] floating gas + minting ${usdc(entry)} mock USDC...`)
    await fundBotGas(bot, float)
    await mintUsdc(bot, token, entry)
    log(`[@${bot.handle}] approving escrow + depositing on-chain...`)
    await approveUsdc(bot, token, entry)
    const depositTx = await depositToEscrow(bot, escrowId)

    log(`[@${bot.handle}] confirming deposit (waiting for confirmations)...`)
    await confirmDepositWithRetry(svc, code, bot.address, depositTx)
    funded++
    log(`[@${bot.handle}] FUNDED. (${funded}/${players} funded)`)
  }

  return { svc, code, escrowId, bots, token, entry }
}

async function confirmDepositWithRetry(
  svc: DemoService,
  code: string,
  address: Address,
  txHash: Hex,
): Promise<void> {
  let lastErr = ''
  for (let i = 0; i < 40; i++) {
    try {
      const p = await svc.confirmDeposit(code, address, txHash)
      if (p.funded) return
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err)
    }
    await sleep(3000)
  }
  throw new Error(`Deposit never confirmed for ${address}: ${lastErr}`)
}

// ── Result driving ─────────────────────────────────────────────────────────

function seedOf(snap: TournamentSnapshot, playerId: string): number {
  return snap.players.find((p) => p.id === playerId)?.seed ?? Number.MAX_SAFE_INTEGER
}
function playerById(snap: TournamentSnapshot, id: string): Player | undefined {
  return snap.players.find((p) => p.id === id)
}
function activeRound(snap: TournamentSnapshot) {
  return [...snap.rounds].filter((r) => r.status === 'active').sort((a, b) => a.number - b.number).pop()
}

/** Report a decisive result: lower seed wins, both sides agree -> confirmed. */
async function reportDecisive(svc: DemoService, snap: TournamentSnapshot, m: Match): Promise<string> {
  const s1 = seedOf(snap, m.player1Id)
  const s2 = seedOf(snap, m.player2Id as string)
  const winnerId = s1 <= s2 ? m.player1Id : (m.player2Id as string)
  const loserId = winnerId === m.player1Id ? (m.player2Id as string) : m.player1Id
  const winner = playerById(snap, winnerId)!
  const loser = playerById(snap, loserId)!
  await svc.reportResultByWallet(snap.tournament.code, m.id, winner.walletAddress!, winner.xHandle, 'win')
  await svc.reportResultByWallet(snap.tournament.code, m.id, loser.walletAddress!, loser.xHandle, 'loss')
  return `@${winner.xHandle} def. @${loser.xHandle}`
}

/** Make two bots BOTH claim the win -> the match goes 'disputed'. */
async function forceDispute(svc: DemoService, snap: TournamentSnapshot, m: Match): Promise<void> {
  const p1 = playerById(snap, m.player1Id)!
  const p2 = playerById(snap, m.player2Id as string)!
  await svc.reportResultByWallet(snap.tournament.code, m.id, p1.walletAddress!, p1.xHandle, 'win')
  await svc.reportResultByWallet(snap.tournament.code, m.id, p2.walletAddress!, p2.xHandle, 'win')
}

function openMatches(snap: TournamentSnapshot, roundId: string): Match[] {
  return snap.matches.filter(
    (m) =>
      m.roundId === roundId &&
      m.player2Id != null &&
      m.status !== 'confirmed' &&
      m.status !== 'bye' &&
      m.status !== 'double_forfeit' &&
      m.status !== 'disputed',
  )
}

/**
 * Drive the tournament to completion. In intervene mode, round 1 seeds a
 * disputed match (not involving the seed-1 champion) that halts autopilot until
 * the operator resolves it in the admin UI.
 */
async function playToCompletion(
  svc: DemoService,
  code: string,
  opts: { pace: number; intervene: boolean },
): Promise<void> {
  let disputeDone = !opts.intervene

  while (true) {
    const snap = await svc.getSnapshotByCode(code)
    const status = snap.tournament.status
    if (status === 'complete') break
    if (status === 'cancelled') throw new Error('Tournament was cancelled unexpectedly.')

    const round = activeRound(snap)
    if (!round) {
      await sleep(2000)
      continue
    }

    // Intervene: engineer + wait out a dispute in round 1 before normal play.
    if (!disputeDone && round.number === 1) {
      await runInterveneRound1(svc, code, round.id, opts.pace)
      disputeDone = true
      continue
    }

    const open = openMatches(snap, round.id)
    if (open.length === 0) {
      // Round is fully reported but the advance write may not have landed yet.
      await sleep(2000)
      continue
    }

    for (const m of open) {
      const line = await reportDecisive(svc, snap, m)
      log(`R${round.number} M${m.number}: ${line}  [confirmed]`)
      await sleep(opts.pace * 1000)
    }
  }
}

async function runInterveneRound1(
  svc: DemoService,
  code: string,
  roundId: string,
  pace: number,
): Promise<void> {
  let snap = await svc.getSnapshotByCode(code)
  const champId = snap.players.find((p) => p.seed === 1)?.id
  const round1 = snap.matches.filter(
    (m) => m.roundId === roundId && m.player2Id != null && m.status !== 'bye',
  )
  // Prefer a match with NEITHER player being the champion, so the seed-1
  // champion still wins a clean decisive match and stays undefeated.
  const disputeMatch =
    round1.find((m) => m.player1Id !== champId && m.player2Id !== champId) ?? round1[0]

  // Report every OTHER round-1 match decisively first.
  for (const m of round1) {
    if (m.id === disputeMatch.id) continue
    const line = await reportDecisive(svc, snap, m)
    log(`R1 M${m.number}: ${line}  [confirmed]`)
    await sleep(pace * 1000)
  }

  // Now force the dispute.
  const p1 = playerById(snap, disputeMatch.player1Id)!
  const p2 = playerById(snap, disputeMatch.player2Id as string)!
  await forceDispute(svc, snap, disputeMatch)
  log(`R1 M${disputeMatch.number}: @${p1.xHandle} and @${p2.xHandle} BOTH claimed the win -> DISPUTED`)

  // One of the two disputing bots attaches a realistic OPTCG Sim battle log as
  // evidence, using the exact service path the real "Your match" UI calls. The
  // operator sees this in the admin match row before they pick a winner.
  const evidenceUrl = `https://optcgsim.com/replay/${disputeMatch.id.slice(0, 8)}-r1m${disputeMatch.number}`
  const evidenceText = [
    'OPTCG Sim - best of 3 match log',
    `G1: @${p1.xHandle} (Red Luffy) def. @${p2.xHandle} (Green Uta). Lethal on turn 7 with Gum-Gum Red Roc.`,
    `G2: @${p2.xHandle} def. @${p1.xHandle}. Won the race by one attack after a double blocker trade.`,
    `G3: @${p1.xHandle} def. @${p2.xHandle}. Opponent conceded with an empty hand and no board.`,
    `Result: @${p1.xHandle} wins the set 2-1.`,
  ].join('\n')
  try {
    await svc.attachDisputeLog(code, disputeMatch.id, p1.walletAddress!, p1.xHandle, {
      url: evidenceUrl,
      text: evidenceText,
    })
    log(`@${p1.xHandle} attached battle-log evidence to the disputed match.`)
  } catch (err) {
    // Never let an evidence hiccup block the operator-intervention flow.
    log(`Could not attach battle-log evidence: ${err instanceof Error ? err.message : String(err)}`)
  }

  banner([
    'ACTION NEEDED - operator intervention required',
    `Open ${WATCH_BASE}/tournaments/paid/admin`,
    'Unlock with the admin password, then select game ' + code + '.',
    `Resolve the disputed match: @${p1.xHandle} vs @${p2.xHandle}`,
    '(pick a winner to set its result). Waiting...',
  ])

  // Poll until the operator resolves the dispute in the admin UI.
  let waited = 0
  while (true) {
    await sleep(5000)
    waited += 5
    snap = await svc.getSnapshotByCode(code)
    const m = snap.matches.find((x) => x.id === disputeMatch.id)
    if (!m || m.status !== 'disputed') {
      const w = m?.winnerId ? playerById(snap, m.winnerId)?.xHandle : null
      log(`Dispute resolved by operator${w ? ` (winner @${w})` : ''}. Resuming play.`)
      return
    }
    if (waited % 30 === 0) log(`Still waiting for the operator to resolve the dispute (${waited}s)...`)
  }
}

// ── Settlement report ──────────────────────────────────────────────────────

async function waitForSettlement(escrowId: Hex): Promise<boolean> {
  for (let i = 0; i < 40; i++) {
    try {
      const g = (await publicClient.readContract({
        address: ESCROW_ADDRESS,
        abi: ESCROW_ABI,
        functionName: 'getGame',
        args: [escrowId],
      })) as readonly unknown[]
      if (Number(g[0]) === 3) return true // 3 = Paid
    } catch {
      /* transient read error; retry */
    }
    await sleep(3000)
  }
  return false
}

async function findSettleTx(escrowId: Hex): Promise<Hex | null> {
  // The settle just happened, so it is within the last few blocks. The RPC's
  // free tier caps eth_getLogs to a 10-block range, so scan recent history in
  // small windows newest-first until we find our game's Settled event.
  const settledEvent = ESCROW_ABI.find((e) => e.type === 'event' && e.name === 'Settled')
  try {
    const latest = await publicClient.getBlockNumber()
    const window = BigInt(9)
    for (let i = 0; i < 30; i++) {
      const toBlock = latest - BigInt(i) * (window + BigInt(1))
      if (toBlock < BigInt(0)) break
      const fromBlock = toBlock - window > BigInt(0) ? toBlock - window : BigInt(0)
      try {
        const logs = await publicClient.getLogs({
          address: ESCROW_ADDRESS,
          event: settledEvent as never,
          args: { id: escrowId } as never,
          fromBlock,
          toBlock,
        })
        if (logs.length > 0) {
          const hit = logs[logs.length - 1] as { transactionHash?: Hex }
          return hit.transactionHash ?? null
        }
      } catch {
        /* window read failed; try the next one */
      }
    }
  } catch {
    /* could not read block number */
  }
  return null
}

async function reportFinal(ctx: RunContext): Promise<void> {
  const snap = await ctx.svc.getSnapshotByCode(ctx.code)
  const settled = await waitForSettlement(ctx.escrowId)
  const settleTx = settled ? await findSettleTx(ctx.escrowId) : null

  const nameById = new Map(snap.players.map((p) => [p.id, p]))
  const lines: string[] = ['FINAL STANDINGS']
  for (const s of snap.standings) {
    const p = nameById.get(s.playerId)
    lines.push(
      `  #${s.rank}  @${p?.xHandle ?? '?'}  ${s.wins}-${s.losses}-${s.draws}  (${s.points} pts)`,
    )
  }
  banner(lines)

  log(settled ? 'On-chain state: Paid (autopilot settled).' : 'On-chain state: NOT settled yet.')
  if (settleTx) log(`Settle tx: ${settleTx}`)

  // Show who can claim (on-chain claimable per bot wallet).
  const claimLines: string[] = ['CLAIMABLE PAYOUTS']
  for (const bot of ctx.bots) {
    const c = (await publicClient.readContract({
      address: ESCROW_ADDRESS,
      abi: ESCROW_ABI,
      functionName: 'claimable',
      args: [ctx.escrowId, bot.address],
    })) as bigint
    if (c > BigInt(0)) claimLines.push(`  @${bot.handle} ${bot.address} -> ${usdc(c)}`)
  }
  if (claimLines.length === 1) claimLines.push('  (none yet)')
  banner(claimLines)
}

async function operatorBalance(): Promise<bigint> {
  return publicClient.getBalance({ address: operatorAccount.address })
}

/** Net operator ETH consumed this run (signed txs + unrecovered bot gas). */
async function reportOperatorSpend(before: bigint): Promise<void> {
  const after = await operatorBalance()
  const spent = before - after
  const sign = spent < BigInt(0) ? '-' : ''
  const abs = spent < BigInt(0) ? -spent : spent
  log(`Operator ETH spent this run: ${sign}${formatEther(abs)} ETH (remaining ${formatEther(after)} ETH).`)
}

async function sweepRun(ctx: RunContext): Promise<void> {
  log('Sweeping leftover bot gas back to the operator...')
  let total = BigInt(0)
  for (const bot of ctx.bots) {
    total += await sweepBotGas(bot.pk)
  }
  log(`Swept ~${formatEther(total)} ETH back to the operator.`)
}

// ── Modes ────────────────────────────────────────────────────────────────--

async function runAuto(): Promise<void> {
  const pace = intArg('pace', 15)
  const opBefore = await operatorBalance()
  const ctx = await setupGame('auto')

  banner(['STARTING THE TOURNAMENT (lock on-chain + generate round 1)'])
  await ctx.svc.adminStartBracket(ctx.code)
  log('Locked + round 1 generated. Watch the pairings appear on the game page.')

  await playToCompletion(ctx.svc, ctx.code, { pace, intervene: false })
  await reportFinal(ctx)
  await sweepRun(ctx)
  await reportOperatorSpend(opBefore)

  banner([
    'AUTO RUN COMPLETE.',
    `Inspect the finished game: ${WATCH_BASE}/tournaments/paid/${ctx.code}`,
    'When done, tear it down with:',
    '  npx tsx scripts/tournament/demo-tournament.ts --cleanup',
  ])
}

async function runIntervene(): Promise<void> {
  const pace = intArg('pace', 15)
  const opBefore = await operatorBalance()
  const ctx = await setupGame('intervene')

  banner(['STARTING THE TOURNAMENT (lock on-chain + generate round 1)'])
  await ctx.svc.adminStartBracket(ctx.code)
  log('Locked + round 1 generated. A disputed match is coming up in round 1.')

  await playToCompletion(ctx.svc, ctx.code, { pace, intervene: true })
  await reportFinal(ctx)
  await sweepRun(ctx)
  await reportOperatorSpend(opBefore)

  banner([
    'INTERVENE RUN COMPLETE (play resumed after your resolution).',
    `Inspect the finished game: ${WATCH_BASE}/tournaments/paid/${ctx.code}`,
    'When done, tear it down with:',
    '  npx tsx scripts/tournament/demo-tournament.ts --cleanup',
  ])
}

async function runCleanup(): Promise<void> {
  const svc = await loadService()
  const sb = await loadSupabase()

  log('Cleanup: finding DEMO games (name prefix "DEMO ")...')
  const { data, error } = await sb
    .from('tournaments')
    .select('id, code, name, status, escrow_id')
    .ilike('name', 'DEMO %')
  if (error) throw new Error(`Could not list DEMO games: ${error.message}`)
  const games = (data ?? []) as {
    id: string
    code: string
    name: string
    status: string
    escrow_id: string | null
  }[]

  if (games.length === 0) {
    log('No DEMO games found. Nothing to clean up.')
  }

  const state = loadState()
  for (const g of games) {
    log(`Cleaning ${g.code} ("${g.name}", status=${g.status})...`)

    // Cancel on-chain if still cancellable so no funds are stranded. A settled
    // (Paid) game throws "already settled" - benign, we still delete the rows.
    if (g.escrow_id) {
      try {
        const { txHash } = await svc.adminCancelPaidGame(g.code)
        log(`  on-chain cancel${txHash ? ` (tx ${txHash})` : ' (no tx needed)'}.`)
      } catch (err) {
        log(`  on-chain cancel skipped: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Sweep any bot gas we still know about for this run.
    const run = state.runs.find((r) => r.code === g.code)
    if (run) {
      let swept = BigInt(0)
      for (const b of run.bots) swept += await sweepBotGas(b.pk as Hex)
      if (swept > BigInt(0)) log(`  swept ~${formatEther(swept)} ETH of bot gas back.`)
      // Best-effort: remove any reliability rows for these throwaway wallets.
      try {
        await sb
          .from('wallet_reliability')
          .delete()
          .in(
            'wallet_address',
            run.bots.map((b) => b.address.toLowerCase()),
          )
      } catch {
        /* table may be absent; ignore */
      }
    }

    // Delete the tournament row; players/rounds/matches/proposals/poll rows all
    // cascade (schema.sql: on delete cascade).
    const { error: delErr } = await sb.from('tournaments').delete().eq('id', g.id)
    if (delErr) {
      log(`  DELETE FAILED for ${g.code}: ${delErr.message}`)
      continue
    }
    log(`  deleted DB rows for ${g.code}.`)

    // Remove the throwaway wallet_profiles rows once the players that referenced
    // them are gone (players.wallet_address -> wallet_profiles).
    if (run) {
      try {
        await sb
          .from('wallet_profiles')
          .delete()
          .in(
            'wallet_address',
            run.bots.map((b) => b.address.toLowerCase()),
          )
      } catch {
        /* best-effort */
      }
    }
    forgetRun(g.code)
  }

  // Verify the lobby is clean.
  const { data: remaining } = await sb
    .from('tournaments')
    .select('code, name')
    .ilike('name', 'DEMO %')
  const left = (remaining ?? []) as { code: string; name: string }[]
  if (left.length === 0) {
    banner(['CLEANUP COMPLETE. No DEMO games remain.'])
  } else {
    banner(['CLEANUP INCOMPLETE. Still present:', ...left.map((r) => `  ${r.code} ${r.name}`)])
  }
}

// ── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  if (!RPC_URL || !OPERATOR_KEY || !process.env.TOURNAMENT_ESCROW_ADDRESS) {
    throw new Error('Missing TOURNAMENT_ESCROW_* env in .env.local.')
  }
  if (!process.env.TOURNAMENT_SUPABASE_URL || !process.env.TOURNAMENT_SUPABASE_SECRET_KEY) {
    throw new Error('Missing TOURNAMENT_SUPABASE_* env in .env.local.')
  }

  const mode = hasFlag('cleanup') ? 'cleanup' : argValue('mode')
  if (mode === 'auto') return runAuto()
  if (mode === 'intervene') return runIntervene()
  if (mode === 'cleanup') return runCleanup()

  console.log(
    [
      'Usage:',
      '  npx tsx scripts/tournament/demo-tournament.ts --mode=auto      [--players=4] [--entry=100000] [--pace=15]',
      '  npx tsx scripts/tournament/demo-tournament.ts --mode=intervene [--players=4] ...',
      '  npx tsx scripts/tournament/demo-tournament.ts --cleanup',
      '',
      'Optional: --rake=1500  --payout=wta|top3|top6|top8  --base=http://localhost:3000',
    ].join('\n'),
  )
  process.exit(1)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
