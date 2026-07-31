import 'server-only'
import {
  createWalletClient,
  createPublicClient,
  http,
  getAddress,
  type Hex,
  type Address,
  type Chain,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { isEscrowConfigured, escrowAddress, escrowChainId, EscrowNotConfiguredError } from './escrow'

// ─────────────────────────────────────────────────────────────────────────
// Server-only WRITE layer for the escrow: the backend "operator" signs the
// game lifecycle (createGame / lock / settle / cancel) so a started paid game
// runs itself end to end, including distributing winnings. This key is the
// least-privilege `operator` role on the contract - it can never upgrade,
// pause, change the platform, or rescue funds, and `settle` can only pay
// addresses that actually funded the game and never more than that game's pot,
// so a leaked key cannot drain to an arbitrary external address or exceed a
// single pot. It is NOT fully non-custodial, though: because deposits are
// permissionless and settle accepts ANY funded wallet as a winner, a
// compromised operator that itself deposits into a game could settle its own
// wallet as a winner and take a share of that game's pot. The pre-mainnet
// mitigation (an on-chain approval allowlist plus a winners-must-be-approved
// check) is tracked in docs/paid-tournaments-escrow.md (see contracts/README.md).
//
// Gated on env: if TOURNAMENT_ESCROW_OPERATOR_KEY (or the base escrow env) is
// missing, isOperatorConfigured() is false and every write is a no-op that
// returns null, so the whole feature degrades gracefully to "off-chain only".
//
// Env:
//   TOURNAMENT_ESCROW_OPERATOR_KEY   0x-prefixed private key of the operator
//                                    wallet (needs a little Base ETH for gas)
// ─────────────────────────────────────────────────────────────────────────

const WRITE_ABI = [
  {
    type: 'function',
    name: 'createGame',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'entryFee', type: 'uint256' },
      { name: 'cap', type: 'uint32' },
      { name: 'rakeBps', type: 'uint16' },
      { name: 'payoutBps_', type: 'uint16[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'lock',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'settle',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'orderedWinners', type: 'address[]' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'cancelGame',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refundPlayer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'pause',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'unpause',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

const OPERATOR_KEY = () => process.env.TOURNAMENT_ESCROW_OPERATOR_KEY as Hex | undefined
// OPTIONAL cold-ish owner key. The contract's pause()/unpause() are onlyOwner,
// so the operator key cannot drive a global halt. If (and only if) this env is
// set do we expose global pause/unpause; otherwise per-game cancelGame is the
// stop lever and the pause controls degrade to unavailable. Keep this key OUT
// of the hot path in production (a Safe/hardware signer is the eventual home).
const OWNER_KEY = () => process.env.TOURNAMENT_ESCROW_OWNER_KEY as Hex | undefined
const RPC_URL = () => process.env.TOURNAMENT_ESCROW_RPC_URL

/** True when the escrow is configured AND we hold the operator key to sign. */
export function isOperatorConfigured(): boolean {
  const k = OPERATOR_KEY()
  return isEscrowConfigured() && typeof k === 'string' && /^0x[0-9a-fA-F]{64}$/.test(k)
}

/** True when the OPTIONAL owner key is present, enabling global pause/unpause. */
export function isOwnerKeyConfigured(): boolean {
  const k = OWNER_KEY()
  return isEscrowConfigured() && typeof k === 'string' && /^0x[0-9a-fA-F]{64}$/.test(k)
}

function chain(): Chain {
  return escrowChainId() === base.id ? base : baseSepolia
}

function makeWallet(key: Hex) {
  const account = privateKeyToAccount(key)
  return createWalletClient({ account, chain: chain(), transport: http(RPC_URL()) })
}

function makePublic() {
  return createPublicClient({ chain: chain(), transport: http(RPC_URL()) })
}

let _wallet: ReturnType<typeof makeWallet> | null = null
let _ownerWallet: ReturnType<typeof makeWallet> | null = null
let _public: ReturnType<typeof makePublic> | null = null

function wallet() {
  if (!isOperatorConfigured()) throw new EscrowNotConfiguredError()
  if (!_wallet) _wallet = makeWallet(OPERATOR_KEY() as Hex)
  return _wallet
}

function ownerWallet() {
  if (!isOwnerKeyConfigured()) throw new EscrowNotConfiguredError()
  if (!_ownerWallet) _ownerWallet = makeWallet(OWNER_KEY() as Hex)
  return _ownerWallet
}

function pub() {
  if (!_public) _public = makePublic()
  return _public
}

/** Send one operator write and wait for it to confirm; returns the tx hash. */
async function send(functionName: 'lock' | 'cancelGame', args: readonly [Hex]): Promise<Hex>
async function send(
  functionName: 'settle',
  args: readonly [Hex, readonly Address[]],
): Promise<Hex>
async function send(functionName: 'refundPlayer', args: readonly [Hex, Address]): Promise<Hex>
async function send(
  functionName: 'createGame',
  args: readonly [Hex, bigint, number, number, readonly number[]],
): Promise<Hex>
async function send(functionName: string, args: readonly unknown[]): Promise<Hex> {
  return sendWith(wallet(), functionName, args)
}

/** Same as send() but signed by whichever wallet client is passed (operator or owner). */
async function sendWith(
  w: ReturnType<typeof makeWallet>,
  functionName: string,
  args: readonly unknown[],
): Promise<Hex> {
  const hash = await w.writeContract({
    address: escrowAddress(),
    abi: WRITE_ABI,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    functionName: functionName as any,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    args: args as any,
    account: w.account,
    chain: chain(),
  })
  await pub().waitForTransactionReceipt({ hash })
  return hash
}

/** Open a new game on-chain (operator). Returns tx hash, or null if not configured. */
export async function createGameOnchain(params: {
  escrowId: Hex
  entryFee: bigint
  cap: number
  rakeBps: number
  payoutBps: number[]
}): Promise<Hex | null> {
  if (!isOperatorConfigured()) return null
  return send('createGame', [
    params.escrowId,
    params.entryFee,
    params.cap,
    params.rakeBps,
    params.payoutBps,
  ])
}

/** Freeze roster + payout and start the dead-man clock (operator). */
export async function lockOnchain(escrowId: Hex): Promise<Hex | null> {
  if (!isOperatorConfigured()) return null
  return send('lock', [escrowId])
}

/** Submit final placement; the contract pays winners + rake (operator). */
export async function settleOnchain(
  escrowId: Hex,
  orderedWinners: Address[],
): Promise<Hex | null> {
  if (!isOperatorConfigured()) return null
  return send('settle', [escrowId, orderedWinners.map((w) => getAddress(w))])
}

/** Make a game refundable (operator). Callable while Funding OR Locked. */
export async function cancelGameOnchain(escrowId: Hex): Promise<Hex | null> {
  if (!isOperatorConfigured()) return null
  return send('cancelGame', [escrowId])
}

/**
 * Kick + refund a single funded player before the game locks (operator). The
 * contract credits the player's entry back (they pull it with withdraw) and
 * decrements the funded count. Reverts unless the game is still Funding.
 */
export async function refundPlayerOnchain(escrowId: Hex, player: Address): Promise<Hex | null> {
  if (!isOperatorConfigured()) return null
  return send('refundPlayer', [escrowId, getAddress(player)])
}

/**
 * Global halt (owner-only on the contract). No-op returning null unless the
 * OPTIONAL owner key is configured, so the feature degrades to "per-game
 * cancel only" when the backend holds just the operator key.
 */
export async function pauseOnchain(): Promise<Hex | null> {
  if (!isOwnerKeyConfigured()) return null
  return sendWith(ownerWallet(), 'pause', [])
}

/** Lift a global halt (owner-only). Null unless the owner key is configured. */
export async function unpauseOnchain(): Promise<Hex | null> {
  if (!isOwnerKeyConfigured()) return null
  return sendWith(ownerWallet(), 'unpause', [])
}

/** One signer wallet whose native (gas) balance is below the low-gas floor. */
export interface LowGasSigner {
  role: 'operator' | 'owner'
  address: string
  balanceWei: string
}

// Base gas is cheap, so a small floor is plenty of runway for many txs. Below
// this we warn the operator to top up so lock/settle/cancel don't start failing.
const LOW_GAS_FLOOR_WEI = BigInt('1000000000000000') // 0.001 ETH

/**
 * Best-effort low-gas check on the configured signer wallets (operator, and the
 * owner wallet when its key is set). Returns only the wallets under the floor.
 * Any read failure just omits that signer so the admin panel never breaks.
 */
export async function readLowGasSigners(): Promise<LowGasSigner[]> {
  const out: LowGasSigner[] = []
  const roles: { role: 'operator' | 'owner'; key: Hex | undefined; on: boolean }[] = [
    { role: 'operator', key: OPERATOR_KEY(), on: isOperatorConfigured() },
    { role: 'owner', key: OWNER_KEY(), on: isOwnerKeyConfigured() },
  ]
  for (const r of roles) {
    if (!r.on || !r.key) continue
    try {
      const address = privateKeyToAccount(r.key).address
      const balanceWei = await pub().getBalance({ address })
      if (balanceWei < LOW_GAS_FLOOR_WEI) {
        out.push({ role: r.role, address, balanceWei: balanceWei.toString() })
      }
    } catch {
      /* balance read failed for this signer; omit it, never break the panel */
    }
  }
  return out
}
