'use client'

// TournamentPasswordModal - a centered popup that gates ONLY the act of
// signing up for a tournament. The tournament page itself is public (anyone
// can view it and sign in with their wallet); this curtain just keeps casual
// visitors from entering the competitive bracket until they have the password.
//
// This is a light "members only" check, NOT real security (the password ships
// in the client bundle and the enroll API stays public). Unlock is remembered
// for the browser session so a player isn't re-prompted while navigating.

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { ModalPortal } from '@/components/ui/modal-portal'

const UNLOCK_KEY = 'tcw_tournament_gate'
const PASSWORD = process.env.NEXT_PUBLIC_TOURNAMENT_PASSWORD || 'cardwall'

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

/** True if this browser session has already unlocked tournament sign-up. */
export function isTournamentUnlocked(): boolean {
  try {
    return sessionStorage.getItem(UNLOCK_KEY) === 'true'
  } catch {
    return false
  }
}

/** Persist the unlocked state for the rest of the browser session. */
export function markTournamentUnlocked(): void {
  try {
    sessionStorage.setItem(UNLOCK_KEY, 'true')
  } catch {
    /* ignore unavailable storage */
  }
}

interface TournamentPasswordModalProps {
  onClose: () => void
  /** Called once the correct password is entered. */
  onUnlock: () => void
}

export function TournamentPasswordModal({ onClose, onUnlock }: TournamentPasswordModalProps) {
  const [value, setValue] = useState('')
  const [error, setError] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (value === PASSWORD) {
      markTournamentUnlocked()
      onUnlock()
      return
    }
    setError(true)
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <ModalPortal onClose={onClose} label="Tournament sign-up password" maxWidth={400}>
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 12px 0', flexShrink: 0 }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '50%',
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: '0 24px 24px', overflowY: 'auto' }}>
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
          Members-only sign-up
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
              background: '#E85D2A',
              color: '#fff',
              borderRadius: 6,
              opacity: value.trim() ? 1 : 0.5,
              cursor: value.trim() ? 'pointer' : 'default',
            }}
          >
            Unlock sign-up
          </button>
        </form>
      </div>
    </ModalPortal>
  )
}
