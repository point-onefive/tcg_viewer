'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import {
  readContract,
  writeContract,
  waitForTransactionReceipt,
  switchChain,
} from '@wagmi/core'
import { getAddress, type Hex } from 'viem'
import { wagmiConfig } from '@/lib/wallet/config'
import type { TournamentSnapshot } from '@/lib/tournament/types'
import { formatUsdc } from '@/lib/tournament/paid'
import { apiVerifyDeposit } from '@/lib/tournament/client'
import { ERC20_ABI, ESCROW_DEPOSIT_ABI, usdcAddressForChain } from '@/lib/tournament/usdc'

/**
 * Entry-fee deposit + winnings-claim widget for paid games. Rendered by
 * TournamentLive only when the tournament is paid. Everything here is client
 * wallet action (deposit, claim); the backend runs the rest of the money
 * lifecycle on autopilot. Degrades to an informational note when on-chain
 * payments aren't wired yet (DB-only QC mode).
 */
export function PaidDepositPanel({
  snapshot,
  onFunded,
}: {
  snapshot: TournamentSnapshot
  onFunded: () => void
}) {
  const { tournament, players } = snapshot
  const { address, isConnected, chainId: connectedChainId } = useAccount()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pendingHash, setPendingHash] = useState<Hex | null>(null)
  const [claimable, setClaimable] = useState<bigint | null>(null)

  const chainId = tournament.chainId
  const escrow = tournament.contractAddress
  const escrowId = tournament.escrowId
  const fee = tournament.entryFeeUsdc
  const usdc = usdcAddressForChain(chainId)
  const onchainReady = Boolean(escrow && escrowId && chainId && usdc && fee)

  const me = useMemo(() => {
    if (!address) return null
    const a = address.toLowerCase()
    return players.find((p) => (p.walletAddress ?? '').toLowerCase() === a) ?? null
  }, [address, players])

  // Read the caller's claimable balance for a settled game.
  useEffect(() => {
    let cancelled = false
    if (!onchainReady || !address || tournament.status !== 'complete') {
      setClaimable(null)
      return
    }
    ;(async () => {
      try {
        const c = (await readContract(wagmiConfig, {
          address: escrow as Hex,
          abi: ESCROW_DEPOSIT_ABI,
          functionName: 'claimable',
          args: [escrowId as Hex, getAddress(address)],
          chainId: chainId as 8453 | 84532,
        })) as bigint
        if (!cancelled) setClaimable(c)
      } catch {
        if (!cancelled) setClaimable(null)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onchainReady, address, tournament.status, escrow, escrowId, chainId])

  const ensureChain = useCallback(async () => {
    if (connectedChainId !== chainId) {
      await switchChain(wagmiConfig, { chainId: chainId as 8453 | 84532 })
    }
  }, [connectedChainId, chainId])

  const doDeposit = useCallback(async () => {
    if (!onchainReady || !address) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await ensureChain()
      const owner = getAddress(address)
      const spender = getAddress(escrow as string)
      const amount = BigInt(fee as number)

      const allowance = (await readContract(wagmiConfig, {
        address: usdc as Hex,
        abi: ERC20_ABI,
        functionName: 'allowance',
        args: [owner, spender],
        chainId: chainId as 8453 | 84532,
      })) as bigint

      if (allowance < amount) {
        const approveHash = await writeContract(wagmiConfig, {
          address: usdc as Hex,
          abi: ERC20_ABI,
          functionName: 'approve',
          args: [spender, amount],
          chainId: chainId as 8453 | 84532,
        })
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash, chainId: chainId as 8453 | 84532 })
      }

      const depositHash = await writeContract(wagmiConfig, {
        address: escrow as Hex,
        abi: ESCROW_DEPOSIT_ABI,
        functionName: 'deposit',
        args: [escrowId as Hex],
        chainId: chainId as 8453 | 84532,
      })
      await waitForTransactionReceipt(wagmiConfig, { hash: depositHash, chainId: chainId as 8453 | 84532 })
      setPendingHash(depositHash)
      await verify(depositHash)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deposit failed.')
    } finally {
      setBusy(false)
    }
  }, [onchainReady, address, escrow, escrowId, fee, usdc, chainId, ensureChain])

  const verify = useCallback(
    async (hash: Hex) => {
      try {
        await apiVerifyDeposit(tournament.code, hash)
        setNote('Entry confirmed. You are in.')
        setPendingHash(null)
        onFunded()
      } catch (err) {
        // Most commonly "waiting for confirmations" - keep the hash so the
        // player can re-check without re-paying.
        setNote(err instanceof Error ? err.message : 'Waiting for confirmations.')
      }
    },
    [tournament.code, onFunded],
  )

  const doClaim = useCallback(async () => {
    if (!onchainReady || !address) return
    setBusy(true)
    setError(null)
    try {
      await ensureChain()
      const hash = await writeContract(wagmiConfig, {
        address: escrow as Hex,
        abi: ESCROW_DEPOSIT_ABI,
        functionName: 'claim',
        args: [escrowId as Hex],
        chainId: chainId as 8453 | 84532,
      })
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: chainId as 8453 | 84532 })
      setClaimable(BigInt(0))
      setNote('Winnings claimed to your wallet.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Claim failed.')
    } finally {
      setBusy(false)
    }
  }, [onchainReady, address, escrow, escrowId, chainId, ensureChain])

  if (!tournament.isPaid) return null

  const box: React.CSSProperties = {
    border: '1px solid rgba(255,255,255,0.14)',
    borderRadius: 14,
    background: 'rgba(0,0,0,0.28)',
    padding: 16,
    marginBottom: 24,
  }
  const btn: React.CSSProperties = {
    background: 'var(--bonk-ui-yellow, #f5c542)',
    color: '#111',
    fontWeight: 700,
    borderRadius: 10,
    padding: '10px 16px',
    border: 'none',
    cursor: 'pointer',
  }

  const feeLabel = formatUsdc(fee)

  // ── content by state ──
  let body: React.ReactNode
  if (!onchainReady) {
    body = (
      <p style={{ opacity: 0.8, margin: 0 }}>
        On-chain entry ({feeLabel}) isn&apos;t enabled for this game yet. The organizer will turn on
        payments before it starts.
      </p>
    )
  } else if (tournament.status === 'complete') {
    if (claimable && claimable > BigInt(0)) {
      body = (
        <div className="flex items-center justify-between gap-3">
          <p style={{ margin: 0 }}>
            You won <strong>{formatUsdc(Number(claimable))}</strong>. Claim it to your wallet.
          </p>
          <button style={btn} onClick={doClaim} disabled={busy}>
            {busy ? 'Claiming…' : 'Claim winnings'}
          </button>
        </div>
      )
    } else {
      body = <p style={{ opacity: 0.8, margin: 0 }}>This game is settled. No winnings to claim for this wallet.</p>
    }
  } else if (!isConnected) {
    body = <p style={{ opacity: 0.85, margin: 0 }}>Connect your wallet to pay the {feeLabel} entry.</p>
  } else if (me?.funded) {
    body = <p style={{ margin: 0, color: '#22c55e' }}>Entry paid. You are in. ✓</p>
  } else if (!me) {
    body = (
      <p style={{ opacity: 0.85, margin: 0 }}>
        Register above with this wallet first, then pay your {feeLabel} entry here.
      </p>
    )
  } else if (me.approvalStatus === 'rejected') {
    body = <p style={{ opacity: 0.85, margin: 0 }}>Your entry was declined, so no payment is needed.</p>
  } else if (me.approvalStatus !== 'approved') {
    body = (
      <p style={{ opacity: 0.85, margin: 0 }}>
        You&apos;re registered. Once the organizer approves you, pay your {feeLabel} entry here to lock
        your seat.
      </p>
    )
  } else {
    // approved + not funded
    body = (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p style={{ margin: 0 }}>
          You&apos;re approved. Pay the <strong>{feeLabel}</strong> entry (USDC) to lock your seat.
        </p>
        <div className="flex items-center gap-2">
          {pendingHash && (
            <button
              style={{ ...btn, background: 'transparent', color: 'inherit', border: '1px solid rgba(255,255,255,0.3)' }}
              onClick={() => verify(pendingHash)}
              disabled={busy}
            >
              Check status
            </button>
          )}
          <button style={btn} onClick={doDeposit} disabled={busy}>
            {busy ? 'Processing…' : `Pay ${feeLabel} entry`}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div style={box}>
      <div style={{ fontWeight: 800, marginBottom: 8, letterSpacing: 0.2 }}>Entry &amp; payout</div>
      {body}
      {note && <p style={{ marginTop: 10, marginBottom: 0, opacity: 0.85, fontSize: 13 }}>{note}</p>}
      {error && (
        <p style={{ marginTop: 10, marginBottom: 0, color: '#f87171', fontSize: 13 }}>{error}</p>
      )}
    </div>
  )
}
