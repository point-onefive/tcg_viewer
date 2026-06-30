'use client'

// Explicit 3-way region picker, reused at the waitlist, sign-up, and on the
// profile editor. Deliberately a manual pick (no browser auto-detect): the
// player tells us where they'll play from. Pre-filling from a saved profile
// region is the caller's job (pass it in as `value`).
//
// Labels are the compact acronyms (AMER / EMEA / APAC). The full name + a
// one-line description live in a tooltip: hover on desktop, long-press on
// mobile (a normal tap still selects). Native `title` is kept as a fallback.

import { useEffect, useRef, useState } from 'react'
import { Globe } from 'lucide-react'
import { REGIONS, type Region } from '@/lib/tournament/region'

const LONG_PRESS_MS = 350
const TIP_AUTO_HIDE_MS = 2200

export function RegionPicker({
  value,
  onChange,
  disabled = false,
  label = 'Region',
  hint,
  centered = false,
}: {
  value: Region | null
  onChange: (region: Region) => void
  disabled?: boolean
  label?: string
  hint?: string
  /** Center the label + hint (for centered layouts like the waitlist card). */
  centered?: boolean
}) {
  // Which button's tooltip is currently shown (hover or long-press).
  const [tip, setTip] = useState<Region | null>(null)
  // Long-press bookkeeping: a press that crosses the threshold reveals the
  // tooltip and suppresses the click that follows, so it never selects.
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const suppressClick = useRef(false)

  useEffect(
    () => () => {
      if (pressTimer.current) clearTimeout(pressTimer.current)
      if (hideTimer.current) clearTimeout(hideTimer.current)
    },
    [],
  )

  const clearPress = () => {
    if (pressTimer.current) {
      clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  const showTipFor = (id: Region, autoHide: boolean) => {
    setTip(id)
    if (hideTimer.current) clearTimeout(hideTimer.current)
    if (autoHide) hideTimer.current = setTimeout(() => setTip(null), TIP_AUTO_HIDE_MS)
  }

  return (
    <div>
      <div className={`flex items-center gap-1.5 mb-1.5 ${centered ? 'justify-center' : ''}`}>
        <Globe size={13} style={{ color: 'var(--text-muted)' }} />
        <span className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        {REGIONS.map((r) => {
          const active = value === r.id
          const showTip = tip === r.id
          return (
            <div key={r.id} style={{ position: 'relative' }}>
              {/* Tooltip: full name + description. */}
              <span
                role="tooltip"
                aria-hidden={!showTip}
                className="text-center"
                style={{
                  position: 'absolute',
                  bottom: 'calc(100% + 6px)',
                  left: '50%',
                  transform: 'translateX(-50%)',
                  zIndex: 20,
                  width: 'max-content',
                  maxWidth: 180,
                  padding: '6px 9px',
                  borderRadius: 8,
                  background: 'var(--bg-surface)',
                  border: '1px solid var(--border-subtle)',
                  boxShadow: 'var(--shadow-card)',
                  pointerEvents: 'none',
                  opacity: showTip ? 1 : 0,
                  transition: 'opacity 120ms ease',
                  lineHeight: 1.3,
                }}
              >
                <span className="block font-display font-bold text-xs" style={{ color: 'var(--text-primary)' }}>
                  {r.label}
                </span>
                <span className="block text-[10px]" style={{ color: 'var(--text-muted)' }}>
                  {r.blurb}
                </span>
              </span>

              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (suppressClick.current) {
                    suppressClick.current = false
                    return
                  }
                  onChange(r.id)
                }}
                onPointerEnter={(e) => {
                  if (e.pointerType === 'mouse') showTipFor(r.id, false)
                }}
                onPointerLeave={(e) => {
                  if (e.pointerType === 'mouse') setTip((cur) => (cur === r.id ? null : cur))
                }}
                onFocus={() => showTipFor(r.id, false)}
                onBlur={() => setTip((cur) => (cur === r.id ? null : cur))}
                onTouchStart={() => {
                  suppressClick.current = false
                  clearPress()
                  pressTimer.current = setTimeout(() => {
                    suppressClick.current = true
                    showTipFor(r.id, true)
                  }, LONG_PRESS_MS)
                }}
                onTouchEnd={clearPress}
                onTouchMove={clearPress}
                onContextMenu={(e) => e.preventDefault()}
                title={`${r.label} - ${r.blurb}`}
                aria-label={`${r.label} (${r.short})`}
                aria-pressed={active}
                className="flex items-center justify-center text-center w-full px-2 transition-colors"
                style={{
                  minHeight: 44,
                  borderRadius: 8,
                  cursor: disabled ? 'default' : 'pointer',
                  border: active ? '1px solid var(--tcw-accent)' : '1px solid var(--border-subtle)',
                  background: active
                    ? 'color-mix(in srgb, var(--tcw-accent) 14%, var(--bg))'
                    : 'var(--bg)',
                  opacity: disabled ? 0.6 : 1,
                  WebkitTouchCallout: 'none',
                  WebkitUserSelect: 'none',
                  userSelect: 'none',
                }}
              >
                <span
                  className="font-display font-bold text-sm tracking-wide leading-none"
                  style={{ color: active ? 'var(--tcw-accent)' : 'var(--text-primary)' }}
                >
                  {r.short}
                </span>
              </button>
            </div>
          )
        })}
      </div>
      {hint && (
        <p className={`text-[11px] mt-1.5 ${centered ? 'text-center' : ''}`} style={{ color: 'var(--text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  )
}
