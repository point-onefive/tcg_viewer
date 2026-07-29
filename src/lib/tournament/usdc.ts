// Client-safe constants + minimal ABIs for the paid-tournament deposit flow.
// (No 'server-only' - this is imported by the deposit panel in the browser.)

import type { Hex } from 'viem'

/** Canonical native Circle USDC per supported chain (6 decimals). */
export const USDC_ADDRESS_BY_CHAIN: Record<number, Hex> = {
  8453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base mainnet
  84532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // Base Sepolia
}

export function usdcAddressForChain(chainId: number | null | undefined): Hex | null {
  if (chainId == null) return null
  return USDC_ADDRESS_BY_CHAIN[chainId] ?? null
}

/** Minimal ERC-20 surface we need for approve + allowance checks. */
export const ERC20_ABI = [
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
] as const

/** Minimal escrow surface for the client deposit tx. */
export const ESCROW_DEPOSIT_ABI = [
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
] as const
