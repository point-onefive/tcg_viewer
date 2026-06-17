'use client'

// WaitlistCard - frictionless "notify me for the next event" sign-up.
//
// Shown on the tournaments page whenever the current event is NOT actively
// taking sign-ups (it is running, complete, or there is no event yet). A
// waitlist entry is just an X handle - no wallet, no password - so registering
// interest is one tap. The operator pulls the list when opening the next event.

import { useEffect, useState } from 'react'
import { BellRing, Check, Loader2 } from 'lucide-react'
import { apiJoinWaitlist, apiWaitlistStatus } from '@/lib/tournament/client'
import { XLogo } from '@/components/gallery/x-logo'

const WAITLIST_JOINED_KEY = 'tcw_waitlist_joined'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
}

export function WaitlistCard() {
  const [xHandle, setXHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [joined, setJoined] = useState(false)
  const [count, setCount] = useState<number | null>(null)
  // null = still probing; false = backend not ready (hide the card entirely).
  const [available, setAvailable] = useState<boolean | null>(null)

  useEffect(() => {
    try {
      if (localStorage.getItem(WAITLIST_JOINED_KEY)) setJoined(true)
    } catch {
      /* ignore unavailable storage */
    }
    let cancelled = false
    apiWaitlistStatus().then((s) => {
      if (cancelled) return
      setAvailable(s.available)
      setCount(s.count)
    })
    return () => {
      cancelled = true
    }
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!xHandle.trim()) return
    setBusy(true)
    setError(null)
    try {
      await apiJoinWaitlist(xHandle.trim())
      try {
        localStorage.setItem(WAITLIST_JOINED_KEY, xHandle.trim())
      } catch {
        /* ignore unavailable storage */
      }
      setJoined(true)
      setXHandle('')
      // Refresh the public count so the just-added entry is reflected.
      apiWaitlistStatus().then((s) => setCount(s.count))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not join the waitlist.')
    } finally {
      setBusy(false)
    }
  }

  // Hide the card until the backend is confirmed ready (migration applied),
  // so it never shows a form that would error.
  if (available !== true) return null

  const waiting = count ?? 0

  return (
    <div className="mb-6 overflow-hidden" style={card}>
      <div
        style={{
          height: 3,
          background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))',
        }}
      />
      <div className="p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <BellRing size={18} style={{ color: '#E85D2A' }} />
            <h3 className="font-display text-lg font-bold tracking-tight">Next event waitlist</h3>
          </div>
          {waiting > 0 && (
            <span
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold"
              style={{
                background: 'color-mix(in srgb, #E85D2A 12%, var(--bg))',
                border: '1px solid color-mix(in srgb, #E85D2A 22%, transparent)',
                borderRadius: 999,
                color: '#E85D2A',
              }}
            >
              {waiting} in line
            </span>
          )}
        </div>

        <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Sign-ups for the current event are closed. Drop your <XLogo /> handle and we&rsquo;ll
          line you up for the next one - no wallet, no password needed.
        </p>

        {joined ? (
          <div
            className="mt-4 flex items-center gap-2.5 rounded-md px-3.5 py-3"
            style={{
              background: 'color-mix(in srgb, #22c55e 10%, var(--bg))',
              border: '1px solid color-mix(in srgb, #22c55e 28%, transparent)',
            }}
          >
            <span
              className="inline-flex items-center justify-center shrink-0"
              style={{ width: 26, height: 26, borderRadius: '50%', background: '#22c55e', color: '#fff' }}
            >
              <Check size={15} />
            </span>
            <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              <span className="font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                You&rsquo;re on the list.
              </span>{' '}
              We&rsquo;ll tag you when the next tournament opens for sign-ups.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-start">
            <div className="flex flex-1 gap-2">
              <span
                className="flex items-center px-3 text-sm"
                style={{ ...inputStyle, width: 'auto', color: 'var(--text-muted)' }}
              >
                @
              </span>
              <input
                style={inputStyle}
                value={xHandle}
                onChange={(e) => setXHandle(e.target.value.replace(/^@/, ''))}
                placeholder="yourhandle"
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-label="Your X handle"
                required
              />
            </div>
            <button
              type="submit"
              disabled={busy}
              className="footer-btn py-2.5 px-5 text-sm font-bold shrink-0"
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
                'Join the waitlist'
              )}
            </button>
          </form>
        )}

        {error && (
          <p className="mt-2 text-sm" style={{ color: '#ef4444' }}>
            {error}
          </p>
        )}
      </div>
    </div>
  )
}
