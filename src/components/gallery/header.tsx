'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { BrandLockup } from './brand-lockup'
import { SiteNavMenu } from './site-nav-menu'
import { Bookmark, X, Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useStore, type Collection } from '@/lib/store'
import { CardSet, LanguagePickerValue } from '@/lib/types'
import { COLLECTIONS } from '@/lib/store'
import { COLLECTION_FACETS, facetLabel, type FacetOption } from '@/lib/collection-facets'
// Per-collection facet config lives in `@/lib/collection-facets`.
// Card type / Rarity / Color values vary by TCG; this header just
// reads `COLLECTION_FACETS[activeCollection]` and renders generic
// popovers + selects on top. Alt art / Flatten / Language are still
// One-Piece-only - those map to data that only the OP pipeline
// ingests (variant fans + per-language scans).

interface HeaderProps {
  sets: CardSet[]
  artists: string[]
  // Distinct character/leader names for the active collection (empty
  // unless the collection declares `characterTypes`). Feeds the
  // multi-select character picker.
  characters: string[]
  // Distinct archetype/clan tags (card.types) for the active collection
  // (empty unless the collection declares `typeTagLabel`). Feeds the
  // multi-select archetype picker (Azuki).
  typeTags: string[]
}

/**
 * Language picker labels, kept here so the row of pills + the active-
 * pill style logic share the same source of truth. `description` is
 * the title tooltip so hovering reveals the actual Bandai sources.
 *
 * Two options. CN was removed in v13 because Bandai's TC/TW CDNs
 * hot-link the JP file for the vast majority of cards, so the CN
 * picker shipped duplicate JP scans under a different URL. See
 * samples/jp-cn-compare/ for the side-by-side proof. SC-exclusive
 * prints remain in the bundle but are no longer surfaced via a
 * top-level pill.
 */
const LANGUAGE_OPTIONS: ReadonlyArray<{
  value: LanguagePickerValue
  label: string
  description: string
}> = [
  { value: 'EN', label: 'EN', description: 'English (Bandai EN + Asia-EN cardlists).' },
  { value: 'JP', label: 'JP', description: 'Japanese (Bandai Japan cardlist; richest promo coverage).' },
]

/** EN/JP pill group - fixed width + shrink-0 so flex siblings never
    crush JP off the edge of the pill (overflow:hidden was clipping it). */
function LanguageToggle({
  language,
  setLanguage,
  ctrl,
  fullWidth = false,
}: {
  language: LanguagePickerValue
  setLanguage: (v: LanguagePickerValue) => void
  ctrl: React.CSSProperties
  /** Full-width variant for menus (mobile More → Language section). */
  fullWidth?: boolean
}) {
  return (
    <div
      className={`inline-flex items-center shrink-0 ${fullWidth ? 'w-full' : ''}`}
      style={{
        ...ctrl,
        height: 30,
        padding: 2,
        minWidth: fullWidth ? undefined : 72,
        flexShrink: 0,
      }}
      role="radiogroup"
      aria-label="Language"
    >
      {LANGUAGE_OPTIONS.map((opt) => {
        const selected = language === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setLanguage(opt.value)}
            className="inline-flex flex-1 items-center justify-center text-[11px] font-semibold outline-none"
            style={{
              height: 24,
              borderRadius: 4,
              minWidth: 32,
              background: selected ? 'var(--text-primary)' : 'transparent',
              color: selected ? 'var(--bg)' : 'var(--text-primary)',
              transition: 'background 0.18s ease, color 0.18s ease',
            }}
            title={opt.description}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Dismissible chip shown in the active-filters strip inside the header.
 * Identical to the chip in card-grid, co-located here so the strip can
 * live in the fixed header without a cross-component import.
 */
function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        paddingLeft: 8,
        paddingRight: 4,
        paddingTop: 3,
        paddingBottom: 3,
        background: '#E85D2A',
        color: '#fff',
        borderRadius: 5,
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '0.02em',
        lineHeight: 1,
        flexShrink: 0,
      }}
    >
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          maxWidth: 180,
        }}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Remove filter: ${label}`}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.22)',
          color: '#fff',
          cursor: 'pointer',
          border: 'none',
          padding: 0,
          margin: 0,
          flexShrink: 0,
          lineHeight: 1,
        }}
      >
        <svg width="6" height="6" viewBox="0 0 6 6" fill="none" aria-hidden>
          <line x1="1" y1="1" x2="5" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
          <line x1="5" y1="1" x2="1" y2="5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
        </svg>
      </button>
    </span>
  )
}

function formatCardType(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
}

/**
 * Typeahead combobox for the artist filter. Renders a text input that
 * filters a dropdown of matching artist names as you type. Only shown
 * when the active collection carries artist data (artists.length > 0).
 */
function ArtistTypeahead({
  value,
  onChange,
  artists,
  ctrl,
  ctrlActive,
}: {
  value: string | null
  onChange: (v: string | null) => void
  artists: string[]
  ctrl: React.CSSProperties
  ctrlActive: React.CSSProperties
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Close on outside click or Escape
  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); setQuery('') }
    }
    const id = window.setTimeout(() => document.addEventListener('click', onClick), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = query.trim().length > 0
    ? artists.filter((a) => a.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 40)
    : []

  // When a value is selected, show it as the trigger label
  if (value) {
    return (
      <div
        className="shrink-0 inline-flex items-center gap-1 px-3 text-xs font-medium footer-btn"
        style={{ ...(ctrlActive), height: 30, gap: 6 }}
      >
        <span className="truncate" style={{ maxWidth: 140 }}>{value}</span>
        <button
          type="button"
          onClick={() => onChange(null)}
          aria-label="Clear artist filter"
          className="outline-none"
          style={{ color: 'inherit', opacity: 0.7, lineHeight: 1, flexShrink: 0 }}
        >
          ×
        </button>
      </div>
    )
  }

  return (
    <div ref={wrapperRef} className="relative shrink-0 overflow-visible">
      <input
        ref={inputRef}
        type="text"
        placeholder="Artist…"
        value={query}
        onChange={(e) => { setQuery(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        className="footer-btn px-3 text-xs font-medium outline-none"
        style={{
          ...ctrl,
          height: 30,
          width: 110,
          cursor: 'text',
          ...(open && filtered.length > 0
            ? {
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                position: 'relative',
                zIndex: 62,
              }
            : null),
        }}
        aria-label="Filter by artist"
        aria-autocomplete="list"
        aria-expanded={open && filtered.length > 0}
        autoComplete="off"
      />
      <AnimatePresence>
        {open && filtered.length > 0 && (
          <motion.div
            role="listbox"
            aria-label="Artist options"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 top-full"
            style={{
              transformOrigin: 'top left',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderTop: 'none',
              borderTopLeftRadius: 0,
              borderTopRightRadius: 0,
              borderBottomLeftRadius: 8,
              borderBottomRightRadius: 8,
              boxShadow: 'var(--shadow-card)',
              zIndex: 61,
              padding: 4,
              minWidth: 200,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: 280,
              overflowY: 'auto',
              overflowX: 'hidden',
            }}
          >
            {filtered.map((artist) => (
              <button
                key={artist}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => {
                  onChange(artist)
                  setQuery('')
                  setOpen(false)
                }}
                className="w-full flex items-center px-2.5 text-xs font-medium text-left transition-colors whitespace-nowrap"
                style={{
                  height: 30,
                  borderRadius: 5,
                  background: 'transparent',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 8%, transparent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = 'transparent'
                }}
              >
                {artist}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * Multi-select character picker. A search-driven checklist of card
 * names (One Piece roster: "Monkey.D.Luffy", combo prints like
 * "Ace & Sabo & Luffy", …). Selecting several applies an OR filter so
 * the wall shows every card belonging to any picked character - the
 * "pick a few at once instead of typing names one by one" ask.
 *
 * Shares HeaderDropdown's shell/physics with the other pickers. The
 * search input is pinned at the top; only the option list scrolls, so
 * a 700-name roster never blows past the viewport.
 */
function CharacterPicker({
  characters,
  selected,
  onToggle,
  onClear,
  ctrl,
  ctrlActive,
  fluid = false,
  menuAlign = 'left',
  title = 'Characters',
  noun = 'character',
}: {
  characters: string[]
  selected: string[]
  onToggle: (name: string) => void
  onClear: () => void
  ctrl: React.CSSProperties
  ctrlActive: React.CSSProperties
  fluid?: boolean
  menuAlign?: 'left' | 'right'
  // Trigger/aria copy so the same picker serves both the character
  // filter and the Azuki archetype filter. `title` is the 0-count
  // trigger label; `noun` is the lowercase singular used in count text
  // and placeholders (pluralized by appending "s").
  title?: string
  noun?: string
}) {
  const nouns = `${noun}s`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeLetter, setActiveLetter] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const count = selected.length
  const isActive = count > 0

  // Focus the search on open; clear query + letter when it closes.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setActiveLetter(null)
      return
    }
    const id = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => clearTimeout(id)
  }, [open])

  const selectedSet = useMemo(() => new Set(selected), [selected])

  // Bucket the roster by first letter so browse mode can paginate A–Z
  // instead of dumping the first 80 names and stopping mid-alphabet.
  const { letterIndex, letters } = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const name of characters) {
      const ch = name[0]?.toUpperCase() ?? ''
      const letter = /[A-Z]/.test(ch) ? ch : '#'
      const bucket = map.get(letter)
      if (bucket) bucket.push(name)
      else map.set(letter, [name])
    }
    const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').filter((l) => map.has(l))
    if (map.has('#')) alpha.push('#')
    return { letterIndex: map, letters: alpha }
  }, [characters])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const head = selected.filter((n) => !q || n.toLowerCase().includes(q))

    if (q) {
      // Search mode: show every match (typically a short list).
      const rest = characters.filter(
        (n) => n.toLowerCase().includes(q) && !selectedSet.has(n),
      )
      return [...head, ...rest]
    }

    if (activeLetter) {
      const bucket = letterIndex.get(activeLetter) ?? []
      const rest = bucket.filter((n) => !selectedSet.has(n))
      return [...head.filter((n) => {
        const ch = n[0]?.toUpperCase() ?? ''
        const letter = /[A-Z]/.test(ch) ? ch : '#'
        return letter === activeLetter
      }), ...rest]
    }

    // No search, no letter: only show current selections (if any).
    return head
  }, [characters, query, selected, selectedSet, activeLetter, letterIndex])

  const triggerLabel =
    count === 0
      ? title
      : count === 1
        ? selected[0]
        : `${count} ${nouns}`

  return (
    <HeaderDropdown
      ariaLabel={count > 0 ? `${title} (${count} selected)` : `Filter by ${noun}`}
      align={menuAlign}
      minWidth={240}
      open={open}
      onOpenChange={setOpen}
      flexShell
      wrapperClassName={fluid ? 'relative w-full min-w-0 overflow-visible' : 'relative shrink-0 overflow-visible'}
      triggerClassName={`footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium outline-none whitespace-nowrap${fluid ? ' w-full' : ''}`}
      triggerStyle={{ ...(isActive ? ctrlActive : ctrl) }}
      triggerChildren={
        <>
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              ...(fluid ? { flex: 1, textAlign: 'left' } : { maxWidth: 160 }),
            }}
          >
            {triggerLabel}
          </span>
          {count > 0 && (
            <span
              aria-hidden
              className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
              style={{
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 999,
                background: 'var(--text-primary)',
                color: fluid ? 'var(--bg)' : 'var(--text-primary)',
                flexShrink: 0,
              }}
            >
              {count}
            </span>
          )}
          <DropdownChevron open={open} />
        </>
      }
    >
      <div
        className="flex flex-col min-h-0"
        style={{ minWidth: 0, flex: 1, overflow: 'hidden', padding: '6px 6px 0' }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            if (e.target.value.trim()) setActiveLetter(null)
          }}
          placeholder={`Search ${nouns}…`}
          aria-label={`Search ${nouns}`}
          autoComplete="off"
          className="text-xs font-medium outline-none shrink-0"
          style={{
            height: 32,
            padding: '0 8px',
            marginBottom: 10,
            borderRadius: 5,
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg)',
            color: 'var(--text-primary)',
          }}
        />
        {count > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="w-full flex items-center justify-between px-2.5 text-[11px] font-semibold uppercase tracking-wide text-left shrink-0"
            style={{ height: 26, borderRadius: 5, color: 'var(--text-muted)', background: 'transparent', cursor: 'pointer' }}
          >
            <span>Clear ({count})</span>
          </button>
        )}
        {/* Letter strip - one horizontal row on mobile (fluid) so the
            A-Z grid doesn't eat half the viewport before the list. */}
        {!query.trim() && letters.length > 0 && (
          <div
            className={`no-scrollbar flex gap-1 px-1 pt-1 pb-3 shrink-0 ${fluid ? 'flex-nowrap overflow-x-auto' : 'flex-wrap'}`}
            role="tablist"
            aria-label={`Browse ${nouns} by letter`}
          >
            {letters.map((letter) => {
              const picked = activeLetter === letter
              return (
                <button
                  key={letter}
                  type="button"
                  role="tab"
                  aria-selected={picked}
                  onClick={() => setActiveLetter(picked ? null : letter)}
                  className="inline-flex items-center justify-center text-[10px] font-bold shrink-0"
                  style={{
                    minWidth: 22,
                    height: 22,
                    padding: '0 5px',
                    borderRadius: 4,
                    border: '1px solid var(--border-subtle)',
                    background: picked ? 'var(--text-primary)' : 'transparent',
                    color: picked ? 'var(--bg)' : 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {letter}
                </button>
              )
            })}
          </div>
        )}
        <div
          className="min-h-0 flex-1"
          style={{ overflowY: 'auto', overflowX: 'hidden', WebkitOverflowScrolling: 'touch' }}
        >
          {!query.trim() && !activeLetter && count === 0 && (
            <div className="px-2.5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Search or pick a letter to browse.
            </div>
          )}
          {!query.trim() && !activeLetter && count > 0 && visible.length === count && (
            <div className="px-2.5 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>
              Selected above · pick a letter or search for more.
            </div>
          )}
          {visible.length === 0 && (query.trim() || activeLetter) && (
            <div className="px-2.5 py-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              No {nouns} match.
            </div>
          )}
          {visible.map((name) => (
            <FacetOptionRow
              key={name}
              label={name}
              selected={selectedSet.has(name)}
              onClick={() => onToggle(name)}
            />
          ))}
        </div>
      </div>
    </HeaderDropdown>
  )
}

/**
 * Custom popover dropdown for a single-select filter facet. Replaces
 * the native <select> for the in-app Card type / Colour pickers so the
 * options list inherits site styling (dark surface, rounded corners,
 * brand typography) instead of falling back to the OS-default menu - * which on macOS Chrome paints an opaque white panel that ignores
 * dark mode and feels foreign next to the rest of the header.
 *
 * Shell + motion live in HeaderDropdown (same as the More menu).
 */
function FacetPopover({
  placeholder,
  clearLabel,
  ariaLabel,
  value,
  onChange,
  options,
  ctrl,
  ctrlActive,
  menuMinWidth = 160,
  menuMaxHeight,
  triggerMaxWidth,
  fluid = false,
  menuAlign = 'left',
}: {
  placeholder: string
  // Label for the menu's clear/reset row. Defaults to `placeholder` -
  // pass separately when the trigger uses a compact mobile label
  // ("Type") but the menu should still read "All types".
  clearLabel?: string
  ariaLabel: string
  value: string | null
  onChange: (next: string | null) => void
  options: ReadonlyArray<FacetOption>
  ctrl: React.CSSProperties
  ctrlActive: React.CSSProperties
  menuMinWidth?: number
  // Cap menu height + add inner scroll. Without this a 50-item set
  // list would render as a 1500px-tall panel that walks off the
  // bottom of the viewport (and at common scroll positions, off the
  // top of it too). With it the menu stays comfortably inside the
  // page and the user scrolls inside the popover, never inside the
  // OS overlay.
  menuMaxHeight?: number
  // Clamp the trigger width so a long label ("OP01 · Romance Dawn")
  // doesn't stretch the row and shove the rest of the filter strip
  // around. Selected text truncates with an ellipsis at this width.
  triggerMaxWidth?: number
  // Fluid mode: trigger stretches to fill its flex slot (mobile filter
  // rows divide the row between 3-4 popovers) instead of hugging its
  // label like the desktop pills do.
  fluid?: boolean
  // Anchor the menu to the trigger's right edge. Used for popovers near
  // the right viewport edge on mobile, where a left-anchored menu would
  // overflow off-screen.
  menuAlign?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const selectedOption = value ? options.find((o) => o.value === value) : null
  const triggerLabel = selectedOption?.label ?? placeholder
  const isActive = Boolean(value)
  const triggerStyle = isActive ? ctrlActive : ctrl

  return (
    <HeaderDropdown
      ariaLabel={ariaLabel}
      align={menuAlign}
      minWidth={menuMinWidth}
      maxHeight={menuMaxHeight}
      open={open}
      onOpenChange={setOpen}
      wrapperClassName={fluid ? 'relative flex-1 min-w-0 overflow-visible' : 'relative shrink-0 overflow-visible'}
      triggerClassName={`footer-btn inline-flex items-center text-xs font-medium outline-none whitespace-nowrap ${fluid ? 'w-full gap-1 px-2' : 'gap-1.5 px-3'}`}
      triggerStyle={{
        ...triggerStyle,
        ...(triggerMaxWidth ? { maxWidth: triggerMaxWidth } : null),
      }}
      triggerChildren={
        <>
          {selectedOption?.swatch && (
            <span
              aria-hidden
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: selectedOption.swatch,
                flexShrink: 0,
                boxShadow: '0 0 0 1px color-mix(in srgb, var(--text-primary) 18%, transparent)',
              }}
            />
          )}
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              minWidth: 0,
              ...(fluid ? { flex: 1, textAlign: 'left' } : null),
            }}
          >
            {triggerLabel}
          </span>
          <DropdownChevron open={open} />
        </>
      }
    >
      <FacetOptionRow
        label={clearLabel ?? placeholder}
        selected={value === null}
        onClick={() => {
          onChange(null)
          setOpen(false)
        }}
      />
      {options.map((opt) => (
        <FacetOptionRow
          key={opt.value}
          label={opt.label}
          swatch={opt.swatch}
          selected={value === opt.value}
          onClick={() => {
            onChange(opt.value)
            setOpen(false)
          }}
        />
      ))}
    </HeaderDropdown>
  )
}

/**
 * Single row inside a FacetPopover menu. Extracted so the trigger's
 * "clear" row and the option rows share identical sizing, hover, and
 * selected-state physics without duplication.
 */
function FacetOptionRow({
  label,
  swatch,
  selected,
  onClick,
}: {
  label: string
  swatch?: string
  selected: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 text-xs font-medium text-left transition-colors whitespace-nowrap"
      style={{
        height: 30,
        borderRadius: 5,
        background: selected ? 'var(--text-primary)' : 'transparent',
        color: selected ? 'var(--bg)' : 'var(--text-primary)',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.background =
            'color-mix(in srgb, var(--text-primary) 8%, transparent)'
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) e.currentTarget.style.background = 'transparent'
      }}
    >
      <Check
        size={12}
        strokeWidth={2.5}
        style={{ opacity: selected ? 1 : 0, flexShrink: 0 }}
      />
      {swatch && (
        <span
          aria-hidden
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            background: swatch,
            flexShrink: 0,
            boxShadow: selected
              ? '0 0 0 1px color-mix(in srgb, var(--bg) 35%, transparent)'
              : '0 0 0 1px color-mix(in srgb, var(--text-primary) 18%, transparent)',
          }}
        />
      )}
      <span className="flex-1">{label}</span>
    </button>
  )
}

/** Chevron shared by every header dropdown trigger. */
function DropdownChevron({ open }: { open: boolean }) {
  return (
    <ChevronDown
      size={12}
      strokeWidth={2.25}
      style={{
        transition: 'transform 180ms ease',
        transform: open ? 'rotate(180deg)' : 'rotate(0)',
        color: 'var(--text-muted)',
        flexShrink: 0,
      }}
    />
  )
}

/** Shared open/close physics + panel chrome - matches the More menu. */
const HEADER_DROPDOWN_EASE = [0.22, 1, 0.36, 1] as const

const headerDropdownPanelStyle = (
  align: 'left' | 'right',
  maxHeight: number | undefined,
  /** When true the panel is a flex column shell; inner regions scroll
   *  themselves (used by CharacterPicker so search + letters stay
   *  pinned while only the name list scrolls). */
  flexShell = false,
): React.CSSProperties => ({
  transformOrigin: align === 'right' ? 'top right' : 'top left',
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderTop: 'none',
  borderTopLeftRadius: 0,
  borderTopRightRadius: 0,
  borderBottomLeftRadius: 8,
  borderBottomRightRadius: 8,
  boxShadow: 'var(--shadow-card)',
  padding: 4,
  ...(flexShell
    ? {
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...(maxHeight ? { maxHeight } : null),
      }
    : maxHeight
      ? { maxHeight, overflowY: 'auto', overflowX: 'hidden' }
      : { overflow: 'hidden' }),
})

type PanelPos = { top: number; left: number; width: number; maxHeight: number }

/**
 * Header dropdown shell. The panel is rendered through a portal to
 * `document.body` with `position: fixed`, positioned from the trigger's
 * viewport rect and hard-clamped to the viewport. This is the only
 * reliable way to keep it on-screen: the triggers live inside
 * `overflow-x-auto` filter bars, and an absolutely-positioned descendant
 * of an overflow ancestor gets clipped/scrolled by it. Fixed + portal
 * escapes every clipping context, so the menu always fits on mobile.
 */
function HeaderDropdown({
  ariaLabel,
  ariaHaspopup = 'listbox',
  align = 'left',
  minWidth = 180,
  maxHeight,
  wrapperClassName = 'relative shrink-0 overflow-visible',
  triggerClassName = 'footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium outline-none whitespace-nowrap',
  triggerStyle,
  open,
  onOpenChange,
  triggerChildren,
  children,
  flexShell = false,
}: {
  ariaLabel: string
  ariaHaspopup?: 'listbox' | 'menu'
  align?: 'left' | 'right'
  minWidth?: number
  maxHeight?: number
  wrapperClassName?: string
  triggerClassName?: string
  triggerStyle: React.CSSProperties
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerChildren: React.ReactNode
  children: React.ReactNode
  /** Flex-column shell; children manage their own scroll regions. */
  flexShell?: boolean
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<PanelPos | null>(null)

  // Measure the trigger and place the fixed panel within the viewport.
  // Recomputed on open and on any scroll/resize while open.
  useLayoutEffect(() => {
    if (!open) {
      setPos(null)
      return
    }
    const compute = () => {
      const trigger = wrapperRef.current?.querySelector('button')
      if (!trigger) return
      const r = trigger.getBoundingClientRect()
      const vw = window.visualViewport?.width ?? window.innerWidth
      const vh = window.visualViewport?.height ?? window.innerHeight
      const GUTTER = 8
      const maxAllowedW = Math.max(160, vw - GUTTER * 2)
      const width = Math.min(maxAllowedW, Math.max(minWidth, r.width))
      let left = align === 'right' ? r.right - width : r.left
      left = Math.min(left, vw - GUTTER - width)
      left = Math.max(GUTTER, left)
      const top = r.bottom
      const cap = Math.max(140, Math.floor(vh - top - GUTTER))
      const resolvedMaxHeight = maxHeight != null ? Math.min(maxHeight, cap) : cap
      setPos({ top, left, width, maxHeight: resolvedMaxHeight })
    }
    compute()
    window.addEventListener('scroll', compute, true)
    window.addEventListener('resize', compute)
    window.visualViewport?.addEventListener('resize', compute)
    window.visualViewport?.addEventListener('scroll', compute)
    return () => {
      window.removeEventListener('scroll', compute, true)
      window.removeEventListener('resize', compute)
      window.visualViewport?.removeEventListener('resize', compute)
      window.visualViewport?.removeEventListener('scroll', compute)
    }
  }, [open, align, minWidth, maxHeight])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (wrapperRef.current?.contains(t)) return
      if (panelRef.current?.contains(t)) return
      onOpenChange(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onOpenChange(false) }
    const id = window.setTimeout(() => document.addEventListener('click', onClick), 0)
    document.addEventListener('keydown', onKey)
    return () => {
      clearTimeout(id)
      document.removeEventListener('click', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open, onOpenChange])

  return (
    <div ref={wrapperRef} className={wrapperClassName}>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onOpenChange(!open)
        }}
        className={triggerClassName}
        style={{
          ...triggerStyle,
          height: 30,
          ...(open
            ? {
                borderBottomLeftRadius: 0,
                borderBottomRightRadius: 0,
                position: 'relative',
                zIndex: 62,
              }
            : null),
        }}
        aria-haspopup={ariaHaspopup}
        aria-expanded={open}
        aria-label={ariaLabel}
      >
        {triggerChildren}
      </button>

      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {open && pos && (
              <motion.div
                ref={panelRef}
                role={ariaHaspopup}
                aria-label={ariaLabel}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 4 }}
                transition={{ duration: 0.14, ease: HEADER_DROPDOWN_EASE }}
                style={{
                  position: 'fixed',
                  top: pos.top,
                  left: pos.left,
                  width: pos.width,
                  zIndex: 80,
                  ...headerDropdownPanelStyle(align, pos.maxHeight, flexShell),
                }}
              >
                {children}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body,
        )}
    </div>
  )
}

/**
 * Collection switcher - shared between desktop filter bar and mobile
 * search row so switching TCGs is one tap, not buried in "More".
 */
function CollectionPicker({
  activeCollection,
  setActiveCollection,
  ctrl,
  triggerMaxWidth,
  menuAlign = 'left',
}: {
  activeCollection: Collection
  setActiveCollection: (c: Collection) => void
  ctrl: React.CSSProperties
  triggerMaxWidth?: number
  menuAlign?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const activeName = COLLECTIONS.find((c) => c.id === activeCollection)?.name ?? 'Collection'

  return (
    <HeaderDropdown
      ariaLabel="Collection"
      align={menuAlign}
      minWidth={200}
      open={open}
      onOpenChange={setOpen}
      wrapperClassName="relative shrink-0 min-w-0 overflow-visible"
      triggerClassName="footer-btn inline-flex items-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium w-full"
      triggerStyle={{
        ...ctrl,
        ...(triggerMaxWidth ? { maxWidth: triggerMaxWidth } : null),
      }}
      triggerChildren={
        <>
          <span
            className="truncate"
            style={{ minWidth: 0, ...(triggerMaxWidth ? { maxWidth: triggerMaxWidth - 28 } : null) }}
          >
            {activeName}
          </span>
          <DropdownChevron open={open} />
        </>
      }
    >
      {COLLECTIONS.map((c) => {
        const selected = c.id === activeCollection
        const disabled = !c.available
        return (
          <FacetOptionRow
            key={c.id}
            label={disabled ? `${c.name} (soon)` : c.name}
            selected={selected}
            onClick={() => {
              if (disabled) return
              setActiveCollection(c.id)
              setOpen(false)
            }}
          />
        )
      })}
    </HeaderDropdown>
  )
}

/**
 * Boolean toggle row for the Filters panel's View section. Unlike
 * FacetOptionRow (a single-select list where a bare checkmark reads fine),
 * these are independent on/off switches, so each renders a persistent
 * checkbox box that's visible whether or not it's checked.
 */
function ToggleRow({
  label,
  checked,
  onClick,
}: {
  label: string
  checked: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={onClick}
      className="w-full flex items-center gap-2.5 px-2.5 text-xs font-medium text-left transition-colors"
      style={{ height: 32, borderRadius: 5, background: 'transparent', color: 'var(--text-primary)', cursor: 'pointer' }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 8%, transparent)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        aria-hidden
        className="inline-flex items-center justify-center"
        style={{
          width: 16,
          height: 16,
          borderRadius: 4,
          flexShrink: 0,
          background: checked ? 'var(--text-primary)' : 'transparent',
          border: checked
            ? '1px solid var(--text-primary)'
            : '1px solid color-mix(in srgb, var(--text-primary) 32%, transparent)',
          transition: 'background 0.15s ease, border-color 0.15s ease',
        }}
      >
        <Check size={11} strokeWidth={3} style={{ color: 'var(--bg)', opacity: checked ? 1 : 0 }} />
      </span>
      <span className="flex-1">{label}</span>
    </button>
  )
}

/** Labeled section inside the consolidated Filters panel. */
function PanelSection({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: 'var(--text-muted)' }}
      >
        {label}
      </div>
      {children}
    </div>
  )
}

/**
 * Card-density slider, shared by the desktop inline control and the
 * Filters panel's "Card size" section. `max` tracks the per-viewport
 * column cap (denser on desktop than on phones) so the whole slider
 * travel maps to a visible change.
 */
function ZoomControl({
  zoom,
  setZoom,
  ctrl,
  max,
  style,
}: {
  zoom: number
  setZoom: (z: number) => void
  ctrl: React.CSSProperties
  max: number
  style?: React.CSSProperties
}) {
  const v = Math.min(zoom, max)
  // Fill the track up to the thumb with the accent so the slider reads as
  // a deliberate progress control instead of a faint line with a thumb
  // stranded far left at low zoom (which looked like empty dead space).
  const pct = max > 1 ? ((v - 1) / (max - 1)) * 100 : 0
  const trackFill = `linear-gradient(to right, var(--text-primary) 0%, var(--text-primary) ${pct}%, var(--border-subtle) ${pct}%, var(--border-subtle) 100%)`
  return (
    <div className="flex items-center gap-2 px-3" style={{ ...ctrl, height: 30, ...style }}>
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6" />
      </svg>
      <input
        type="range"
        min={1}
        max={max}
        step={1}
        value={v}
        onChange={(e) => setZoom(Number(e.target.value))}
        className="zoom-slider flex-1"
        aria-label="Card size"
        style={{ background: trackFill }}
      />
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
      </svg>
    </div>
  )
}

export function Header({ sets, artists, characters, typeTags }: HeaderProps) {
  const {
    searchQuery, setSearchQuery,
    activeSet, setActiveSet,
    activeRarity, setActiveRarity,
    activeColor, setActiveColor,
    activeCardType, setActiveCardType,
    activeSubtype, setActiveSubtype,
    activeArtist, setActiveArtist,
    activeCharacters, toggleCharacter, clearCharacters,
    activeTypeTags, toggleTypeTag, clearTypeTags,
    onlyAltArt, setOnlyAltArt,
    onlyErrata, setOnlyErrata,
    flattenWall, setFlattenWall,
    showTilePrices, setShowTilePrices,
    wallSort, setWallSort,
    language, setLanguage,
    activeCollection, setActiveCollection,
    zoom, setZoom,
    pinned, setBoardOpen,
  } = useStore()

  // Every TCG gets Card type / Rarity / Color facets, populated from
  // the per-collection config table. Alt art + Flatten ride a
  // per-collection `hasVariants` flag - Digimon, DBS, Gundam, and One
  // Piece all bundle parallel/alt prints as nested variants on a base
  // card, so the stacked-tile hint and the flatten-the-wall mode all
  // apply identically. Pokémon parallels ship as separate cards (no
  // nested variants), so those toggles stay hidden there. Language is
  // still One-Piece-only because only the OP pipeline ingests
  // per-region scans.
  const facets = COLLECTION_FACETS[activeCollection]
  const isOnePiece = activeCollection === 'one-piece'
  const isGundam = activeCollection === 'gundam'
  const isPokemon = activeCollection === 'pokemon'
  const isLorcana = activeCollection === 'lorcana'
  const isAzuki = activeCollection === 'azuki'
  // Azuki has no pricing pipeline yet, so it stays out of hasPricing.
  const hasPricing = isOnePiece || isGundam || isPokemon || isLorcana
  // Collections that have a meaningful `power` field (HP for Pokémon,
  // strength for Lorcana, power stat for OP/Gundam, attack for Azuki).
  // Used to show/hide the "Power ↓" sort option.
  const hasPower = isOnePiece || isGundam || isPokemon || isLorcana || isAzuki
  // Collections that have a meaningful `cost` field. Pokémon cost is always
  // null in the bundle, so cost sort is pointless there.
  const hasCost = !isPokemon
  const showVariantToggles = facets.hasVariants
  // Sort options shared by the desktop pill and the mobile row-4 popover.
  // Rendered through FacetPopover (placeholder = "Sort: Default" doubles as
  // the clear row) so sort gets the same toggle/close behavior, styling,
  // and active highlight as every other filter control.
  const sortOptions: FacetOption[] = [
    ...(hasCost
      ? [{ value: 'cost-asc', label: 'Cost ↑' }, { value: 'cost-desc', label: 'Cost ↓' }]
      : []),
    { value: 'rarity', label: 'Rarity' },
    { value: 'type', label: 'Card type' },
    ...(hasPower
      ? [{ value: 'power-desc', label: isPokemon ? 'HP ↓' : isLorcana ? 'Strength ↓' : 'Power ↓' }]
      : []),
    ...(hasPricing ? [{ value: 'price-desc', label: 'Price ↓' }] : []),
  ]
  // Consolidated Filters panel. Anchored under its trigger like the
  // shared nav sheet so it drops straight down on every viewport.
  const [filterOpen, setFilterOpen] = useState(false)
  const filterBtnRef = useRef<HTMLButtonElement>(null)
  const [filterPos, setFilterPos] = useState<{ top: number; right: number }>({ top: 96, right: 0 })

  // Track viewport width so the zoom slider's max matches the grid's
  // per-viewport column cap (desktop allows a denser wall than phones).
  const [windowWidth, setWindowWidth] = useState(1280)
  useEffect(() => {
    const onResize = () => setWindowWidth(window.innerWidth)
    onResize()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  const zoomMax = windowWidth >= 1024 ? 29 : 13

  // While the Filters panel is open, lock body scroll, keep it pinned
  // under the trigger, and close on Escape (backdrop tap closes too).
  useEffect(() => {
    if (!filterOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const measure = () => {
      const r = filterBtnRef.current?.getBoundingClientRect()
      if (r) {
        setFilterPos({
          top: Math.round(r.bottom + 6),
          right: Math.round(window.innerWidth - r.right),
        })
      }
    }
    measure()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFilterOpen(false)
    }
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
      document.removeEventListener('keydown', onKey)
    }
  }, [filterOpen])

  // Pin count is per-collection (matches board panel behaviour).
  const pinnedCount = pinned.filter((p) => p.collection === activeCollection).length

  // Count of active narrowing filters (everything that earns a chip,
  // excluding the always-visible search box). Drives the Filters button
  // badge so the user can see at a glance that filters are applied even
  // with the panel closed.
  const activeFilterCount =
    (activeSet ? 1 : 0) +
    (activeCardType ? 1 : 0) +
    (activeRarity ? 1 : 0) +
    (activeColor ? 1 : 0) +
    (activeSubtype ? 1 : 0) +
    (activeArtist ? 1 : 0) +
    activeCharacters.length +
    activeTypeTags.length +
    (onlyAltArt ? 1 : 0) +
    (onlyErrata ? 1 : 0) +
    (flattenWall ? 1 : 0)

  const anyChipFilter = activeFilterCount > 0 || searchQuery.trim().length > 0

  // Reset every narrowing filter (plus sort) back to default. Search is
  // left alone since it lives in the bar, not the panel.
  const clearAllFilters = () => {
    setActiveSet(null); setActiveRarity(null); setActiveColor(null)
    setActiveCardType(null); setActiveSubtype(null); setActiveArtist(null)
    clearCharacters(); clearTypeTags()
    setOnlyAltArt(false); setOnlyErrata(false); setFlattenWall(false)
    setWallSort('default')
  }

  // Shared style token · matches logo's rounded-rect language.
  // Border uses color-mix against --text-primary (rather than the
  // global --border-subtle token) so the rounded-rect always reads
  // as a button at rest. The previous --border-subtle = 6% opacity
  // was invisible against the dark surface, which made focus rings
  // on individual controls (from globals.css :focus-visible) look
  // like an inconsistency between siblings rather than an additive
  // accessibility cue. 14% is dim enough to feel quiet but firm
  // enough to anchor the control without competing with active
  // (orange) state styling below.
  const ctrl: React.CSSProperties = {
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
    borderRadius: 6,
  }

  // Accent for controls holding an active filter value.
  //
  // We override `border` as a full shorthand here (instead of just
  // `borderColor`) so React's reconciler stays happy. The previous
  // borderColor-only override produced "Removing a style property
  // during rerender (borderColor) when a conflicting property is set
  // (border) can lead to styling bugs" because toggling back to
  // `ctrl` would drop `borderColor` while keeping `border`.
  const ctrlActive: React.CSSProperties = {
    ...ctrl,
    border: '1px solid color-mix(in srgb, #E85D2A 55%, transparent)',
    boxShadow: '0 0 0 1px color-mix(in srgb, #E85D2A 22%, transparent) inset',
  }

  return (
    <header
      data-gallery-header
      className="fixed top-0 left-0 right-0 z-50 overflow-visible"
      style={{
        // Heavier background-color so we can lean less on backdrop-filter,
        // which is a major Safari scroll-jank source when it's blurring a
        // large painted region beneath a fixed bar.
        background: 'color-mix(in srgb, var(--bg) 92%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      {/* ── Top bar · unified with the rest of the site ────────────────
          Logo + tagline + gallery quick-actions (Tiers / Board) + the
          shared SiteNavMenu (theme + hamburger). Identical chrome to
          every other page so the home page reads as part of the set. */}
      <div
        className="mx-auto flex items-center justify-between gap-4 px-4"
        style={{ maxWidth: 1800, height: 52 }}
      >
        <BrandLockup />

        {/* Tagline · wide screens only so it never crowds the controls. */}
        <div
          aria-hidden
          className="hidden lg:flex flex-1 items-center justify-center pointer-events-none select-none"
          style={{ minWidth: 0 }}
        >
          <span
            className="whitespace-nowrap"
            style={{
              fontFamily: 'var(--font-display)',
              fontStyle: 'italic',
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: '-0.01em',
              color: 'var(--text-muted)',
              opacity: 0.9,
            }}
          >
            <span style={{ color: '#E85D2A', fontWeight: 800, marginRight: 2 }}>“</span>
            The whole game, on one wall.
            <span style={{ color: '#E85D2A', fontWeight: 800, marginLeft: 2 }}>”</span>
          </span>
        </div>

        {/* Right cluster · the Board quick-action + shared nav. The Board
            is a high-frequency gallery action (pin cards from the lightbox,
            review them here), so it stays a compact icon button on the wall.
            Every page destination - including the tier list maker - lives in
            the hamburger for cross-page uniformity. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="footer-btn relative inline-flex items-center justify-center"
            style={{ ...ctrl, width: 36, height: 36 }}
            onClick={() => setBoardOpen(true)}
            aria-label={pinnedCount > 0 ? `Board (${pinnedCount} pinned)` : 'Board'}
            title="Board"
          >
            <Bookmark size={15} strokeWidth={2} fill={pinnedCount > 0 ? 'currentColor' : 'none'} />
            {pinnedCount > 0 && (
              <span
                className="absolute -top-1 -right-1 inline-flex items-center justify-center text-[9px] font-bold"
                style={{ minWidth: 14, height: 14, padding: '0 3px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
              >
                {pinnedCount}
              </span>
            )}
          </button>

          <SiteNavMenu topOffset={52} />
        </div>
      </div>

      {/* ── Filter bar · slim, consolidated ─────────────────────────────
          One row on every viewport: Collection pill + Search + the single
          Filters button (opens the panel) + an inline zoom on wider
          screens. Replaces the old 5-row mobile / crammed desktop
          toolbars. */}
      <div
        className="mx-auto flex items-center gap-2 px-4 min-w-0"
        style={{ maxWidth: 1800, height: 44, borderTop: '1px solid var(--border-subtle)' }}
      >
        <CollectionPicker
          activeCollection={activeCollection}
          setActiveCollection={setActiveCollection}
          ctrl={ctrl}
          triggerMaxWidth={132}
        />

        <div className="relative flex-1 min-w-0" style={{ height: 30 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={windowWidth < 640 ? 'Search…' : 'Search name, code, or card text…'}
            className="w-full h-full pl-3 pr-8 text-xs outline-none"
            style={{ ...(searchQuery.trim() ? ctrlActive : ctrl), height: 30 }}
            aria-label="Search cards"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              className="absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center"
              style={{ right: 6, width: 16, height: 16, borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)', cursor: 'pointer', border: 'none', padding: 0 }}
            >
              <X size={10} strokeWidth={3} />
            </button>
          )}
        </div>

        <button
          ref={filterBtnRef}
          type="button"
          onClick={() => setFilterOpen((o) => !o)}
          className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium shrink-0"
          style={{ ...(activeFilterCount > 0 ? ctrlActive : ctrl), height: 30 }}
          aria-haspopup="dialog"
          aria-expanded={filterOpen}
          aria-controls="gallery-filter-panel"
        >
          <SlidersHorizontal size={13} strokeWidth={2.25} aria-hidden />
          <span>Filters</span>
          {activeFilterCount > 0 && (
            <span
              className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
              style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
            >
              {activeFilterCount}
            </span>
          )}
        </button>

      </div>

      {/* ── Card size · its own full-width row (mobile + desktop) ─────────
          The zoom scrub is the wall's signature interaction, so it lives
          out in the open on every viewport rather than buried in the
          Filters panel. Label + filled track makes its purpose obvious. */}
      <div
        className="mx-auto flex items-center gap-3 px-4"
        style={{ maxWidth: 1800, height: 44, borderTop: '1px solid var(--border-subtle)' }}
      >
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.16em] shrink-0"
          style={{ color: 'var(--text-muted)' }}
        >
          Card size
        </span>
        <div className="flex-1 min-w-0">
          <ZoomControl zoom={zoom} setZoom={setZoom} ctrl={ctrl} max={zoomMax} />
        </div>
      </div>

      {/* ── Filters panel · backdrop + anchored sheet ───────────────────
          Drops straight under the Filters button (right-anchored like the
          nav sheet) so it reads as a near-full-width sheet on phones and a
          tidy panel on desktop. Re-hosts every existing facet control as a
          labeled section - logic unchanged, just decluttered.
          Portaled to <body> so it escapes the header's z-50 stacking
          context; otherwise the card grid paints over the backdrop and
          outside-clicks fall through to the wall instead of closing. */}
      {typeof document !== 'undefined' &&
        createPortal(
          <>
      <AnimatePresence>
        {filterOpen && (
          <motion.div
            key="gallery-filter-backdrop"
            className="fixed inset-0"
            style={{ zIndex: 60, background: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: HEADER_DROPDOWN_EASE }}
            onClick={() => setFilterOpen(false)}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {filterOpen && (
          <motion.div
            key="gallery-filter-panel"
            id="gallery-filter-panel"
            role="dialog"
            aria-label="Filters"
            className="fixed flex flex-col gap-4 overflow-y-auto px-4 pb-4 pt-4"
            style={{
              top: filterPos.top,
              right: filterPos.right,
              zIndex: 61,
              width: 'min(380px, calc(100vw - 16px))',
              maxHeight: `calc(100dvh - ${filterPos.top}px)`,
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border-subtle)',
              borderLeft: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-subtle)',
              borderBottomLeftRadius: 16,
              borderBottomRightRadius: 16,
              boxShadow: 'var(--shadow-card)',
            }}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2, ease: HEADER_DROPDOWN_EASE }}
          >
            <PanelSection label="Set">
              <div className="flex">
                <FacetPopover
                  placeholder="All Sets"
                  ariaLabel="Filter by set"
                  value={activeSet}
                  onChange={setActiveSet}
                  options={sets.map((s) => ({ value: s.setCode, label: `${s.setCode} · ${s.setName}` }))}
                  ctrl={ctrl}
                  ctrlActive={ctrlActive}
                  menuMinWidth={230}
                  menuMaxHeight={360}
                  fluid
                />
              </div>
            </PanelSection>

            <PanelSection label="Type">
              <div className="flex">
                <FacetPopover
                  placeholder="All types"
                  ariaLabel="Filter by card type"
                  value={activeCardType}
                  onChange={setActiveCardType}
                  options={facets.cardTypes}
                  ctrl={ctrl}
                  ctrlActive={ctrlActive}
                  menuMinWidth={150}
                  fluid
                />
              </div>
            </PanelSection>

            <PanelSection label="Rarity">
              <div className="flex">
                <FacetPopover
                  placeholder="All rarities"
                  ariaLabel="Filter by rarity"
                  value={activeRarity}
                  onChange={setActiveRarity}
                  options={facets.rarities}
                  ctrl={ctrl}
                  ctrlActive={ctrlActive}
                  menuMinWidth={180}
                  menuMaxHeight={320}
                  fluid
                />
              </div>
            </PanelSection>

            <PanelSection label="Color">
              <div className="flex">
                <FacetPopover
                  placeholder="All colors"
                  ariaLabel="Filter by color"
                  value={activeColor}
                  onChange={setActiveColor}
                  options={facets.colors}
                  ctrl={ctrl}
                  ctrlActive={ctrlActive}
                  menuMinWidth={150}
                  fluid
                />
              </div>
            </PanelSection>

            {facets.subtypes && (
              <PanelSection label={facets.subtypeLabel ?? 'Era / subtype'}>
                <div className="flex">
                  <FacetPopover
                    placeholder={facets.subtypePlaceholder ?? 'All subtypes'}
                    ariaLabel={`Filter by ${(facets.subtypeLabel ?? 'subtype').toLowerCase()}`}
                    value={activeSubtype}
                    onChange={setActiveSubtype}
                    options={facets.subtypes}
                    ctrl={ctrl}
                    ctrlActive={ctrlActive}
                    menuMinWidth={170}
                    menuMaxHeight={320}
                    fluid
                  />
                </div>
              </PanelSection>
            )}

            {artists.length > 0 && (
              <PanelSection label="Artist">
                <div className="flex">
                  <ArtistTypeahead
                    value={activeArtist}
                    onChange={setActiveArtist}
                    artists={artists}
                    ctrl={ctrl}
                    ctrlActive={ctrlActive}
                  />
                </div>
              </PanelSection>
            )}

            {characters.length > 0 && (
              <PanelSection label="Characters">
                <div className="flex">
                  <CharacterPicker
                    characters={characters}
                    selected={activeCharacters}
                    onToggle={toggleCharacter}
                    onClear={clearCharacters}
                    ctrl={ctrl}
                    ctrlActive={ctrlActive}
                    fluid
                  />
                </div>
              </PanelSection>
            )}

            {facets.typeTagLabel && typeTags.length > 0 && (
              <PanelSection label={facets.typeTagLabel}>
                <div className="flex">
                  <CharacterPicker
                    characters={typeTags}
                    selected={activeTypeTags}
                    onToggle={toggleTypeTag}
                    onClear={clearTypeTags}
                    ctrl={ctrl}
                    ctrlActive={ctrlActive}
                    title={facets.typeTagLabel}
                    noun={facets.typeTagLabel.toLowerCase()}
                    fluid
                  />
                </div>
              </PanelSection>
            )}

            <PanelSection label="Sort">
              <div className="flex">
                <FacetPopover
                  placeholder="Sort: Default"
                  ariaLabel="Sort cards"
                  value={wallSort === 'default' ? null : wallSort}
                  onChange={(v) => setWallSort((v ?? 'default') as typeof wallSort)}
                  options={sortOptions}
                  ctrl={ctrl}
                  ctrlActive={ctrlActive}
                  menuMinWidth={150}
                  fluid
                />
              </div>
            </PanelSection>

            {(showVariantToggles || isOnePiece || hasPricing) && (
              <PanelSection label="View">
                <div className="flex flex-col" style={{ ...ctrl, padding: 4 }}>
                  {showVariantToggles && (
                    <>
                      <ToggleRow label="Alt art only" checked={onlyAltArt} onClick={() => setOnlyAltArt(!onlyAltArt)} />
                      <ToggleRow label="Flatten the wall" checked={flattenWall} onClick={() => setFlattenWall(!flattenWall)} />
                    </>
                  )}
                  {isOnePiece && (
                    <ToggleRow label="Errata only" checked={onlyErrata} onClick={() => setOnlyErrata(!onlyErrata)} />
                  )}
                  {hasPricing && (
                    <ToggleRow label="Show prices" checked={showTilePrices} onClick={() => setShowTilePrices(!showTilePrices)} />
                  )}
                </div>
              </PanelSection>
            )}

            {isOnePiece && (
              <PanelSection label="Language">
                <LanguageToggle language={language} setLanguage={setLanguage} ctrl={ctrl} fullWidth />
              </PanelSection>
            )}

            <div
              className="sticky bottom-0 flex items-center gap-2 pt-2"
              style={{ background: 'var(--bg-surface)' }}
            >
              <button
                type="button"
                onClick={clearAllFilters}
                disabled={activeFilterCount === 0}
                className="footer-btn inline-flex flex-1 items-center justify-center px-3 py-2 text-xs font-semibold"
                style={{ ...ctrl, opacity: activeFilterCount === 0 ? 0.5 : 1 }}
              >
                Clear all{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
              </button>
              <button
                type="button"
                onClick={() => setFilterOpen(false)}
                className="footer-btn inline-flex flex-1 items-center justify-center px-3 py-2 text-xs font-semibold"
                style={{ background: 'var(--text-primary)', color: 'var(--bg)', borderRadius: 6, border: 'none' }}
              >
                Done
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
          </>,
          document.body,
        )}

      {/* Active-filter chip strip - visible whenever at least one filter
          is on. Lives in the fixed header (not the scrollable card wall)
          so the current filter state is always visible while browsing. */}
      {anyChipFilter && (
        <div
          className="flex items-center gap-1.5 px-4"
          style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, paddingBottom: 6 }}
        >
          <span
            className="text-[10px] tracking-[0.18em] uppercase mr-1 shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            Filters
          </span>
          {/* Chips scroll horizontally in a single row. Wrapping to a
              second row would make the real header taller than the
              fixed height the card grid budgets (CHIP_ROW_H), sliding
              the wall under the header - worse now that the character
              picker can add many chips at once. */}
          <div className="no-scrollbar flex items-center gap-1.5 min-w-0 flex-1" style={{ overflowX: 'auto', overflowY: 'hidden' }}>
          {activeSet && <FilterChip label={activeSet} onClear={() => setActiveSet(null)} />}
          {activeCardType && (
            <FilterChip
              label={facetLabel(facets.cardTypes, activeCardType) || formatCardType(activeCardType)}
              onClear={() => setActiveCardType(null)}
            />
          )}
          {activeRarity && (
            <FilterChip
              label={facetLabel(facets.rarities, activeRarity) || activeRarity}
              onClear={() => setActiveRarity(null)}
            />
          )}
          {activeColor && <FilterChip label={activeColor} onClear={() => setActiveColor(null)} />}
          {activeSubtype && (
            <FilterChip
              label={facetLabel(facets.subtypes ?? [], activeSubtype) || activeSubtype}
              onClear={() => setActiveSubtype(null)}
            />
          )}
          {activeArtist && <FilterChip label={activeArtist} onClear={() => setActiveArtist(null)} />}
          {activeCharacters.map((name) => (
            <FilterChip key={name} label={name} onClear={() => toggleCharacter(name)} />
          ))}
          {activeTypeTags.map((tag) => (
            <FilterChip key={tag} label={tag} onClear={() => toggleTypeTag(tag)} />
          ))}
          {onlyAltArt && (
            <FilterChip
              label={flattenWall ? 'Alt prints only' : 'Has alt art'}
              onClear={() => setOnlyAltArt(false)}
            />
          )}
          {onlyErrata && <FilterChip label="Errata only" onClear={() => setOnlyErrata(false)} />}
          {flattenWall && <FilterChip label="Flattened" onClear={() => setFlattenWall(false)} />}
          {searchQuery.trim() && (
            <FilterChip
              label={`"${searchQuery.trim()}"`}
              onClear={() => setSearchQuery('')}
            />
          )}
          </div>
          <button
            type="button"
            onClick={() => {
              clearAllFilters()
              setSearchQuery('')
            }}
            className="ml-1 text-[10px] tracking-[0.14em] uppercase shrink-0"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Clear all
          </button>
        </div>
      )}
    </header>
  )
}
