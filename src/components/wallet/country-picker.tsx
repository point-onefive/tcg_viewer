'use client'

// Optional country picker for the profile editor. The player searches by text
// and we store / display the ISO 3166-1 alpha-2 code as an emoji flag. Purely
// cosmetic and always clearable (no country = no flag).
//
// Renders an inline combobox (search field + scrollable result list expands in
// flow) rather than an absolutely-positioned dropdown, so it can never be
// clipped by the edit-profile modal's own scroll container.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { COUNTRIES, countryFlag, countryName, searchCountries } from '@/lib/wallet/country'

export function CountryPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string | null
  onChange: (code: string | null) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  const results = useMemo(() => searchCountries(query).slice(0, 60), [query])
  const selectedName = countryName(value)

  const control: React.CSSProperties = {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    background: 'var(--bg)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
    padding: '9px 12px',
    fontSize: 14,
    cursor: disabled ? 'default' : 'pointer',
    color: value ? 'var(--text-primary)' : 'var(--text-muted)',
    opacity: disabled ? 0.6 : 1,
  }

  return (
    <div>
      {/* Selected value / toggle */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={control}
        >
          {value ? (
            <>
              <span style={{ fontSize: 18, lineHeight: 1 }} aria-hidden>
                {countryFlag(value)}
              </span>
              <span className="truncate" style={{ flex: 1, textAlign: 'left', fontWeight: 600 }}>
                {selectedName}
              </span>
            </>
          ) : (
            <>
              <Search size={15} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              <span style={{ flex: 1, textAlign: 'left' }}>Search for your country</span>
            </>
          )}
          <ChevronDown
            size={16}
            style={{
              color: 'var(--text-muted)',
              flexShrink: 0,
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 160ms ease',
            }}
          />
        </button>
        {value && !disabled && (
          <button
            type="button"
            onClick={() => {
              onChange(null)
              setQuery('')
            }}
            aria-label="Clear country"
            className="flex items-center justify-center transition-opacity hover:opacity-80"
            style={{
              flexShrink: 0,
              width: 34,
              height: 34,
              borderRadius: 6,
              background: 'var(--bg)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        )}
      </div>

      {/* Search + results (inline, in flow) */}
      {open && !disabled && (
        <div
          className="mt-2 overflow-hidden"
          style={{ border: '1px solid var(--border-subtle)', borderRadius: 8, background: 'var(--bg)' }}
        >
          <div style={{ position: 'relative', borderBottom: '1px solid var(--border-subtle)' }}>
            <Search
              size={15}
              style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Type a country name (${COUNTRIES.length} available)`}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              style={{
                width: '100%',
                background: 'transparent',
                color: 'var(--text-primary)',
                border: 'none',
                outline: 'none',
                padding: '9px 12px 9px 34px',
                fontSize: 14,
              }}
            />
          </div>
          <div style={{ maxHeight: 220, overflowY: 'auto' }}>
            {results.length === 0 ? (
              <div className="px-3 py-3 text-sm" style={{ color: 'var(--text-muted)' }}>
                No match. Try another spelling.
              </div>
            ) : (
              results.map((c) => {
                const active = c.code === value
                return (
                  <button
                    key={c.code}
                    type="button"
                    onClick={() => {
                      onChange(c.code)
                      setOpen(false)
                      setQuery('')
                    }}
                    className="flex w-full items-center gap-2.5 text-left transition-colors"
                    style={{
                      padding: '8px 12px',
                      background: active ? 'color-mix(in srgb, var(--tcw-accent) 12%, transparent)' : 'transparent',
                      border: 'none',
                      cursor: 'pointer',
                      color: 'var(--text-primary)',
                    }}
                    onMouseEnter={(e) => {
                      if (!active) e.currentTarget.style.background = 'var(--bg-surface)'
                    }}
                    onMouseLeave={(e) => {
                      if (!active) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span style={{ fontSize: 18, lineHeight: 1, width: 22, flexShrink: 0 }} aria-hidden>
                      {countryFlag(c.code)}
                    </span>
                    <span className="truncate" style={{ flex: 1, fontSize: 14 }}>
                      {c.name}
                    </span>
                    {active && <Check size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
