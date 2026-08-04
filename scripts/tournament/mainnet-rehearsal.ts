/* eslint-disable no-console */
/**
 * MAINNET-CAPABLE DRESS-REHEARSAL runner for the paid-tournament flow.
 *
 * This is a standalone sibling of demo-tournament.ts. Where the demo self-mints
 * MOCK USDC to freshly generated bots and floats gas from the app operator key,
 * this runner models the REAL mainnet money path:
 *
 *   1. Reads FIVE fresh role keys (deployer, owner, operator, approver,
 *      platform) from .mainnet-rehearsal-wallets.json (gitignored, chmod 600).
 *   2. DEPLOYS a fresh hardened TournamentEscrow UUPS proxy in isolation (never
 *      touches the app's live proxy), wiring owner / operator / approver /
 *      platform / usdc correctly, and verifies every role on-chain.
 *   3. FUNDS from a single funder: the deployer/funder wallet holds the USDC and
 *      ETH and distributes to each bot a small ETH gas float AND the exact USDC
 *      entry amount. The bots never mint. (On Sepolia the funder's USDC is
 *      seeded ONCE by minting the mock USDC to the deployer, then distributed
 *      exactly like real USDC would flow.)
 *   4. Points the app SERVICE layer at the fresh proxy for the run via in-process
 *      process.env overrides (operator key, approver key, escrow address, chain,
 *      rpc). It NEVER mutates the committed .env.local. The app-driven
 *      adminApprovePlayer path therefore signs winner approvals with the
 *      APPROVER wallet against the fresh proxy.
 *   5. Runs a full 4-player tournament end to end: create, enroll, admin-approve
 *      (on-chain winner-approve via the approver), bots deposit real (mock on
 *      Sepolia) USDC, lock, play, autopilot settle (succeeds because winners are
 *      approved), winners claimable.
 *   6. SWEEPS leftovers back: winners + platform claim, then all bot / role
 *      wallets return their USDC and leftover ETH to the recovery address
 *      (default: the deployer/funder). Reports the swept amounts.
 *   7. --cleanup tears down the rehearsal DB rows (games named "REHEARSAL ...")
 *      leaving the app's real data untouched.
 *
 * SAFETY: everything EXECUTED here defaults to Base Sepolia. Mainnet is a
 * later human-gated step (see --network=mainnet, which this runner supports but
 * this task never executes). It never prints a private key. It never repoints
 * the app: the committed .env.local keeps referencing the live proxy.
 *
 * Modes:
 *   npx tsx scripts/tournament/mainnet-rehearsal.ts --run [--network=sepolia] \
 *        [--players=4] [--entry=1000000] [--rake=1500] [--pace=2] \
 *        [--seed-from-operator=0.005] [--recovery=0x..] [--rpc=..] [--usdc=..]
 *   npx tsx scripts/tournament/mainnet-rehearsal.ts --cleanup
 *
 * NOTE ON MODULE CONDITIONS: the service layer imports `server-only`, which
 * throws unless Node runs with `--conditions=react-server`. So this file
 * RE-EXECS itself once with that flag, exactly like demo-tournament.ts.
 */

import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// ─────────────────────────────────────────────────────────────────────────
// Bootstrap: load .env.local (for Supabase creds + the app operator key used
// ONLY to seed the deployer on Sepolia), then re-exec under
// --conditions=react-server so importing the service layer does not throw.
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

if (!process.env.__REHEARSAL_REEXEC) {
  const res = spawnSync(
    'npx',
    ['tsx', '--conditions=react-server', fileURLToPath(import.meta.url), ...process.argv.slice(2)],
    { stdio: 'inherit', env: { ...process.env, __REHEARSAL_REEXEC: '1' }, cwd: REPO_ROOT },
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
  formatUnits,
  encodeFunctionData,
  getAddress,
  type Hex,
  type Address,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Account,
} from 'viem'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TournamentSnapshot, Player, Match } from '../../src/lib/tournament/types'
import type { PayoutPreset } from '../../src/lib/tournament/paid'

// ── Typed views of the service + supabase modules we import at runtime ──────

type ReportedResult = 'win' | 'loss' | 'draw'

interface RehearsalService {
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
  getSnapshotByCode(code: string): Promise<TournamentSnapshot>
  adminCancelPaidGame(code: string): Promise<{ txHash: string | null }>
}

interface SupaModule {
  getServiceClient(): SupabaseClient
}

// ── Role wallets (private keys read from the gitignored JSON) ────────────────

type RoleName = 'deployer' | 'owner' | 'operator' | 'approver' | 'platform'

interface RoleWallet {
  role: RoleName
  address: Address
  account: Account
  wallet: WalletClient
}

const WALLETS_FILE = path.join(REPO_ROOT, '.mainnet-rehearsal-wallets.json')

// ── Network config ──────────────────────────────────────────────────────────

interface NetCfg {
  label: string
  chain: Chain
  chainId: number
  rpc: string
  usdc: Address
  minConf: number
}

// Provided endpoints. Do NOT use mainnet in this task; it is here so the same
// runner can drive the real rehearsal later behind a human gate.
const BASE_SEPOLIA_RPC = 'https://base-sepolia.g.alchemy.com/v2/alch_L6a8Dvau1BHm73YOk9grD'
const BASE_MAINNET_RPC = 'https://base-mainnet.g.alchemy.com/v2/alch_L6a8Dvau1BHm73YOk9grD'
// Mintable MockUSDC used by the existing Sepolia deploy (funder is seeded from it).
const SEPOLIA_MOCK_USDC = getAddress('0x25176D598e038c5c0c4811C2D34570a13D32CA3a')
// Canonical native Circle USDC on Base mainnet (6 decimals).
const MAINNET_USDC = getAddress('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')

function netConfig(): NetCfg {
  const network = (argValue('network') ?? 'sepolia').toLowerCase()
  const rpcOverride = argValue('rpc')
  const usdcOverride = argValue('usdc')
  const minConfOverride = argValue('min-conf')
  if (network === 'mainnet' || network === 'base') {
    return {
      label: 'Base mainnet',
      chain: base,
      chainId: base.id,
      rpc: rpcOverride ?? BASE_MAINNET_RPC,
      usdc: usdcOverride ? getAddress(usdcOverride) : MAINNET_USDC,
      minConf: minConfOverride ? Number(minConfOverride) : 10,
    }
  }
  return {
    label: 'Base Sepolia',
    chain: baseSepolia,
    chainId: baseSepolia.id,
    rpc: rpcOverride ?? BASE_SEPOLIA_RPC,
    usdc: usdcOverride ? getAddress(usdcOverride) : SEPOLIA_MOCK_USDC,
    minConf: minConfOverride ? Number(minConfOverride) : 3,
  }
}

// ── Minimal ABIs ────────────────────────────────────────────────────────────

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
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
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
    name: 'decimals',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
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

// Only the reads + player-facing writes we need from the escrow. The signing
// side of the lifecycle (createGame/lock/settle/approve) runs through the app
// SERVICE layer, not this ABI.
const ESCROW_ABI = [
  { type: 'function', name: 'owner', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'operator', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'approver', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'platform', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { type: 'function', name: 'usdc', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  {
    type: 'function',
    name: 'initialize',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'owner_', type: 'address' },
      { name: 'usdc_', type: 'address' },
      { name: 'platform_', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setOperator',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'next', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'setApprover',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'next', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'transferOwnership',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'newOwner', type: 'address' }],
    outputs: [],
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
    name: 'claim',
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

// ── Small utilities ─────────────────────────────────────────────────────────

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

function usd(units: number | bigint): string {
  const n = typeof units === 'bigint' ? Number(units) : units
  const d = n / 1_000_000
  return `$${Number.isInteger(d) ? d.toFixed(0) : d.toFixed(2)}`
}

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

// ── CLI args ──────────────────────────────────────────────────────────────--

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

// ── Persistent state (throwaway bot keys, so --cleanup can sweep) ────────────

interface BotRecord {
  address: string
  pk: string
  handle: string
}
interface RunRecord {
  code: string
  network: string
  proxy: string
  createdAt: string
  bots: BotRecord[]
}
interface RunState {
  runs: RunRecord[]
}

const STATE_FILE = path.join(HERE, '.rehearsal-state.json')

function loadState(): RunState {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as RunState
    }
  } catch {
    /* corrupt or missing state resets to empty */
  }
  return { runs: [] }
}
function saveState(s: RunState): void {
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

async function loadService(): Promise<RehearsalService> {
  const mod = (await import(path.join(REPO_ROOT, 'src/lib/tournament/service.ts'))) as unknown
  return mod as RehearsalService
}
async function loadSupabase(): Promise<SupabaseClient> {
  const mod = (await import(path.join(REPO_ROOT, 'src/lib/tournament/supabase.ts'))) as unknown
  return (mod as SupaModule).getServiceClient()
}

// ── Role key loading ────────────────────────────────────────────────────────

function loadRoleWallets(cfg: NetCfg): Record<RoleName, RoleWallet> {
  if (!fs.existsSync(WALLETS_FILE)) {
    throw new Error(`Missing ${WALLETS_FILE}. Cannot read the rehearsal role keys.`)
  }
  const raw = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8')) as Record<
    string,
    { address: string; private_key: string }
  >
  const roles: RoleName[] = ['deployer', 'owner', 'operator', 'approver', 'platform']
  const out = {} as Record<RoleName, RoleWallet>
  for (const role of roles) {
    const entry = raw[role]
    if (!entry?.private_key || !/^0x[0-9a-fA-F]{64}$/.test(entry.private_key)) {
      throw new Error(`Role "${role}" is missing a valid private_key in the wallets file.`)
    }
    const account = privateKeyToAccount(entry.private_key as Hex)
    out[role] = {
      role,
      address: account.address,
      account,
      wallet: createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpc) }),
    }
  }
  return out
}

// ── Deployer nonce manager (avoids replica-lag nonce collisions in bursts) ───

class NonceManager {
  private next: number
  constructor(next: number) {
    this.next = next
  }
  static async create(client: PublicClient, address: Address): Promise<NonceManager> {
    const n = await client.getTransactionCount({ address, blockTag: 'pending' })
    return new NonceManager(n)
  }
  take(): number {
    return this.next++
  }
}

// ── Bots ────────────────────────────────────────────────────────────────────

interface Bot {
  handle: string
  pk: Hex
  address: Address
  account: Account
  wallet: WalletClient
}

function makeBots(n: number, cfg: NetCfg): Bot[] {
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
      account,
      wallet: createWalletClient({ account, chain: cfg.chain, transport: http(cfg.rpc) }),
    })
  }
  return bots
}

// ── Artifact loading (compiled by forge, checked into contracts/out) ─────────

function loadArtifactBytecode(relPath: string): Hex {
  const p = path.join(REPO_ROOT, 'contracts/out', relPath)
  const json = JSON.parse(fs.readFileSync(p, 'utf8')) as { bytecode?: { object?: string } }
  const obj = json.bytecode?.object
  if (!obj) throw new Error(`No bytecode.object in artifact ${relPath}`)
  return (obj.startsWith('0x') ? obj : `0x${obj}`) as Hex
}

// ─────────────────────────────────────────────────────────────────────────
// Runner context
// ─────────────────────────────────────────────────────────────────────────

interface Ctx {
  cfg: NetCfg
  roles: Record<RoleName, RoleWallet>
  publicClient: PublicClient
  proxy: Address
  impl: Address
  deployerNonce: NonceManager
  recovery: Address
}

// ── Balance / allowance polling (RPC replica-lag tolerant) ───────────────────

async function waitEthAtLeast(client: PublicClient, address: Address, min: bigint): Promise<void> {
  for (let i = 0; i < 40; i++) {
    if ((await client.getBalance({ address })) >= min) return
    await sleep(1500)
  }
}

/**
 * Poll until a freshly deployed contract's code is visible. Critical for
 * replica lag: a dependent tx (e.g. the proxy referencing a just-deployed impl,
 * or a role-wiring call to a just-deployed proxy) whose eth_estimateGas hits a
 * lagging replica that has not yet indexed the new code would otherwise revert.
 */
async function waitForCode(client: PublicClient, address: Address): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const code = await client.getBytecode({ address })
    if (code && code !== '0x') return
    await sleep(1500)
  }
  throw new Error(`Contract code never appeared at ${address} (replica lag or failed deploy).`)
}
async function waitErc20AtLeast(
  client: PublicClient,
  token: Address,
  address: Address,
  min: bigint,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const bal = (await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [address],
    })) as bigint
    if (bal >= min) return
    await sleep(1500)
  }
}
async function waitAllowanceAtLeast(
  client: PublicClient,
  token: Address,
  owner: Address,
  spender: Address,
  min: bigint,
): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const a = (await client.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    })) as bigint
    if (a >= min) return
    await sleep(1500)
  }
}

// ── Gas-float sizing ─────────────────────────────────────────────────────────

async function gasFloat(client: PublicClient, budgetGas: number, floorEth: string): Promise<bigint> {
  const gp = await client.getGasPrice()
  return bigMax(gp * BigInt(budgetGas), parseEther(floorEth))
}

// ─────────────────────────────────────────────────────────────────────────
// STEP: (Sepolia only) seed the deployer from the app operator key + mint USDC
// ─────────────────────────────────────────────────────────────────────────

async function seedDeployerFromOperator(ctx: Ctx, ethAmount: string, usdcUnits: bigint): Promise<void> {
  if (ctx.cfg.chainId === base.id) {
    throw new Error('--seed-from-operator is a testnet convenience and is refused on mainnet.')
  }
  const appOpKey = process.env.TOURNAMENT_ESCROW_OPERATOR_KEY as Hex | undefined
  if (!appOpKey || !/^0x[0-9a-fA-F]{64}$/.test(appOpKey)) {
    throw new Error('No app operator key in .env.local to seed the deployer from.')
  }
  const appOp = privateKeyToAccount(appOpKey)
  const appOpWallet = createWalletClient({ account: appOp, chain: ctx.cfg.chain, transport: http(ctx.cfg.rpc) })
  const deployer = ctx.roles.deployer.address
  const value = parseEther(ethAmount)

  log(`Seeding deployer ${deployer} with ${ethAmount} ETH from app operator ${appOp.address}...`)
  const ethHash = await appOpWallet.sendTransaction({
    account: appOp,
    chain: ctx.cfg.chain,
    to: deployer,
    value,
  })
  await ctx.publicClient.waitForTransactionReceipt({ hash: ethHash })
  await waitEthAtLeast(ctx.publicClient, deployer, value)
  log(`  ETH seed confirmed (tx ${ethHash}).`)

  // Mint the mock USDC to the deployer ONCE; from here it flows exactly like
  // real USDC would (deployer -> bots -> escrow -> claims -> back).
  log(`Minting ${usd(usdcUnits)} mock USDC to the deployer (one-time Sepolia seed)...`)
  const mintHash = await ctx.roles.deployer.wallet.writeContract({
    account: ctx.roles.deployer.account,
    chain: ctx.cfg.chain,
    address: ctx.cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'mint',
    args: [deployer, usdcUnits],
    nonce: ctx.deployerNonce.take(),
  })
  await ctx.publicClient.waitForTransactionReceipt({ hash: mintHash })
  await waitErc20AtLeast(ctx.publicClient, ctx.cfg.usdc, deployer, usdcUnits)
  log(`  USDC mint confirmed (tx ${mintHash}).`)
}

// ─────────────────────────────────────────────────────────────────────────
// STEP: deploy a fresh proxy + wire roles + verify
// ─────────────────────────────────────────────────────────────────────────

async function deployFreshProxy(ctx: Ctx): Promise<void> {
  const { roles, publicClient, cfg } = ctx
  const deployer = roles.deployer
  const escrowAbi = ESCROW_ABI

  // 1) Deploy the implementation (no constructor args; ctor disables initializers).
  log('Deploying TournamentEscrow implementation...')
  const implBytecode = loadArtifactBytecode('TournamentEscrow.sol/TournamentEscrow.json')
  const implHash = await deployer.wallet.deployContract({
    abi: escrowAbi,
    bytecode: implBytecode,
    account: deployer.account,
    chain: cfg.chain,
    nonce: ctx.deployerNonce.take(),
  })
  const implRcpt = await publicClient.waitForTransactionReceipt({ hash: implHash })
  const impl = getAddress(implRcpt.contractAddress as Address)
  // Wait for the impl code to be visible everywhere before the proxy references
  // it, so a lagging replica can't fail the proxy's InvalidImplementation check.
  await waitForCode(publicClient, impl)
  log(`  implementation: ${impl} (tx ${implHash})`)

  // 2) Deploy the ERC1967 proxy, initializing owner = DEPLOYER (so the deployer
  //    can wire operator + approver), usdc = target token, platform = platform.
  log('Deploying ERC1967 proxy (initialize owner=deployer, usdc, platform)...')
  const proxyBytecode = loadArtifactBytecode('ERC1967Proxy.sol/ERC1967Proxy.json')
  const proxyAbi = [
    {
      type: 'constructor',
      stateMutability: 'payable',
      inputs: [
        { name: 'implementation', type: 'address' },
        { name: '_data', type: 'bytes' },
      ],
    },
  ] as const
  const initData = encodeFunctionData({
    abi: escrowAbi,
    functionName: 'initialize',
    args: [deployer.address, cfg.usdc, roles.platform.address],
  })
  const proxyHash = await deployer.wallet.deployContract({
    abi: proxyAbi,
    bytecode: proxyBytecode,
    args: [impl, initData],
    account: deployer.account,
    chain: cfg.chain,
    nonce: ctx.deployerNonce.take(),
  })
  const proxyRcpt = await publicClient.waitForTransactionReceipt({ hash: proxyHash })
  const proxy = getAddress(proxyRcpt.contractAddress as Address)
  // Wait for the proxy code to be visible before role-wiring writes target it.
  await waitForCode(publicClient, proxy)
  log(`  proxy: ${proxy} (tx ${proxyHash})`)

  ctx.proxy = proxy
  ctx.impl = impl

  // 3) Wire the hot roles while the deployer is still owner, then hand ownership
  //    to the cold owner wallet. Each tx is awaited so nonces never collide.
  log('Wiring roles: setOperator(operator)...')
  const opHash = await deployer.wallet.writeContract({
    address: proxy,
    abi: escrowAbi,
    functionName: 'setOperator',
    args: [roles.operator.address],
    account: deployer.account,
    chain: cfg.chain,
    nonce: ctx.deployerNonce.take(),
  })
  await publicClient.waitForTransactionReceipt({ hash: opHash })

  log('Wiring roles: setApprover(approver)...')
  const apHash = await deployer.wallet.writeContract({
    address: proxy,
    abi: escrowAbi,
    functionName: 'setApprover',
    args: [roles.approver.address],
    account: deployer.account,
    chain: cfg.chain,
    nonce: ctx.deployerNonce.take(),
  })
  await publicClient.waitForTransactionReceipt({ hash: apHash })

  log(`Wiring roles: transferOwnership(owner=${roles.owner.address})...`)
  const toHash = await deployer.wallet.writeContract({
    address: proxy,
    abi: escrowAbi,
    functionName: 'transferOwnership',
    args: [roles.owner.address],
    account: deployer.account,
    chain: cfg.chain,
    nonce: ctx.deployerNonce.take(),
  })
  await publicClient.waitForTransactionReceipt({ hash: toHash })

  // 4) Verify every role on-chain, retrying for replica lag.
  await verifyRoles(ctx)
}

async function readAddr(ctx: Ctx, fn: 'owner' | 'operator' | 'approver' | 'platform' | 'usdc'): Promise<Address> {
  const a = (await ctx.publicClient.readContract({
    address: ctx.proxy,
    abi: ESCROW_ABI,
    functionName: fn,
  })) as Address
  return getAddress(a)
}

async function verifyRoles(ctx: Ctx): Promise<void> {
  const want: Record<string, Address> = {
    owner: ctx.roles.owner.address,
    operator: ctx.roles.operator.address,
    approver: ctx.roles.approver.address,
    platform: ctx.roles.platform.address,
    usdc: ctx.cfg.usdc,
  }
  const lines = ['ON-CHAIN ROLE VERIFICATION', `  proxy:    ${ctx.proxy}`, `  impl:     ${ctx.impl}`]
  for (const fn of ['owner', 'operator', 'approver', 'platform', 'usdc'] as const) {
    let got: Address | null = null
    for (let i = 0; i < 20; i++) {
      try {
        got = await readAddr(ctx, fn)
        if (got.toLowerCase() === want[fn].toLowerCase()) break
      } catch {
        /* replica lag on a freshly deployed proxy; retry */
      }
      await sleep(1500)
    }
    const ok = got && got.toLowerCase() === want[fn].toLowerCase()
    lines.push(`  ${fn.padEnd(8)} ${got ?? '(unread)'}  ${ok ? 'OK' : 'MISMATCH (want ' + want[fn] + ')'}`)
    if (!ok) {
      banner(lines)
      throw new Error(`Role verification failed for ${fn}: got ${got}, want ${want[fn]}`)
    }
  }
  banner(lines)
}

// ─────────────────────────────────────────────────────────────────────────
// STEP: point the SERVICE layer at the fresh proxy via process.env overrides
// ─────────────────────────────────────────────────────────────────────────

function applyEnvOverrides(ctx: Ctx): void {
  // The service reads these at call time (escrow.ts / escrow-write.ts), and the
  // viem clients they build are created lazily on first use. Setting them here,
  // BEFORE the first service call, points the whole app-driven path at the fresh
  // proxy without ever touching the committed .env.local on disk.
  process.env.TOURNAMENT_ESCROW_ADDRESS = ctx.proxy
  process.env.TOURNAMENT_ESCROW_CHAIN_ID = String(ctx.cfg.chainId)
  process.env.TOURNAMENT_ESCROW_RPC_URL = ctx.cfg.rpc
  process.env.TOURNAMENT_ESCROW_MIN_CONFIRMATIONS = String(ctx.cfg.minConf)
  // Read the role keys straight from the file so we never log them.
  const raw = JSON.parse(fs.readFileSync(WALLETS_FILE, 'utf8')) as Record<string, { private_key: string }>
  process.env.TOURNAMENT_ESCROW_OPERATOR_KEY = raw.operator.private_key
  process.env.TOURNAMENT_ESCROW_APPROVER_KEY = raw.approver.private_key
  // Owner key intentionally NOT set: the run needs only operator + approver.
  delete process.env.TOURNAMENT_ESCROW_OWNER_KEY
  log('Service layer pointed at the fresh proxy (operator=operator wallet, approver=approver wallet).')
}

// ─────────────────────────────────────────────────────────────────────────
// STEP: fund the role wallets (operator/approver/platform) with an ETH float
// ─────────────────────────────────────────────────────────────────────────

async function sendEthFromDeployer(ctx: Ctx, to: Address, value: bigint): Promise<void> {
  const hash = await ctx.roles.deployer.wallet.sendTransaction({
    account: ctx.roles.deployer.account,
    chain: ctx.cfg.chain,
    to,
    value,
    nonce: ctx.deployerNonce.take(),
  })
  await ctx.publicClient.waitForTransactionReceipt({ hash })
}

async function sendUsdcFromDeployer(ctx: Ctx, to: Address, amount: bigint): Promise<void> {
  const hash = await ctx.roles.deployer.wallet.writeContract({
    account: ctx.roles.deployer.account,
    chain: ctx.cfg.chain,
    address: ctx.cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'transfer',
    args: [to, amount],
    nonce: ctx.deployerNonce.take(),
  })
  await ctx.publicClient.waitForTransactionReceipt({ hash })
}

async function fundRoleGas(ctx: Ctx): Promise<void> {
  const c = ctx.publicClient
  const opFloat = await gasFloat(c, 1_200_000, '0.0009')
  const apFloat = await gasFloat(c, 800_000, '0.0007')
  const plFloat = await gasFloat(c, 300_000, '0.0004')
  log(
    `Floating role gas: operator ${formatEther(opFloat)} / approver ${formatEther(apFloat)} / platform ${formatEther(plFloat)} ETH...`,
  )
  await sendEthFromDeployer(ctx, ctx.roles.operator.address, opFloat)
  await waitEthAtLeast(c, ctx.roles.operator.address, opFloat)
  await sendEthFromDeployer(ctx, ctx.roles.approver.address, apFloat)
  await waitEthAtLeast(c, ctx.roles.approver.address, apFloat)
  await sendEthFromDeployer(ctx, ctx.roles.platform.address, plFloat)
  await waitEthAtLeast(c, ctx.roles.platform.address, plFloat)
  log('Role gas floated.')
}

// ─────────────────────────────────────────────────────────────────────────
// STEP: fund + deposit one bot (the funder distribution + on-chain deposit)
// ─────────────────────────────────────────────────────────────────────────

async function fundBotAndDeposit(
  ctx: Ctx,
  bot: Bot,
  escrowId: Hex,
  entry: bigint,
  botFloat: bigint,
): Promise<Hex> {
  const c = ctx.publicClient
  // Distribute exactly the ETH gas float + the exact USDC entry from the funder.
  await sendEthFromDeployer(ctx, bot.address, botFloat)
  await sendUsdcFromDeployer(ctx, bot.address, entry)
  await waitEthAtLeast(c, bot.address, botFloat)
  await waitErc20AtLeast(c, ctx.cfg.usdc, bot.address, entry)

  // Bot approves the escrow then deposits its own USDC (real deposit path).
  const cur = (await c.readContract({
    address: ctx.cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [bot.address, ctx.proxy],
  })) as bigint
  if (cur < entry) {
    const apHash = await bot.wallet.writeContract({
      account: bot.account,
      chain: ctx.cfg.chain,
      address: ctx.cfg.usdc,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [ctx.proxy, entry],
    })
    await c.waitForTransactionReceipt({ hash: apHash })
    await waitAllowanceAtLeast(c, ctx.cfg.usdc, bot.address, ctx.proxy, entry)
  }
  const depHash = await bot.wallet.writeContract({
    account: bot.account,
    chain: ctx.cfg.chain,
    address: ctx.proxy,
    abi: ESCROW_ABI,
    functionName: 'deposit',
    args: [escrowId],
  })
  await c.waitForTransactionReceipt({ hash: depHash })
  return depHash
}

async function confirmDepositWithRetry(
  svc: RehearsalService,
  code: string,
  address: Address,
  txHash: Hex,
): Promise<void> {
  let lastErr = ''
  for (let i = 0; i < 60; i++) {
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

// ─────────────────────────────────────────────────────────────────────────
// Result driving (mirrors the demo: lower seed wins, both sides agree)
// ─────────────────────────────────────────────────────────────────────────

function seedOf(snap: TournamentSnapshot, playerId: string): number {
  return snap.players.find((p) => p.id === playerId)?.seed ?? Number.MAX_SAFE_INTEGER
}
function playerById(snap: TournamentSnapshot, id: string): Player | undefined {
  return snap.players.find((p) => p.id === id)
}
function activeRound(snap: TournamentSnapshot) {
  return [...snap.rounds].filter((r) => r.status === 'active').sort((a, b) => a.number - b.number).pop()
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
async function reportDecisive(svc: RehearsalService, snap: TournamentSnapshot, m: Match): Promise<string> {
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

async function playToCompletion(svc: RehearsalService, code: string, pace: number): Promise<void> {
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
    const open = openMatches(snap, round.id)
    if (open.length === 0) {
      await sleep(2000)
      continue
    }
    for (const m of open) {
      const line = await reportDecisive(svc, snap, m)
      log(`R${round.number} M${m.number}: ${line}  [confirmed]`)
      await sleep(pace * 1000)
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Settlement + claim reporting
// ─────────────────────────────────────────────────────────────────────────

async function waitForSettlement(ctx: Ctx, escrowId: Hex): Promise<boolean> {
  for (let i = 0; i < 60; i++) {
    try {
      const g = (await ctx.publicClient.readContract({
        address: ctx.proxy,
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

async function findSettleTx(ctx: Ctx, escrowId: Hex): Promise<Hex | null> {
  const settledEvent = ESCROW_ABI.find((e) => e.type === 'event' && e.name === 'Settled')
  try {
    const latest = await ctx.publicClient.getBlockNumber()
    const window = BigInt(9)
    for (let i = 0; i < 40; i++) {
      const toBlock = latest - BigInt(i) * (window + BigInt(1))
      if (toBlock < BigInt(0)) break
      const fromBlock = toBlock - window > BigInt(0) ? toBlock - window : BigInt(0)
      try {
        const logs = await ctx.publicClient.getLogs({
          address: ctx.proxy,
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

// ─────────────────────────────────────────────────────────────────────────
// SWEEP: claim winnings + return all USDC and leftover ETH to the recovery addr
// ─────────────────────────────────────────────────────────────────────────

/**
 * Read an account's USDC balance, tolerating read-after-write RPC replica lag.
 *
 * A freshly confirmed claim/transfer receipt does NOT guarantee that the RPC
 * replica serving eth_call has indexed the state change yet (observed live on
 * Base mainnet via Alchemy replica lag: a just-confirmed claim read back as 0).
 * This polls balanceOf with a bounded backoff, returning as soon as the balance
 * meets `target` (or, when target is 0, as soon as it is simply > 0). If the
 * target is never met it returns the last balance observed with reached=false
 * so the caller can warn loudly instead of silently skipping a real payout.
 */
async function pollUsdcBalance(
  client: PublicClient,
  token: Address,
  address: Address,
  target: bigint,
  attempts = 15,
  delayMs = 2000,
): Promise<{ balance: bigint; reached: boolean }> {
  let balance = BigInt(0)
  const meets = (b: bigint) => (target > BigInt(0) ? b >= target : b > BigInt(0))
  for (let i = 0; i < attempts; i++) {
    try {
      balance = (await client.readContract({
        address: token,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint
      if (meets(balance)) return { balance, reached: true }
    } catch {
      /* transient replica error; retry */
    }
    if (i < attempts - 1) await sleep(delayMs)
  }
  return { balance, reached: false }
}

/**
 * Transfer `amount` USDC from `account` to the recovery address. Returns the
 * amount actually moved (0 if the account IS recovery, amount is 0, or the tx
 * failed). Centralizes the transfer so both the claim path and the final
 * residual sweep behave identically.
 */
async function transferUsdcToRecovery(
  ctx: Ctx,
  account: Account,
  wallet: WalletClient,
  amount: bigint,
): Promise<bigint> {
  if (amount <= BigInt(0)) return BigInt(0)
  if (account.address.toLowerCase() === ctx.recovery.toLowerCase()) return BigInt(0)
  try {
    const h = await wallet.writeContract({
      account,
      chain: ctx.cfg.chain,
      address: ctx.cfg.usdc,
      abi: ERC20_ABI,
      functionName: 'transfer',
      args: [ctx.recovery, amount],
    })
    await ctx.publicClient.waitForTransactionReceipt({ hash: h })
    return amount
  } catch (err) {
    log(`  usdc transfer failed for ${account.address}: ${err instanceof Error ? err.message : String(err)}`)
    return BigInt(0)
  }
}

async function claimAndTransferUsdc(
  ctx: Ctx,
  account: Account,
  wallet: WalletClient,
  escrowId: Hex,
): Promise<bigint> {
  const c = ctx.publicClient
  // Compute the expected claimable amount BEFORE claiming so the post-claim
  // poll has a concrete target. Combined with the pre-claim wallet balance this
  // gives an exact expected post-claim balance to wait for.
  const claimable = (await c.readContract({
    address: ctx.proxy,
    abi: ESCROW_ABI,
    functionName: 'claimable',
    args: [escrowId, account.address],
  })) as bigint
  const preBal = (await c.readContract({
    address: ctx.cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint

  if (claimable > BigInt(0)) {
    try {
      const h = await wallet.writeContract({
        account,
        chain: ctx.cfg.chain,
        address: ctx.proxy,
        abi: ESCROW_ABI,
        functionName: 'claim',
        args: [escrowId],
      })
      await c.waitForTransactionReceipt({ hash: h })
    } catch (err) {
      log(`  claim failed for ${account.address}: ${err instanceof Error ? err.message : String(err)}`)
    }

    // The claim receipt is confirmed, but a lagging RPC replica may still return
    // the OLD (pre-claim) balance. Poll until the just-claimed credit is visible
    // BEFORE transferring, so we never read a stale 0 and silently skip a real
    // payout (the exact failure seen live on Base mainnet).
    const target = preBal + claimable
    const { balance, reached } = await pollUsdcBalance(c, ctx.cfg.usdc, account.address, target)
    if (!reached) {
      log(
        `  WARNING: claimed ${usd(claimable)} for ${account.address} but wallet USDC balance ` +
          `read back as ${usd(balance)} (expected >= ${usd(target)}) after retries. ` +
          `Not skipping: transferring what is visible now; the final residual sweep will re-check.`,
      )
    }
  }

  // Re-read the current balance and move it all to recovery.
  const bal = (await c.readContract({
    address: ctx.cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  })) as bigint
  return transferUsdcToRecovery(ctx, account, wallet, bal)
}

async function sweepEth(ctx: Ctx, account: Account, wallet: WalletClient): Promise<bigint> {
  if (account.address.toLowerCase() === ctx.recovery.toLowerCase()) return BigInt(0)
  try {
    const c = ctx.publicClient
    const bal = await c.getBalance({ address: account.address })
    const gp = await c.getGasPrice()
    const cost = gp * BigInt(21_000)
    const buffer = cost * BigInt(3)
    if (bal <= buffer) return BigInt(0)
    const value = bal - buffer
    const h = await wallet.sendTransaction({
      account,
      chain: ctx.cfg.chain,
      to: ctx.recovery,
      value,
    })
    await c.waitForTransactionReceipt({ hash: h })
    return value
  } catch {
    return BigInt(0)
  }
}

async function sweepEverything(ctx: Ctx, bots: Bot[], escrowId: Hex): Promise<void> {
  banner(['SWEEP: claiming winnings + returning USDC/ETH to recovery', `  recovery: ${ctx.recovery}`])

  // 1) Winners (bots) claim + return USDC.
  let usdcBack = BigInt(0)
  for (const bot of bots) {
    usdcBack += await claimAndTransferUsdc(ctx, bot.account, bot.wallet, escrowId)
  }
  // 2) Platform claims the rake + returns USDC.
  const rakeBack = await claimAndTransferUsdc(ctx, ctx.roles.platform.account, ctx.roles.platform.wallet, escrowId)
  usdcBack += rakeBack

  // 3) Return leftover ETH from bots + hot role wallets (operator/approver/platform).
  let ethBack = BigInt(0)
  for (const bot of bots) ethBack += await sweepEth(ctx, bot.account, bot.wallet)
  ethBack += await sweepEth(ctx, ctx.roles.operator.account, ctx.roles.operator.wallet)
  ethBack += await sweepEth(ctx, ctx.roles.approver.account, ctx.roles.approver.wallet)
  ethBack += await sweepEth(ctx, ctx.roles.platform.account, ctx.roles.platform.wallet)

  // 4) FINAL residual-sweep safety pass. Even after the per-account claim +
  //    transfer above, an earlier step could have raced an RPC replica and left
  //    USDC behind (a just-confirmed claim reading back as 0 was the live
  //    mainnet failure). Re-read every bot + platform wallet ONE more time with
  //    the same lag-tolerant poll and recover any nonzero remainder. The ETH
  //    sweep intentionally leaves a gas buffer, so these transfers can still pay
  //    for gas.
  let residualBack = BigInt(0)
  const residualTargets: { account: Account; wallet: WalletClient; label: string }[] = [
    ...bots.map((b) => ({ account: b.account, wallet: b.wallet, label: `@${b.handle}` })),
    { account: ctx.roles.platform.account, wallet: ctx.roles.platform.wallet, label: 'platform' },
  ]
  for (const t of residualTargets) {
    if (t.account.address.toLowerCase() === ctx.recovery.toLowerCase()) continue
    const { balance } = await pollUsdcBalance(ctx.publicClient, ctx.cfg.usdc, t.account.address, BigInt(0), 6, 2000)
    if (balance > BigInt(0)) {
      log(
        `  RESIDUAL SWEEP: ${t.label} ${t.account.address} still holds ${usd(balance)} USDC after the ` +
          `main sweep; recovering it to ${ctx.recovery}.`,
      )
      residualBack += await transferUsdcToRecovery(ctx, t.account, t.wallet, balance)
    }
  }
  usdcBack += residualBack

  const sweepLines = [
    'SWEEP COMPLETE',
    `  USDC returned to recovery: ${usd(usdcBack)} (incl. platform rake ${usd(rakeBack)})`,
  ]
  if (residualBack > BigInt(0)) {
    sweepLines.push(`  WARNING: residual sweep recovered ${usd(residualBack)} USDC that an earlier step left behind.`)
  }
  sweepLines.push(
    `  ETH returned to recovery:  ${formatEther(ethBack)} ETH`,
    `  recovery balance now:      ${await recoveryBalances(ctx)}`,
  )
  banner(sweepLines)
}

async function recoveryBalances(ctx: Ctx): Promise<string> {
  const eth = await ctx.publicClient.getBalance({ address: ctx.recovery })
  const usdcBal = (await ctx.publicClient.readContract({
    address: ctx.cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [ctx.recovery],
  })) as bigint
  return `${formatEther(eth)} ETH + ${usd(usdcBal)} USDC`
}

// ─────────────────────────────────────────────────────────────────────────
// The full run
// ─────────────────────────────────────────────────────────────────────────

async function runRehearsal(): Promise<void> {
  const cfg = netConfig()
  const players = intArg('players', 4)
  const entryUnits = intArg('entry', 1_000_000) // default $1 entry (6-decimal USDC)
  const entry = BigInt(entryUnits)
  const rake = intArg('rake', 1500)
  const pace = intArg('pace', 2)
  const preset: PayoutPreset = (argValue('payout') as PayoutPreset | undefined) ?? (players === 4 ? 'top3' : 'wta')

  // Mainnet is a deliberate, human-gated step. The runner is fully mainnet
  // CAPABLE, but refuses to touch mainnet funds unless the operator explicitly
  // opts in with --confirm-mainnet, so an accidental --network=mainnet is inert.
  if (cfg.chainId === base.id && !hasFlag('confirm-mainnet')) {
    throw new Error(
      'Refusing to run on Base MAINNET without --confirm-mainnet. Base Sepolia is the default. ' +
        'For the real rehearsal, pre-fund the deployer and re-run with --network=mainnet --confirm-mainnet.',
    )
  }

  const roles = loadRoleWallets(cfg)
  const publicClient = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) }) as PublicClient
  const recovery = argValue('recovery') ? getAddress(argValue('recovery') as string) : roles.deployer.address
  const deployerNonce = await NonceManager.create(publicClient, roles.deployer.address)

  const ctx: Ctx = {
    cfg,
    roles,
    publicClient,
    proxy: '0x0000000000000000000000000000000000000000',
    impl: '0x0000000000000000000000000000000000000000',
    deployerNonce,
    recovery,
  }

  banner([
    `MAINNET-CAPABLE REHEARSAL  (executing on ${cfg.label})`,
    `players=${players}  entry=${usd(entry)}  rake=${rake}bps  payout=${preset}`,
    `deployer/funder: ${roles.deployer.address}`,
    `owner: ${roles.owner.address}`,
    `operator: ${roles.operator.address}`,
    `approver: ${roles.approver.address}`,
    `platform: ${roles.platform.address}`,
    `recovery (sweep target): ${recovery}`,
    `usdc: ${cfg.usdc}   minConfirmations=${cfg.minConf}`,
  ])

  // Optional Sepolia seeding: fund the deployer from the app operator key and
  // mint the entries. On mainnet the human pre-funds the deployer instead.
  const seed = argValue('seed-from-operator')
  if (seed) {
    const need = entry * BigInt(players)
    // Small buffer so a rounding/decimals surprise never starves distribution.
    await seedDeployerFromOperator(ctx, seed, need + entry)
  }

  // Preflight: the funder must actually hold the ETH + USDC it will distribute.
  const funderEth = await publicClient.getBalance({ address: roles.deployer.address })
  const funderUsdc = (await publicClient.readContract({
    address: cfg.usdc,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [roles.deployer.address],
  })) as bigint
  log(`Funder holdings: ${formatEther(funderEth)} ETH + ${usd(funderUsdc)} USDC.`)
  if (funderUsdc < entry * BigInt(players)) {
    throw new Error(
      `Funder USDC ${usd(funderUsdc)} < required ${usd(entry * BigInt(players))}. ` +
        `Fund ${roles.deployer.address} with USDC (or pass --seed-from-operator on Sepolia).`,
    )
  }

  // 1) Deploy the fresh proxy + wire + verify roles.
  await deployFreshProxy(ctx)

  // 2) Point the service at the fresh proxy (in-process only).
  applyEnvOverrides(ctx)

  // 3) Float ETH to the hot role wallets so operator/approver can sign.
  await fundRoleGas(ctx)

  // 4) Create the paid game via the service (operator signs createGame on-chain).
  const svc = await loadService()
  const sb = await loadSupabase()
  const name = `REHEARSAL ${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`
  log(`Creating paid game "${name}" (on-chain createGame via operator + DB row)...`)
  const { code } = await svc.adminCreatePaidGame({
    name,
    entryFeeUsdc: entryUnits,
    rakeBps: rake,
    payoutPreset: preset,
    maxPlayers: players,
    roundMinutes: 30,
    game: 'one-piece',
    lobbyRegion: null,
  })
  const snap0 = await svc.getSnapshotByCode(code)
  const escrowId = snap0.tournament.escrowId as Hex

  const bots = makeBots(players, cfg)
  recordRun({
    code,
    network: cfg.label,
    proxy: ctx.proxy,
    createdAt: new Date().toISOString(),
    bots: bots.map((b) => ({ address: b.address, pk: b.pk, handle: b.handle })),
  })

  banner([
    `GAME CREATED: ${code}`,
    `escrowId: ${escrowId}`,
    `WATCH:  ${WATCH_BASE}/tournaments/paid/${code}`,
    `LOBBY:  ${WATCH_BASE}/tournaments/paid`,
  ])

  const botFloat = await gasFloat(publicClient, 800_000, '0.0006')
  log(`Per-bot gas float: ${formatEther(botFloat)} ETH; per-bot entry: ${usd(entry)}.`)

  // 5) Enroll -> approve (approver signs on-chain) -> distribute -> deposit -> confirm.
  let funded = 0
  for (const bot of bots) {
    const { error: profErr } = await sb
      .from('wallet_profiles')
      .upsert(
        { wallet_address: bot.address.toLowerCase(), x_handle: bot.handle },
        { onConflict: 'wallet_address' },
      )
    if (profErr) throw new Error(`Could not seed wallet profile: ${profErr.message}`)

    log(`[@${bot.handle}] enrolling (${bot.address})...`)
    const { player } = await svc.enroll(code, bot.handle, DEMO_DECK_LIST, bot.address, 'amer')
    log(`[@${bot.handle}] admin-approving (mirrors on-chain winner-approve via APPROVER wallet)...`)
    await svc.adminApprovePlayer(code, player.id)

    log(`[@${bot.handle}] funder distributing ${formatEther(botFloat)} ETH + ${usd(entry)} USDC, then depositing...`)
    const depTx = await fundBotAndDeposit(ctx, bot, escrowId, entry, botFloat)

    log(`[@${bot.handle}] confirming deposit on-chain (>= ${cfg.minConf} confirmations)...`)
    await confirmDepositWithRetry(svc, code, bot.address, depTx)
    funded++
    log(`[@${bot.handle}] FUNDED. (${funded}/${players})`)
  }

  // 6) Lock + play + autopilot settle.
  banner(['STARTING THE TOURNAMENT (operator lock on-chain + generate round 1)'])
  await svc.adminStartBracket(code)
  log('Locked + round 1 generated.')
  await playToCompletion(svc, code, pace)

  // 7) Report standings + settlement.
  const snap = await svc.getSnapshotByCode(code)
  const settled = await waitForSettlement(ctx, escrowId)
  const settleTx = settled ? await findSettleTx(ctx, escrowId) : null

  const nameById = new Map(snap.players.map((p) => [p.id, p]))
  const standLines: string[] = ['FINAL STANDINGS']
  for (const s of snap.standings) {
    const p = nameById.get(s.playerId)
    standLines.push(`  #${s.rank}  @${p?.xHandle ?? '?'}  ${s.wins}-${s.losses}-${s.draws}  (${s.points} pts)`)
  }
  banner(standLines)

  log(settled ? 'On-chain state: Paid (autopilot settled via operator; winners were approver-approved).' : 'On-chain state: NOT settled.')
  if (settleTx) log(`Settle tx: ${settleTx}`)
  if (!settled) throw new Error('Game did not reach Paid state on-chain. Aborting before sweep for inspection.')

  const claimLines: string[] = ['CLAIMABLE PAYOUTS']
  for (const bot of bots) {
    const cAmt = (await publicClient.readContract({
      address: ctx.proxy,
      abi: ESCROW_ABI,
      functionName: 'claimable',
      args: [escrowId, bot.address],
    })) as bigint
    if (cAmt > BigInt(0)) claimLines.push(`  @${bot.handle} ${bot.address} -> ${usd(cAmt)}`)
  }
  const rakeClaim = (await publicClient.readContract({
    address: ctx.proxy,
    abi: ESCROW_ABI,
    functionName: 'claimable',
    args: [escrowId, roles.platform.address],
  })) as bigint
  claimLines.push(`  [platform rake] ${roles.platform.address} -> ${usd(rakeClaim)}`)
  banner(claimLines)

  // 8) Sweep everything back to the recovery address.
  await sweepEverything(ctx, bots, escrowId)

  banner([
    'REHEARSAL RUN COMPLETE.',
    `network: ${cfg.label}`,
    `proxy:   ${ctx.proxy}`,
    `game:    ${code}   settleTx: ${settleTx ?? '(none)'}`,
    `Inspect: ${WATCH_BASE}/tournaments/paid/${code}`,
    'Tear down the DB rows with:',
    '  npx tsx scripts/tournament/mainnet-rehearsal.ts --cleanup',
  ])
}

// ─────────────────────────────────────────────────────────────────────────
// Cleanup: delete rehearsal DB rows (games named "REHEARSAL ...") only
// ─────────────────────────────────────────────────────────────────────────

async function runCleanup(): Promise<void> {
  const sb = await loadSupabase()
  log('Cleanup: finding REHEARSAL games (name prefix "REHEARSAL ")...')
  const { data, error } = await sb
    .from('tournaments')
    .select('id, code, name, status, escrow_id')
    .ilike('name', 'REHEARSAL %')
  if (error) throw new Error(`Could not list REHEARSAL games: ${error.message}`)
  const games = (data ?? []) as { id: string; code: string; name: string; status: string; escrow_id: string | null }[]
  if (games.length === 0) log('No REHEARSAL games found. Nothing to clean up.')

  const state = loadState()
  for (const g of games) {
    log(`Cleaning ${g.code} ("${g.name}", status=${g.status})...`)
    const run = state.runs.find((r) => r.code === g.code)

    // Best-effort: remove reliability rows for the throwaway wallets.
    if (run) {
      try {
        await sb
          .from('wallet_reliability')
          .delete()
          .in('wallet_address', run.bots.map((b) => b.address.toLowerCase()))
      } catch {
        /* table may be absent; ignore */
      }
    }

    const { error: delErr } = await sb.from('tournaments').delete().eq('id', g.id)
    if (delErr) {
      log(`  DELETE FAILED for ${g.code}: ${delErr.message}`)
      continue
    }
    log(`  deleted DB rows for ${g.code} (players/rounds/matches cascade).`)

    if (run) {
      try {
        await sb
          .from('wallet_profiles')
          .delete()
          .in('wallet_address', run.bots.map((b) => b.address.toLowerCase()))
      } catch {
        /* best-effort */
      }
    }
    forgetRun(g.code)
  }

  const { data: remaining } = await sb
    .from('tournaments')
    .select('code, name')
    .ilike('name', 'REHEARSAL %')
  const left = (remaining ?? []) as { code: string; name: string }[]
  if (left.length === 0) banner(['CLEANUP COMPLETE. No REHEARSAL games remain.'])
  else banner(['CLEANUP INCOMPLETE. Still present:', ...left.map((r) => `  ${r.code} ${r.name}`)])
}

// ── Entry point ───────────────────────────────────────────────────────────--

async function main(): Promise<void> {
  if (!process.env.TOURNAMENT_SUPABASE_URL || !process.env.TOURNAMENT_SUPABASE_SECRET_KEY) {
    throw new Error('Missing TOURNAMENT_SUPABASE_* env in .env.local.')
  }
  if (hasFlag('cleanup')) return runCleanup()
  if (hasFlag('run')) return runRehearsal()

  console.log(
    [
      'MAINNET-CAPABLE dress-rehearsal runner (executes on Base Sepolia by default).',
      '',
      'Usage:',
      '  npx tsx scripts/tournament/mainnet-rehearsal.ts --run [--network=sepolia] \\',
      '       [--players=4] [--entry=1000000] [--rake=1500] [--pace=2] \\',
      '       [--seed-from-operator=0.005] [--recovery=0x..] [--rpc=..] [--usdc=..] [--min-conf=..]',
      '  npx tsx scripts/tournament/mainnet-rehearsal.ts --cleanup',
      '',
      'For the REAL run (human-gated): --network=mainnet --confirm-mainnet with the deployer',
      'pre-funded in ETH + canonical USDC (no --seed-from-operator on mainnet).',
    ].join('\n'),
  )
  process.exit(1)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
