'use client'

import { useEffect, useRef, useState } from 'react'
import { TournamentShell } from '@/components/tournament/tournament-shell'

// Soft client-side password gate for the public tournament page. This is a
// light "members only" curtain for the pre-launch period - NOT real security
// (the password ships in the client bundle and the API stays public). It just
// keeps casual visitors out until the feature is ready.
//
// Unlock is remembered for the browser session (sessionStorage) so navigating
// around the tournament area doesn't re-prompt, but closing the tab re-locks.

const UNLOCK_KEY = 'tcw_tournament_gate'
const PASSWORD = process.env.NEXT_PUBLIC_TOURNAMENT_PASSWORD || 'cardwall'

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

export function TournamentGate({ children }: { children: React.ReactNode }) {
  const [unlocked, setUnlocked] = useState(false)
  const [checked, setChecked] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    try {
      if (sessionStorage.getItem(UNLOCK_KEY) === 'true') setUnlocked(true)
    } catch {
      /* ignore unavailable storage */
    }
    setChecked(true)
  }, [])

  useEffect(() => {
    if (checked && !unlocked) inputRef.current?.focus()
  }, [checked, unlocked])

  // Render nothing until we've read storage so an already-unlocked visitor
  // never flashes the password screen (and SSR/first paint stay in sync).
  if (!checked) return null
  if (unlocked) return <>{children}</>

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value === PASSWORD) {
      try {
        sessionStorage.setItem(UNLOCK_KEY, 'true')
      } catch {
        /* ignore unavailable storage */
      }
      setUnlocked(true)
      return
    }
    setError(true)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <TournamentShell>
      <div className="flex justify-center" style={{ paddingTop: 'clamp(24px, 10vh, 96px)' }}>
        <div className="w-full max-w-sm p-6 sm:p-7" style={card}>
          <img
            src="/shiny-cardboard-icon.png"
            alt="Shiny Cardboard"
            className="mx-auto mb-4 block"
            style={{
              width: 52,
              height: 52,
              borderRadius: 10,
              objectFit: 'cover',
              border: '1px solid var(--border-subtle)',
            }}
          />

          <h2 className="font-display text-xl font-bold text-center tracking-tight">
            Shiny Cardboard Members Only
          </h2>
          <p className="mt-2 text-center text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.55 }}>
            Head to{' '}
            <a
              href="https://x.com/point_onefive"
              target="_blank"
              rel="noopener noreferrer"
              className="font-semibold"
              style={{ color: '#E85D2A' }}
            >
              @point_onefive
            </a>{' '}
            and comment on any post asking to join the Shiny Cardboard general &amp; players chat to get the password.
          </p>

          <form onSubmit={submit} className="mt-5 flex flex-col gap-3">
            <input
              ref={inputRef}
              type="password"
              value={value}
              onChange={(e) => {
                setValue(e.target.value)
                if (error) setError(false)
              }}
              placeholder="Password"
              autoComplete="off"
              aria-label="Tournament password"
              aria-invalid={error}
              style={{
                ...inputStyle,
                borderColor: error ? '#ef4444' : 'var(--border-subtle)',
              }}
            />
            {error && (
              <p className="text-sm" style={{ color: '#ef4444' }} role="alert">
                Incorrect password - try again.
              </p>
            )}
            <button
              type="submit"
              disabled={!value.trim()}
              className="footer-btn py-2.5 text-sm font-bold transition-opacity"
              style={{
                background: 'var(--text-primary)',
                color: 'var(--bg)',
                borderRadius: 6,
                opacity: value.trim() ? 1 : 0.5,
                cursor: value.trim() ? 'pointer' : 'default',
              }}
            >
              Enter
            </button>
          </form>
        </div>
      </div>
    </TournamentShell>
  )
}
