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
  // Refund path: true when the on-chain game is refundable (Cancelled, globally
  // paused, or a locked-but-never-settled game past its dead-man window).
  const [refundable, setRefundable] = useState(false)
  const [withdrawn, setWithdrawn] = useState(false)

  const chainId = tournament.chainId
  const escrow = tournament.contractAddress
  const escrowId = tournament.escrowId
  const fee = tournament.entryFeeUsdc

  // Resolve the settlement token straight from the escrow's usdc() view so
  // testnet (mintable mock) and mainnet (canonical Circle USDC) both work
  // without a hardcoded map. Falls back to the known per-chain address.
  const [usdc, setUsdc] = useState<Hex | null>(() => usdcAddressForChain(chainId))
  useEffect(() => {
    let cancelled = false
    const fallback = usdcAddressForChain(chainId)
    if (!escrow || !chainId) {
      setUsdc(fallback)
      return
    }
    ;(async () => {
      try {
        const token = (await readContract(wagmiConfig, {
          address: escrow as Hex,
          abi: ESCROW_DEPOSIT_ABI,
          functionName: 'usdc',
          chainId: chainId as 8453 | 84532,
        })) as Hex
        if (!cancelled) setUsdc(token)
      } catch {
        if (!cancelled) setUsdc(fallback)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [escrow, chainId])

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

  // Detect a refundable game, but only when THIS wallet is funded and hasn't
  // already pulled its refund (keeps the extra RPC reads off everyone else).
  useEffect(() => {
    let cancelled = false
    const shouldCheck = onchainReady && Boolean(me?.funded) && !me?.refunded && !withdrawn
    if (!shouldCheck) {
      setRefundable(false)
      return
    }
    ;(async () => {
      try {
        const [game, paused, dead] = await Promise.all([
          readContract(wagmiConfig, {
            address: escrow as Hex,
            abi: ESCROW_DEPOSIT_ABI,
            functionName: 'getGame',
            args: [escrowId as Hex],
            chainId: chainId as 8453 | 84532,
          }),
          readContract(wagmiConfig, {
            address: escrow as Hex,
            abi: ESCROW_DEPOSIT_ABI,
            functionName: 'paused',
            chainId: chainId as 8453 | 84532,
          }),
          readContract(wagmiConfig, {
            address: escrow as Hex,
            abi: ESCROW_DEPOSIT_ABI,
            functionName: 'deadmanElapsed',
            args: [escrowId as Hex],
            chainId: chainId as 8453 | 84532,
          }),
        ])
        // getGame state == 4 is Cancelled (see EscrowGameState).
        const state = Number((game as readonly unknown[])[0])
        if (!cancelled) setRefundable(state === 4 || Boolean(paused) || Boolean(dead))
      } catch {
        if (!cancelled) setRefundable(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [onchainReady, me?.funded, me?.refunded, withdrawn, escrow, escrowId, chainId, tournament.status])

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

  const doWithdraw = useCallback(async () => {
    if (!onchainReady || !address) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await ensureChain()
      const hash = await writeContract(wagmiConfig, {
        address: escrow as Hex,
        abi: ESCROW_DEPOSIT_ABI,
        functionName: 'withdraw',
        args: [escrowId as Hex],
        chainId: chainId as 8453 | 84532,
      })
      await waitForTransactionReceipt(wagmiConfig, { hash, chainId: chainId as 8453 | 84532 })
      setWithdrawn(true)
      setRefundable(false)
      setNote('Refund withdrawn to your wallet.')
      // Let the sweep reconcile the funded/refunded mirror; refresh the view.
      onFunded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Withdraw failed.')
    } finally {
      setBusy(false)
    }
  }, [onchainReady, address, escrow, escrowId, chainId, ensureChain, onFunded])

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
  // The panel only appears when there's an actual step to take for THIS wallet:
  // pay your approved entry, or claim your winnings. Every non-actionable state
  // (not registered, awaiting approval, not connected, settled-with-nothing,
  // payments-not-wired) renders nothing - the sign-up form + the hero's field
  // tracker already communicate those, so this stays a pure call-to-action.
  let body: React.ReactNode = null
  if (!onchainReady) {
    body = null
  } else if (refundable && me?.funded && !me?.refunded && !withdrawn) {
    // Refundable game (cancelled / paused / dead-man elapsed) - offer the
    // player their entry back. Takes priority over "you're in" and claim.
    body = (
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p style={{ margin: 0 }}>
          This game is refundable. Withdraw your <strong>{feeLabel}</strong> entry back to your wallet.
        </p>
        <button style={btn} onClick={doWithdraw} disabled={busy}>
          {busy ? 'Processing…' : 'Withdraw refund'}
        </button>
      </div>
    )
  } else if (
    tournament.status === 'cancelled' &&
    me?.funded &&
    !me?.refunded &&
    !withdrawn
  ) {
    // Cancelled off-chain but the on-chain refundable read isn't true yet: the
    // cancel tx can lag the DB flip. Never leave a funded player staring at a
    // "Cancelled" label with no explanation - tell them the refund is being
    // enabled and to check back, rather than rendering nothing.
    body = (
      <p style={{ margin: 0, color: 'var(--text-secondary)' }}>
        Refund is being enabled on-chain. Check back shortly.
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
    }
  } else if (!isConnected) {
    body = null
  } else if (me?.funded) {
    body = <p style={{ margin: 0, color: '#22c55e' }}>Entry paid. You are in. ✓</p>
  } else if (!me || me.approvalStatus !== 'approved') {
    // Not registered, awaiting approval, or declined - nothing to pay yet.
    body = null
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

  // Nothing actionable for this wallet: render nothing at all.
  if (body === null && !note && !error) return null

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
