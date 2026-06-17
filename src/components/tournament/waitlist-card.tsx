'use client'

// WaitlistCard - wallet-backed "notify me for the next event" sign-up.
//
// Shown on the tournaments page whenever the current event is NOT actively
// taking sign-ups (it is running, complete, or there is no event yet).
//
// Joining is wallet-backed: a connected wallet whose profile carries an X
// handle taps once and is queued. When the operator opens the next tournament,
// every waiting wallet is auto-dropped into it as a pending sign-up (still
// admin-approved), so there is nothing to retype next time.
//
// The card self-gates on the backend `available` flag, so it stays hidden until
// migration 005 is applied - safe to ship ahead of the table existing.

import { useEffect, useState } from 'react'
import { BellRing, Check, Loader2 } from 'lucide-react'
import { apiJoinWaitlist, apiWaitlistStatus } from '@/lib/tournament/client'
import { XLogo } from '@/components/gallery/x-logo'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'
import { WalletConnectButton } from '@/components/wallet/wallet-connect-button'
import { PlayerProfileModal } from '@/components/wallet/player-profile-modal'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
}

function Shell({ count, children }: { count: number; children: React.ReactNode }) {
  return (
    <div className="mb-6 overflow-hidden" style={card}>
      <div
        style={{
          height: 3,
          background:
            'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))',
        }}
      />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing size={18} style={{ color: '#E85D2A' }} />
            <h3 className="font-display text-lg font-bold tracking-tight">
              Next event waitlist
            </h3>
          </div>
          {count > 0 && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold"
              style={{
                background: 'color-mix(in srgb, #E85D2A 12%, var(--bg))',
                border: '1px solid color-mix(in srgb, #E85D2A 22%, transparent)',
                borderRadius: 999,
                color: '#E85D2A',
              }}
            >
              {count} in line
            </span>
          )}
        </div>
        {children}
      </div>
    </div>
  )
}

export function WaitlistCard() {
  const { status, profile } = useWalletAuth()

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [count, setCount] = useState(0)
  // null = still probing; false = backend not ready (hide the card entirely).
  const [available, setAvailable] = useState<boolean | null>(null)
  const [editingProfile, setEditingProfile] = useState(false)

  // Probe status on mount and whenever the signed-in identity changes, so the
  // `joined` flag reflects the current wallet.
  useEffect(() => {
    let cancelled = false
    apiWaitlistStatus().then((s) => {
      if (cancelled) return
      setAvailable(s.available)
      setCount(s.count)
      setJoined(s.joined)
    })
    return () => {
      cancelled = true
    }
  }, [profile?.walletAddress, profile?.xHandle])

  async function join() {
    setBusy(true)
    setError(null)
    try {
      await apiJoinWaitlist()
      const s = await apiWaitlistStatus()
      setCount(s.count)
      setJoined(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the waitlist.')
    } finally {
      setBusy(false)
    }
  }

  // Hide the card until the backend is confirmed ready (migration applied).
  if (available !== true) return null

  const intro = (
    <p
      className="mt-2 text-sm text-center"
      style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
    >
      Sign-ups for the current event are closed. Join the waitlist and you&rsquo;ll
      be auto-entered (pending approval) the moment the next tournament opens.
    </p>
  )

  // Already queued for the next event.
  if (joined) {
    return (
      <Shell count={count}>
        {intro}
        <div
          className="mt-4 flex items-center gap-2.5 rounded-md px-3.5 py-3"
          style={{
            background: 'color-mix(in srgb, #22c55e 10%, var(--bg))',
            border: '1px solid color-mix(in srgb, #22c55e 28%, transparent)',
          }}
        >
          <span
            className="inline-flex items-center justify-center shrink-0"
            style={{
              width: 26,
              height: 26,
              borderRadius: '50%',
              background: '#22c55e',
              color: '#fff',
            }}
          >
            <Check size={15} />
          </span>
          <p
            className="text-sm"
            style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}
          >
            <span
              className="font-display font-bold"
              style={{ color: 'var(--text-primary)' }}
            >
              You&rsquo;re on the list
              {profile?.xHandle ? ` as @${profile.xHandle}` : ''}.
            </span>{' '}
            We&rsquo;ll drop you into the next tournament automatically.
          </p>
        </div>
      </Shell>
    )
  }

  // Still checking the session.
  if (status === 'loading') {
    return (
      <Shell count={count}>
        {intro}
        <div
          className="mt-4 flex items-center gap-2 text-sm"
          style={{ color: 'var(--text-muted)' }}
        >
          <Loader2 size={15} className="animate-spin" /> Checking your wallet…
        </div>
      </Shell>
    )
  }

  // Not signed in - prompt to connect.
  if (status !== 'signed-in' || !profile) {
    return (
      <Shell count={count}>
        {intro}
        <div className="mt-4 flex justify-center">
          <WalletConnectButton idleLabel="Connect Wallet to join" />
        </div>
      </Shell>
    )
  }

  // Signed in but no X handle on the profile - prompt to add one.
  if (!profile.xHandle) {
    return (
      <Shell count={count}>
        {intro}
        <p
          className="mt-3 text-sm"
          style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}
        >
          Add your <XLogo /> handle to your profile, then you can join with one tap.
        </p>
        <button
          onClick={() => setEditingProfile(true)}
          className="footer-btn mt-4 py-2.5 px-5 text-sm font-bold"
          style={{ background: '#E85D2A', color: '#fff', borderRadius: 6 }}
        >
          Add X handle
        </button>
        {editingProfile && (
          <PlayerProfileModal onClose={() => setEditingProfile(false)} />
        )}
      </Shell>
    )
  }

  // Signed in with a handle - one-tap join.
  return (
    <Shell count={count}>
      {intro}
      <div className="mt-4 flex justify-center">
        <button
          onClick={join}
          disabled={busy}
          className="footer-btn py-2.5 px-5 text-sm font-bold"
          style={{
            background: '#E85D2A',
            color: '#fff',
            borderRadius: 6,
            opacity: busy ? 0.6 : 1,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
          }}
        >
          {busy ? (
            <>
              <Loader2 size={14} className="animate-spin" /> Joining…
            </>
          ) : (
            `Join the waitlist as @${profile.xHandle}`
          )}
        </button>
      </div>
      {error && (
        <p className="mt-2 text-sm text-center" style={{ color: '#ef4444' }}>
          {error}
        </p>
      )}
    </Shell>
  )
}
