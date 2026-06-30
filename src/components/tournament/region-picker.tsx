'use client'

// Explicit 3-way region picker, reused at the waitlist, sign-up, and on the
// profile editor. Deliberately a manual pick (no browser auto-detect): the
// player tells us where they'll play from. Pre-filling from a saved profile
// region is the caller's job (pass it in as `value`).

import { Globe } from 'lucide-react'
import { REGIONS, type Region } from '@/lib/tournament/region'

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
          return (
            <button
              key={r.id}
              type="button"
              disabled={disabled}
              onClick={() => onChange(r.id)}
              title={r.blurb}
              aria-pressed={active}
              className="flex flex-col items-center justify-center text-center px-2 py-2 transition-colors"
              style={{
                borderRadius: 8,
                cursor: disabled ? 'default' : 'pointer',
                border: active
                  ? '1px solid var(--tcw-accent)'
                  : '1px solid var(--border-subtle)',
                background: active
                  ? 'color-mix(in srgb, var(--tcw-accent) 14%, var(--bg))'
                  : 'var(--bg)',
                opacity: disabled ? 0.6 : 1,
              }}
            >
              <span
                className="font-display font-bold text-sm leading-tight"
                style={{ color: active ? 'var(--tcw-accent)' : 'var(--text-primary)' }}
              >
                {r.label}
              </span>
              <span className="text-[10px] leading-tight mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {r.short}
              </span>
            </button>
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
