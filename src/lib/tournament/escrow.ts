import 'server-only'
import { createPublicClient, http, getAddress, parseEventLogs, type Hex } from 'viem'
import { base, baseSepolia } from 'viem/chains'

// ─────────────────────────────────────────────────────────────────────────
// Server-only on-chain reader for the paid-tournament escrow (Base USDC).
//
// The chain is the source of truth for money. This module NEVER signs or moves
// funds: the operator settle tx is signed by their own wallet in the browser,
// and refunds/claims are pulled by users. Here we only READ - to confirm a
// deposit and to reconcile the Supabase `funded`/`refunded` mirror against the
// contract (chain wins on any disagreement).
//
// Everything is gated on env so the feature degrades gracefully: if the escrow
// is not configured, `isEscrowConfigured()` is false and callers skip the
// on-chain path (paid tournaments simply can't be created/verified yet), while
// the rest of the tournament + site keeps working.
//
// Env:
//   TOURNAMENT_ESCROW_ADDRESS            escrow proxy address (0x...)
//   TOURNAMENT_ESCROW_CHAIN_ID           8453 (base) | 84532 (base sepolia)
//   TOURNAMENT_ESCROW_RPC_URL            Base RPC endpoint
//   TOURNAMENT_ESCROW_MIN_CONFIRMATIONS  blocks before a deposit counts (default 10)
// ─────────────────────────────────────────────────────────────────────────

export class EscrowNotConfiguredError extends Error {
  constructor() {
    super('Paid-tournament escrow is not configured (missing TOURNAMENT_ESCROW_* env).')
    this.name = 'EscrowNotConfiguredError'
  }
}

/** On-chain game lifecycle, mirroring the contract enum order exactly. */
export enum EscrowGameState {
  None = 0,
  Funding = 1,
  Locked = 2,
  Paid = 3,
  Cancelled = 4,
}

export interface OnchainGame {
  state: EscrowGameState
  entryFee: bigint
  cap: number
  fundedCount: number
  rakeBps: number
  pot: bigint
  lockedAt: number
  payoutBps: number[]
}

export interface FundingStatus {
  funded: boolean
  refunded: boolean
}

export interface DepositVerification {
  ok: boolean
  /** Confirmed deposit amount (6-decimal USDC units). */
  amount: bigint
  /** Block the deposit landed in (for the stored confirmations record). */
  blockNumber: bigint
  confirmations: bigint
  reason?: string
}

// Minimal ABI: only the reads + the Deposited event we need. The full ABI
// lives with the contract in contracts/out after `forge build`.
const ESCROW_ABI = [
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
    type: 'function',
    name: 'funded',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'function',
    name: 'refunded',
    stateMutability: 'view',
    inputs: [
      { name: 'id', type: 'bytes32' },
      { name: 'player', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    type: 'event',
    name: 'Deposited',
    inputs: [
      { name: 'id', type: 'bytes32', indexed: true },
      { name: 'player', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
] as const

const ADDRESS = () => process.env.TOURNAMENT_ESCROW_ADDRESS
const CHAIN_ID = () => Number(process.env.TOURNAMENT_ESCROW_CHAIN_ID)
const RPC_URL = () => process.env.TOURNAMENT_ESCROW_RPC_URL

/** ~10 Base confirmations before a deposit seats a player (reorg safety). */
export function minConfirmations(): bigint {
  const raw = Number(process.env.TOURNAMENT_ESCROW_MIN_CONFIRMATIONS)
  return BigInt(Number.isFinite(raw) && raw > 0 ? raw : 10)
}

/** True when the escrow has the env it needs to run. */
export function isEscrowConfigured(): boolean {
  return Boolean(ADDRESS() && RPC_URL() && (CHAIN_ID() === base.id || CHAIN_ID() === baseSepolia.id))
}

export function escrowChainId(): number {
  return CHAIN_ID()
}

export function escrowAddress(): Hex {
  const a = ADDRESS()
  if (!a) throw new EscrowNotConfiguredError()
  return getAddress(a)
}

function makeClient() {
  const chain = CHAIN_ID() === base.id ? base : baseSepolia
  return createPublicClient({ chain, transport: http(RPC_URL()) })
}

let _client: ReturnType<typeof makeClient> | null = null

function client() {
  if (_client) return _client
  if (!isEscrowConfigured()) throw new EscrowNotConfiguredError()
  _client = makeClient()
  return _client
}

/** Read a game's full on-chain state. */
export async function getOnchainGame(escrowId: Hex): Promise<OnchainGame> {
  const r = (await client().readContract({
    address: escrowAddress(),
    abi: ESCROW_ABI,
    functionName: 'getGame',
    args: [escrowId],
  })) as readonly [number, bigint, number, number, number, bigint, bigint, readonly number[]]
  return {
    state: r[0] as EscrowGameState,
    entryFee: r[1],
    cap: r[2],
    fundedCount: r[3],
    rakeBps: r[4],
    pot: r[5],
    lockedAt: Number(r[6]),
    payoutBps: [...r[7]],
  }
}

/** Per-player funded/refunded flags straight from the contract. */
export async function getFundingStatus(escrowId: Hex, wallet: Hex): Promise<FundingStatus> {
  const addr = getAddress(wallet)
  const [funded, refunded] = await Promise.all([
    client().readContract({
      address: escrowAddress(),
      abi: ESCROW_ABI,
      functionName: 'funded',
      args: [escrowId, addr],
    }),
    client().readContract({
      address: escrowAddress(),
      abi: ESCROW_ABI,
      functionName: 'refunded',
      args: [escrowId, addr],
    }),
  ])
  return { funded: Boolean(funded), refunded: Boolean(refunded) }
}

/**
 * Confirm a deposit transaction is real, final enough, and matches the game +
 * wallet + exact entry fee. Belt and suspenders: we verify the Deposited log
 * AND read the current `funded` state (so a reorg that removed the deposit
 * can't seat an unpaid player). Returns ok=false with a reason on any mismatch.
 */
export async function verifyDeposit(params: {
  escrowId: Hex
  wallet: Hex
  txHash: Hex
}): Promise<DepositVerification> {
  const { escrowId } = params
  const wallet = getAddress(params.wallet)
  const c = client()

  const zero: DepositVerification = {
    ok: false,
    amount: BigInt(0),
    blockNumber: BigInt(0),
    confirmations: BigInt(0),
  }

  let receipt
  try {
    receipt = await c.getTransactionReceipt({ hash: params.txHash })
  } catch {
    return { ...zero, reason: 'Transaction not found yet. Wait for it to confirm and retry.' }
  }
  if (receipt.status !== 'success') return { ...zero, reason: 'Deposit transaction reverted.' }
  if (getAddress(receipt.to ?? '0x') !== escrowAddress()) {
    return { ...zero, reason: 'Transaction was not sent to the escrow contract.' }
  }

  const logs = parseEventLogs({ abi: ESCROW_ABI, eventName: 'Deposited', logs: receipt.logs })
  const match = logs.find(
    (l) =>
      l.address.toLowerCase() === escrowAddress().toLowerCase() &&
      (l.args.id as string).toLowerCase() === escrowId.toLowerCase() &&
      getAddress(l.args.player as string) === wallet,
  )
  if (!match) {
    return { ...zero, reason: 'No matching deposit for this wallet and game in that transaction.' }
  }

  const latest = await c.getBlockNumber()
  const confirmations = latest - receipt.blockNumber + BigInt(1)
  const amount = match.args.amount as bigint

  if (confirmations < minConfirmations()) {
    return {
      ok: false,
      amount,
      blockNumber: receipt.blockNumber,
      confirmations,
      reason: `Waiting for confirmations (${confirmations}/${minConfirmations()}).`,
    }
  }

  // Final safety: the current on-chain funded flag must be true.
  const status = await getFundingStatus(escrowId, wallet)
  if (!status.funded || status.refunded) {
    return {
      ok: false,
      amount,
      blockNumber: receipt.blockNumber,
      confirmations,
      reason: 'On-chain funded state does not confirm this deposit (possible reorg).',
    }
  }

  return { ok: true, amount, blockNumber: receipt.blockNumber, confirmations }
}
