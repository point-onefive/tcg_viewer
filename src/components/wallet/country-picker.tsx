'use client'

// Optional country picker for the profile editor. The player searches by text
// and we store / display the ISO 3166-1 alpha-2 code as an emoji flag. Purely
// cosmetic and always clearable (no country = no flag).
//
// Single-field combobox: the field you click into is the field you type into.
// Focusing opens the list below; typing filters it; picking a row fills the
// field with the country (flag + name). One bar, no confusing second input.

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Search, X } from 'lucide-react'
import { countryFlag, countryName, searchCountries } from '@/lib/wallet/country'

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
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedName = countryName(value)
  // While open we bind the input to the live query; while closed it shows the
  // chosen country's name (so the field reads as its value, not a search box).
  const inputValue = open ? query : selectedName
  const showFlag = !open && !!value

  const results = useMemo(() => searchCountries(query), [query])

  // Close when focus/click leaves the whole control.
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  const select = (code: string) => {
    onChange(code)
    setQuery('')
    setOpen(false)
    inputRef.current?.blur()
  }

  const clear = () => {
    onChange(null)
    setQuery('')
    inputRef.current?.focus()
  }

  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'var(--bg)',
          border: `1px solid ${open ? 'var(--tcw-accent)' : 'var(--border-subtle)'}`,
          borderRadius: open ? '6px 6px 0 0' : 6,
          padding: '0 10px',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        <span style={{ flexShrink: 0, display: 'flex', alignItems: 'center', width: 18, justifyContent: 'center' }} aria-hidden>
          {showFlag ? (
            <span style={{ fontSize: 18, lineHeight: 1 }}>{countryFlag(value)}</span>
          ) : (
            <Search size={15} style={{ color: 'var(--text-muted)' }} />
          )}
        </span>
        <input
          ref={inputRef}
          type="text"
          disabled={disabled}
          value={inputValue}
          onFocus={() => {
            setOpen(true)
            setQuery('')
          }}
          onChange={(e) => {
            setOpen(true)
            setQuery(e.target.value)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setOpen(false)
              inputRef.current?.blur()
            }
          }}
          placeholder="Search for your country"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          style={{
            flex: 1,
            minWidth: 0,
            background: 'transparent',
            color: 'var(--text-primary)',
            border: 'none',
            outline: 'none',
            padding: '9px 0',
            fontSize: 14,
            fontWeight: value && !open ? 600 : 400,
          }}
        />
        {value && !disabled && (
          <button
            type="button"
            // Keep input focus so the list doesn't flicker closed on click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={clear}
            aria-label="Clear country"
            className="flex items-center justify-center transition-opacity hover:opacity-80"
            style={{ flexShrink: 0, background: 'none', border: 'none', padding: 4, color: 'var(--text-muted)', cursor: 'pointer' }}
          >
            <X size={15} />
          </button>
        )}
        <ChevronDown
          size={16}
          aria-hidden
          style={{
            flexShrink: 0,
            color: 'var(--text-muted)',
            transform: open ? 'rotate(180deg)' : undefined,
            transition: 'transform 160ms ease',
          }}
        />
      </div>

      {/* Results: in-flow directly under the field as one continuous control.
          In-flow (not absolute) so the modal's own scroll never clips it. */}
      {open && !disabled && (
        <div
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--tcw-accent)',
            borderTop: 'none',
            borderRadius: '0 0 6px 6px',
            maxHeight: 240,
            overflowY: 'auto',
          }}
        >
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
                  // preventDefault stops the input from blurring before onClick,
                  // which would otherwise close the list before selection lands.
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => select(c.code)}
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
      )}
    </div>
  )
}
