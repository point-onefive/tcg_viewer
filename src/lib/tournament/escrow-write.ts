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
// addresses that actually funded the game, so a leaked key cannot drain funds
// to an outside wallet (see contracts/README.md and docs).
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
] as const

const OPERATOR_KEY = () => process.env.TOURNAMENT_ESCROW_OPERATOR_KEY as Hex | undefined
const RPC_URL = () => process.env.TOURNAMENT_ESCROW_RPC_URL

/** True when the escrow is configured AND we hold the operator key to sign. */
export function isOperatorConfigured(): boolean {
  const k = OPERATOR_KEY()
  return isEscrowConfigured() && typeof k === 'string' && /^0x[0-9a-fA-F]{64}$/.test(k)
}

function chain(): Chain {
  return escrowChainId() === base.id ? base : baseSepolia
}

function makeWallet() {
  const account = privateKeyToAccount(OPERATOR_KEY() as Hex)
  return createWalletClient({ account, chain: chain(), transport: http(RPC_URL()) })
}

function makePublic() {
  return createPublicClient({ chain: chain(), transport: http(RPC_URL()) })
}

let _wallet: ReturnType<typeof makeWallet> | null = null
let _public: ReturnType<typeof makePublic> | null = null

function wallet() {
  if (!isOperatorConfigured()) throw new EscrowNotConfiguredError()
  if (!_wallet) _wallet = makeWallet()
  return _wallet
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
async function send(
  functionName: 'createGame',
  args: readonly [Hex, bigint, number, number, readonly number[]],
): Promise<Hex>
async function send(functionName: string, args: readonly unknown[]): Promise<Hex> {
  const w = wallet()
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

/** Make a game refundable (operator). */
export async function cancelGameOnchain(escrowId: Hex): Promise<Hex | null> {
  if (!isOperatorConfigured()) return null
  return send('cancelGame', [escrowId])
}
