'use client'

import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import { BrandLockup } from './brand-lockup'
import Link from 'next/link'
import { Bookmark, HelpCircle, Layers, LineChart, Menu, X, Check, ChevronDown, Package, Trophy } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore, type Collection } from '@/lib/store'
import { apiActiveStatus } from '@/lib/tournament/client'
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
      }}
    >
      {label}
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
 * Polls the cheap `/active/status` probe so the nav can flag a live
 * tournament (enrolling or running) without pulling the full snapshot.
 * 60s cadence + an on-focus re-check: long enough to be near-free
 * site-wide, fresh enough that the badge appears shortly after an admin
 * opens sign-ups. Fails closed (no badge) on any error.
 */
function useTournamentLive(): boolean {
  const [live, setLive] = useState(false)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      const { live: isLive } = await apiActiveStatus()
      if (!cancelled) setLive(isLive)
    }
    check()
    const t = window.setInterval(check, 60_000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return live
}

/** Corner heartbeat for icon-only triggers (no room for a word). */
function LiveDot() {
  return (
    <span
      aria-hidden
      className="live-dot absolute rounded-full"
      style={{
        top: -3,
        right: -3,
        width: 9,
        height: 9,
        background: '#ef4444',
        boxShadow: '0 0 0 2px var(--bg)',
      }}
    />
  )
}

/** "LIVE" pill for the labelled Tournaments triggers. */
function LivePill() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-bold uppercase leading-none"
      style={{
        padding: '2px 5px',
        borderRadius: 4,
        background: '#ef4444',
        color: '#fff',
        letterSpacing: '0.08em',
      }}
    >
      <span
        aria-hidden
        className="live-dot rounded-full"
        style={{ width: 5, height: 5, background: '#fff' }}
      />
      Live
    </span>
  )
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
  minWidth: number,
  maxWidth: string,
  maxHeight?: number,
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
  zIndex: 61,
  padding: 4,
  minWidth,
  maxWidth,
  ...(maxHeight
    ? { maxHeight, overflowY: 'auto', overflowX: 'hidden' }
    : { overflow: 'hidden' }),
})

function HeaderDropdown({
  ariaLabel,
  ariaHaspopup = 'listbox',
  align = 'left',
  minWidth = 180,
  maxHeight,
  maxWidth = 'calc(100vw - 24px)',
  wrapperClassName = 'relative shrink-0 overflow-visible',
  triggerClassName = 'footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium outline-none whitespace-nowrap',
  triggerStyle,
  open,
  onOpenChange,
  triggerChildren,
  children,
}: {
  ariaLabel: string
  ariaHaspopup?: 'listbox' | 'menu'
  align?: 'left' | 'right'
  minWidth?: number
  maxHeight?: number
  maxWidth?: string
  wrapperClassName?: string
  triggerClassName?: string
  triggerStyle: React.CSSProperties
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerChildren: React.ReactNode
  children: React.ReactNode
}) {
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        onOpenChange(false)
      }
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

      <AnimatePresence>
        {open && (
          <motion.div
            role={ariaHaspopup}
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.14, ease: HEADER_DROPDOWN_EASE }}
            className={`absolute top-full ${align === 'right' ? 'right-0' : 'left-0'}`}
            style={headerDropdownPanelStyle(align, minWidth, maxWidth, maxHeight)}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
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
 * Mobile-only overflow menu for secondary filters (Alt art, Flatten,
 * Errata, Prices, Language). Collection switching lives in its own
 * picker on the search row so it stays one tap away.
 */
function MobileMoreFiltersMenu({
  showVariantToggles,
  isOnePiece,
  onlyAltArt,
  setOnlyAltArt,
  flattenWall,
  setFlattenWall,
  onlyErrata,
  setOnlyErrata,
  showTilePrices,
  setShowTilePrices,
  hasPricing,
  language,
  setLanguage,
  ctrl,
  ctrlActive,
}: {
  showVariantToggles: boolean
  isOnePiece: boolean
  onlyAltArt: boolean
  setOnlyAltArt: (v: boolean) => void
  flattenWall: boolean
  setFlattenWall: (v: boolean) => void
  onlyErrata: boolean
  setOnlyErrata: (v: boolean) => void
  showTilePrices: boolean
  setShowTilePrices: (v: boolean) => void
  hasPricing: boolean
  language: LanguagePickerValue
  setLanguage: (v: LanguagePickerValue) => void
  ctrl: React.CSSProperties
  ctrlActive: React.CSSProperties
}) {
  const [open, setOpen] = useState(false)

  const activeCount =
    (onlyAltArt ? 1 : 0) +
    (flattenWall ? 1 : 0) +
    (onlyErrata ? 1 : 0) +
    (showTilePrices ? 1 : 0)
  const isActive = activeCount > 0

  return (
    <HeaderDropdown
      ariaLabel={activeCount > 0 ? `More filters (${activeCount} active)` : 'More filters'}
      ariaHaspopup="menu"
      align="right"
      open={open}
      onOpenChange={setOpen}
      triggerStyle={isActive ? ctrlActive : ctrl}
      triggerChildren={
        <>
          More
          {activeCount > 0 && (
            <span
              className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
              style={{
                minWidth: 16,
                height: 16,
                padding: '0 4px',
                borderRadius: 999,
                background: 'var(--text-primary)',
                color: 'var(--bg)',
              }}
            >
              {activeCount}
            </span>
          )}
          <DropdownChevron open={open} />
        </>
      }
    >
      {showVariantToggles && (
        <>
          <FacetOptionRow
            label="Alt art"
            selected={onlyAltArt}
            onClick={() => setOnlyAltArt(!onlyAltArt)}
          />
          <FacetOptionRow
            label="Flatten"
            selected={flattenWall}
            onClick={() => setFlattenWall(!flattenWall)}
          />
        </>
      )}
      {isOnePiece && (
        <FacetOptionRow
          label="Errata"
          selected={onlyErrata}
          onClick={() => setOnlyErrata(!onlyErrata)}
        />
      )}
      {hasPricing && (
        <FacetOptionRow
          label="Prices"
          selected={showTilePrices}
          onClick={() => setShowTilePrices(!showTilePrices)}
        />
      )}
      {isOnePiece && (
        <div
          className="px-2.5 py-2"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <div
            className="text-[10px] font-semibold uppercase tracking-wide mb-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            Language
          </div>
          <div
            className="inline-flex items-center w-full"
            style={{
              ...ctrl,
              height: 30,
              padding: 2,
              overflow: 'hidden',
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
        </div>
      )}
    </HeaderDropdown>
  )
}

export function Header({ sets, artists }: HeaderProps) {
  const {
    searchQuery, setSearchQuery,
    activeSet, setActiveSet,
    activeRarity, setActiveRarity,
    activeColor, setActiveColor,
    activeCardType, setActiveCardType,
    activeSubtype, setActiveSubtype,
    activeArtist, setActiveArtist,
    onlyAltArt, setOnlyAltArt,
    onlyErrata, setOnlyErrata,
    flattenWall, setFlattenWall,
    showTilePrices, setShowTilePrices,
    wallSort, setWallSort,
    language, setLanguage,
    activeCollection, setActiveCollection,
    zoom, setZoom,
    pinned, setBoardOpen,
    tierPool,
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
  const hasPricing = isOnePiece || isGundam || isPokemon || isLorcana
  // Collections that have a meaningful `power` field (HP for Pokémon,
  // strength for Lorcana, power stat for OP/Gundam). Used to show/hide
  // the "Power ↓" sort option.
  const hasPower = isOnePiece || isGundam || isPokemon || isLorcana
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
  const altArtTitle = flattenWall
    ? (onlyAltArt ? 'Showing alt prints only (no base cards)' : 'Show alt prints only on the flattened wall')
    : (onlyAltArt ? 'Showing only cards with alt art' : 'Show only cards with alt art')
  const altArtAria = altArtTitle
  const [mobileOpen, setMobileOpen] = useState(false)
  const tournamentLive = useTournamentLive()

  // While the mobile menu overlay is open, lock body scroll and let
  // Escape close it - reinforces that it's a focused modal layer, not
  // inline page content. Backdrop click also closes (below).
  useEffect(() => {
    if (!mobileOpen) return
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prevOverflow
      document.removeEventListener('keydown', onKey)
    }
  }, [mobileOpen])

  // Pin count is per-collection (matches board panel behaviour).
  const pinnedCount = pinned.filter((p) => p.collection === activeCollection).length
  // Tier-list queue count is global (the tier list maker is collection-agnostic).
  const tierPoolCount = tierPool.length

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
      <div
        className="relative z-[60] nav:z-auto mx-auto flex items-center justify-between gap-6 px-4 md:px-4"
        style={{ maxWidth: 1800, height: 48 }}
      >
        {/* Brand cluster - canonical logo lives in BrandLockup so every
            page renders the identical mark (see brand-lockup.tsx). */}
        <BrandLockup />

        {/* Tagline · shows only on wider viewports to avoid crowding controls */}
        <div
          aria-hidden
          className="hidden xl:flex flex-1 items-center justify-center pointer-events-none select-none"
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
            Find something you didn’t know existed
            <span style={{ color: '#E85D2A', fontWeight: 800, marginLeft: 2 }}>”</span>
          </span>
        </div>

        {/* ── Desktop row-1 cluster · grouped by size + role ──
            Layout (left → right): [Help] [X] [Theme] | [Tiers] [Board].
            Three 30×30 icon-only utilities first (informational,
            social, personal preference - the "meta" stuff that
            doesn't change your data), then the two labeled action
            buttons that operate on your collection. Grouping by size
            keeps the cluster from looking interleaved, and the size
            escalation left-to-right naturally pulls the eye toward
            the primary actions on the right. Filters live in row 2
            below; this row stays reserved for site-level actions
            only. */}
        <div className="hidden nav:flex items-center gap-2">
          {/* How-it-works · compact ? icon pointing to /help, which
              replaced the deprecated first-visit guided tour. */}
          <Link
            href="/help"
            className="footer-btn inline-flex items-center justify-center"
            style={{ ...ctrl, width: 30, height: 30 }}
            aria-label="How it works"
            title="How it works"
          >
            <HelpCircle size={14} strokeWidth={2.25} aria-hidden />
          </Link>

          {/* Feedback / X - compact icon-only so it sits comfortably in the nav */}
          <a
            href="https://x.com/point_onefive"
            target="_blank"
            rel="noopener noreferrer"
            className="footer-btn inline-flex items-center justify-center"
            style={{ ...ctrl, width: 30, height: 30 }}
            aria-label="Feedback on X (@point_onefive)"
            title="Feedback & suggestions"
          >
            <svg width="11" height="11" viewBox="0 0 1200 1227" fill="currentColor" aria-hidden>
              <path d="M714.2 519.3 1160.9 0H1055L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9L515.5 750.2l327.3 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l305 436.2 47.5 67.9 395.9 566.3H892.4L569.2 687.8Z" />
            </svg>
          </a>

          <ThemeToggle />

          <Link
            href="/tier-list"
            className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
            style={{
              ...ctrl,
              height: 30,
              background: tierPoolCount > 0 ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: tierPoolCount > 0 ? 'var(--bg)' : 'var(--text-primary)',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
            aria-label={tierPoolCount > 0 ? `Open tier list maker (${tierPoolCount} queued)` : 'Open tier list maker'}
            title="Tier list maker"
          >
            <Layers size={12} strokeWidth={2.25} aria-hidden fill={tierPoolCount > 0 ? 'currentColor' : 'none'} />
            Tiers
            {tierPoolCount > 0 && (
              <span
                className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)' }}
              >
                {tierPoolCount}
              </span>
            )}
          </Link>

          {/* Sealed: icon-only at nav, label from xl (same overflow fix). */}
          <Link
            href="/sealed"
            className="footer-btn inline-flex items-center justify-center xl:hidden"
            style={{ ...ctrl, width: 30, height: 30 }}
            aria-label="Booster box price dashboard"
            title="Booster box prices"
          >
            <Package size={12} strokeWidth={2.25} aria-hidden />
          </Link>
          <Link
            href="/sealed"
            className="footer-btn hidden xl:inline-flex items-center gap-1.5 px-3 text-xs font-medium"
            style={{ ...ctrl, height: 30, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            aria-label="Booster box price dashboard"
            title="Booster box prices"
          >
            <Package size={12} strokeWidth={2.25} aria-hidden />
            Sealed
          </Link>

          {/* Chart race + Tournaments: icon-only at nav to keep the cluster
              from overflowing 1440–1600px viewports. Full labels from xl. */}
          <Link
            href="/chart-race"
            className="footer-btn inline-flex items-center justify-center xl:hidden"
            style={{ ...ctrl, width: 30, height: 30 }}
            aria-label="Chart Race maker"
            title="Chart Race maker"
          >
            <LineChart size={12} strokeWidth={2.25} aria-hidden />
          </Link>
          <Link
            href="/chart-race"
            className="footer-btn hidden xl:inline-flex items-center gap-1.5 px-3 text-xs font-medium"
            style={{ ...ctrl, height: 30, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            aria-label="Chart Race maker"
            title="Chart Race maker"
          >
            <LineChart size={12} strokeWidth={2.25} aria-hidden />
            Chart Race
          </Link>

          <Link
            href="/tournaments"
            className={`footer-btn relative inline-flex items-center justify-center xl:hidden${tournamentLive ? ' tournament-live-breathe' : ''}`}
            style={{ ...ctrl, width: 30, height: 30 }}
            aria-label={tournamentLive ? 'Tournaments (live now)' : 'Tournaments'}
            title={tournamentLive ? 'Tournament live now' : 'Tournaments'}
          >
            <Trophy size={12} strokeWidth={2.25} aria-hidden />
            {tournamentLive && <LiveDot />}
          </Link>
          <Link
            href="/tournaments"
            className={`footer-btn hidden xl:inline-flex items-center gap-1.5 px-3 text-xs font-medium${tournamentLive ? ' tournament-live-breathe' : ''}`}
            style={{ ...ctrl, height: 30, background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            aria-label={tournamentLive ? 'Tournaments (live now)' : 'Tournaments'}
            title={tournamentLive ? 'Tournament live now' : 'Tournaments'}
          >
            <Trophy size={12} strokeWidth={2.25} aria-hidden />
            Tournaments
            {tournamentLive && <LivePill />}
          </Link>

          {/* Board trigger · last in the cluster so its variable-
              width count badge grows away from siblings, never into
              them. */}
          <button
            className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
            style={{
              ...ctrl,
              height: 30,
              background: pinnedCount > 0 ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: pinnedCount > 0 ? 'var(--bg)' : 'var(--text-primary)',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
            onClick={() => setBoardOpen(true)}
            aria-label={`Open board (${pinnedCount} pinned)`}
          >
            <Bookmark size={12} strokeWidth={2} fill={pinnedCount > 0 ? 'currentColor' : 'none'} />
            Board
            {pinnedCount > 0 && (
              <span
                className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)' }}
              >
                {pinnedCount}
              </span>
            )}
          </button>
        </div>

        {/* ── Mobile right cluster ──
            Keep this row minimal: Theme + Tiers + hamburger. Sealed,
            Chart Race, and Tournaments live in the mobile sheet only -
            six 32px chips overflowed narrow phones once Tournaments
            landed. Board stays here only when pins exist (actionable). */}
        <div className="flex nav:hidden items-center gap-1.5 shrink-0">
          {pinnedCount > 0 && (
            <button
              className="footer-btn relative inline-flex items-center justify-center"
              style={{ ...ctrl, width: 32, height: 32 }}
              onClick={() => setBoardOpen(true)}
              aria-label={`Board (${pinnedCount} pinned)`}
            >
              <Bookmark size={14} strokeWidth={2} fill="currentColor" />
              <span
                className="absolute -top-1 -right-1 inline-flex items-center justify-center text-[9px] font-bold"
                style={{ minWidth: 14, height: 14, padding: '0 3px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
              >
                {pinnedCount}
              </span>
            </button>
          )}

          <ThemeToggle />

          <Link
            href="/tier-list"
            className="footer-btn relative inline-flex items-center justify-center"
            style={{ ...ctrl, width: 32, height: 32 }}
            aria-label={tierPoolCount > 0 ? `Tier list maker (${tierPoolCount} queued)` : 'Tier list maker'}
            title="Tier list maker"
          >
            <Layers size={14} strokeWidth={2.25} aria-hidden fill={tierPoolCount > 0 ? 'currentColor' : 'none'} />
            {tierPoolCount > 0 && (
              <span
                className="absolute -top-1 -right-1 inline-flex items-center justify-center text-[9px] font-bold"
                style={{ minWidth: 14, height: 14, padding: '0 3px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
              >
                {tierPoolCount}
              </span>
            )}
          </Link>

          {/* Hamburger · Tournaments is sheet-only on mobile, so when an
              event is live the cue rides the hamburger (the thing that
              reveals it). Suppressed while the sheet is open - the
              Tournaments link inside carries its own LIVE pill there. */}
          <button
            className={`footer-btn relative inline-flex items-center justify-center${tournamentLive && !mobileOpen ? ' tournament-live-breathe' : ''}`}
            style={{ ...ctrl, width: 32, height: 32 }}
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={
              mobileOpen
                ? 'Close menu'
                : tournamentLive
                  ? 'Open menu (tournament live now)'
                  : 'Open menu'
            }
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav-menu"
          >
            {mobileOpen ? <X size={15} /> : <Menu size={15} />}
            {tournamentLive && !mobileOpen && <LiveDot />}
          </button>
        </div>
      </div>

      {/* ── Mobile row-2 · Collection + Search + Set ───────────────────
          Collection gets its own picker here (not buried in More) so
          switching TCGs is always one tap. Search flexes in the middle;
          Set anchors right like before. */}
      <div
        className="nav:hidden flex items-center gap-2 px-4 min-w-0 overflow-visible"
        style={{
          height: 40,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        <CollectionPicker
          activeCollection={activeCollection}
          setActiveCollection={setActiveCollection}
          ctrl={ctrl}
          triggerMaxWidth={108}
        />
        <div className="relative flex-1 min-w-0" style={{ height: 30 }}>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Name, code, or card text…"
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
              style={{
                right: 6,
                width: 16,
                height: 16,
                borderRadius: 999,
                background: 'var(--text-primary)',
                color: 'var(--bg)',
                cursor: 'pointer',
                border: 'none',
                padding: 0,
              }}
            >
              <X size={10} strokeWidth={3} />
            </button>
          )}
        </div>

        {/* Set selector · custom popover, same as desktop. Native mobile
            selects paint an OS menu that overlaps the trigger, ignores
            site styling, and doesn't toggle closed when the trigger is
            tapped again - all reported as bugs. The popover scrolls
            internally (menuMaxHeight) so the 50-set list stays usable
            on touch. Anchored right because it sits at the row's right
            edge. */}
        <FacetPopover
          placeholder="All Sets"
          ariaLabel="Filter by set"
          value={activeSet}
          onChange={setActiveSet}
          options={sets.map((s) => ({
            value: s.setCode,
            label: `${s.setCode} · ${s.setName}`,
          }))}
          ctrl={ctrl}
          ctrlActive={ctrlActive}
          menuMinWidth={230}
          menuMaxHeight={360}
          triggerMaxWidth={110}
          menuAlign="right"
        />
      </div>

      {/* ── Mobile row-3 · primary facets + More menu ──────────────────
          Card type / Rarity / Color stay visible as the three highest-
          frequency filters. Secondary toggles (Alt art, Flatten, Errata,
          Language) live behind a single "More" pill so the row fits
          narrow viewports without a horizontal scrollbar. */}
      <div
        className="nav:hidden flex items-center gap-2 px-4 min-w-0 overflow-visible"
        style={{
          height: 40,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Custom popovers (matching desktop) instead of native selects -
            the OS menu overlapped the trigger, clashed with site styling,
            and wouldn't toggle closed on a second tap. Fluid mode splits
            the row width between them. Compact labels ("Type" not "All
            types") keep every trigger readable on a 360px row; the menu's
            clear row still reads the full "All …" label. */}
        <FacetPopover
          placeholder="Type"
          clearLabel="All types"
          ariaLabel="Filter by card type"
          value={activeCardType}
          onChange={setActiveCardType}
          options={facets.cardTypes}
          ctrl={ctrl}
          ctrlActive={ctrlActive}
          menuMinWidth={150}
          fluid
        />
        <FacetPopover
          placeholder="Rarity"
          clearLabel="All rarities"
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
        <FacetPopover
          placeholder="Color"
          clearLabel="All colors"
          ariaLabel="Filter by color"
          value={activeColor}
          onChange={setActiveColor}
          options={facets.colors}
          ctrl={ctrl}
          ctrlActive={ctrlActive}
          menuMinWidth={150}
          fluid
          menuAlign="right"
        />
        {facets.subtypes && (
          <FacetPopover
            placeholder="Era"
            clearLabel="All subtypes"
            ariaLabel="Filter by subtype / era"
            value={activeSubtype}
            onChange={setActiveSubtype}
            options={facets.subtypes}
            ctrl={ctrl}
            ctrlActive={ctrlActive}
            menuMinWidth={170}
            menuMaxHeight={320}
            fluid
            menuAlign="right"
          />
        )}
        <MobileMoreFiltersMenu
          showVariantToggles={showVariantToggles}
          isOnePiece={isOnePiece}
          onlyAltArt={onlyAltArt}
          setOnlyAltArt={setOnlyAltArt}
          flattenWall={flattenWall}
          setFlattenWall={setFlattenWall}
          onlyErrata={onlyErrata}
          setOnlyErrata={setOnlyErrata}
          showTilePrices={showTilePrices}
          setShowTilePrices={setShowTilePrices}
          hasPricing={hasPricing}
          language={language}
          setLanguage={setLanguage}
          ctrl={ctrl}
          ctrlActive={ctrlActive}
        />
      </div>

      {/* ── Mobile row-4 · Sort + Artist + Zoom slider ─────────────────
          Zoom was the last hamburger-only control. Promoted here so
          the entire filter set is reachable without ever opening the
          sheet. Sort and the artist typeahead live in this same row -
          secondary controls that fit naturally beside zoom (and keep
          row-3's facet triggers from being crushed into "A…"). */}
      <div
        className="nav:hidden flex items-center gap-2 px-4 overflow-visible"
        style={{
          height: 40,
          borderTop: '1px solid var(--border-subtle)',
        }}
      >
        {/* Sort - same custom popover as desktop */}
        <FacetPopover
          placeholder="Sort: Default"
          ariaLabel="Sort cards"
          value={wallSort === 'default' ? null : wallSort}
          onChange={(v) => setWallSort((v ?? 'default') as typeof wallSort)}
          options={sortOptions}
          ctrl={ctrl}
          ctrlActive={ctrlActive}
          menuMinWidth={150}
        />

        {artists.length > 0 && (
          <ArtistTypeahead
            value={activeArtist}
            onChange={setActiveArtist}
            artists={artists}
            ctrl={ctrl}
            ctrlActive={ctrlActive}
          />
        )}

        <div
          className="flex items-center gap-2 flex-1 px-3"
          style={{ ...ctrl, height: 30 }}
        >
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
          </svg>
          <input
            /* max is 13 on mobile (vs 29 on desktop, see row-2
               slider). card-grid caps mobile output at 14 columns
               because the desktop ceiling of 30 cols produced
               unreadable ~10x14px tiles on phones - aligning the
               slider's max with that cap means the entire slider
               travel maps to a visible change instead of having a
               silent dead zone past tick 13. */
            type="range" min={1} max={13} step={1} value={Math.min(zoom, 13)}
            onChange={(e) => setZoom(Number(e.target.value))}
            className="zoom-slider flex-1" aria-label="Zoom level"
          />
          <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
          </svg>
        </div>
      </div>

      {/* ── Desktop row-2 filter cluster · nav+ only ───────────────
          All the gallery-narrowing controls live here so the brand
          row stays uncluttered. Subtle top border separates it from
          row 1 as a visual sub-toolbar without adding background
          weight.

          Gated on the custom `nav` breakpoint (1440px) rather than
          Tailwind's `lg`/`xl` defaults because the full inline row
          (Collection + Set + 3 facets + 4 toggles + language +
          search + zoom) needs ~1300-1400px of fixed-width content
          (the upper bound includes the worst-case set name "ST24 ·
          Starter - Green Jewelry Bonney" which clamps the Set
          trigger to its 180px cap), and gets clipped or has its
          shrinkable items (language pill, search) crushed at
          anything narrower. Below 1440 the same controls live in
          three persistent mobile rows below. See --breakpoint-nav
          in globals.css for the rationale. */}
      <div
        className="hidden nav:block"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div
          className="mx-auto flex items-center gap-2 px-4 overflow-visible"
          style={{ maxWidth: 1800, height: 40 }}
        >
          <CollectionPicker
            activeCollection={activeCollection}
            setActiveCollection={setActiveCollection}
            ctrl={ctrl}
          />

          {/* Set Filter · custom popover (not <select>) so the menu
              stays inside the page DOM and scrolls internally. The
              native <select> overlay on macOS Chrome is a platform
              popup that can extend past the page viewport up into
              the browser chrome / above the tabs - visually jarring
              and inconsistent with the Card type / Color popovers
              right next to it which already use this component. */}
          <FacetPopover
            placeholder="All Sets"
            ariaLabel="Filter by set"
            value={activeSet}
            onChange={setActiveSet}
            options={sets.map((s) => ({
              value: s.setCode,
              label: `${s.setCode} · ${s.setName}`,
            }))}
            ctrl={ctrl}
            ctrlActive={ctrlActive}
            menuMinWidth={220}
            // Cap height to ~12 rows. With 50+ sets the panel would
            // otherwise be ~1500px tall; this keeps it firmly inside
            // the page and lets the user scroll within the popover.
            menuMaxHeight={360}
            // Match the old native select's effective width budget
            // so the row layout doesn't shift when a long set name
            // is selected.
            triggerMaxWidth={180}
          />

          {/* Per-collection facet filters · Card type / Rarity / Color
              come from `COLLECTION_FACETS[activeCollection]` so each
              TCG sees its own curated vocabulary. Custom popovers
              (not native <select>) keep menus inside site styling -
              macOS Chrome's native dropdown overlay paints an opaque
              white panel that ignores dark mode and feels foreign next
              to the rest of the header. Mobile uses the same popovers
              in fluid mode for consistent toggle + attached-menu UX. */}
          <FacetPopover
            placeholder="All types"
            ariaLabel="Filter by card type"
            value={activeCardType}
            onChange={setActiveCardType}
            options={facets.cardTypes}
            ctrl={ctrl}
            ctrlActive={ctrlActive}
            menuMinWidth={150}
          />
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
          />
          <FacetPopover
            placeholder="All colors"
            ariaLabel="Filter by color"
            value={activeColor}
            onChange={setActiveColor}
            options={facets.colors}
            ctrl={ctrl}
            ctrlActive={ctrlActive}
            menuMinWidth={150}
          />
          {facets.subtypes && (
            <FacetPopover
              placeholder="All subtypes"
              ariaLabel="Filter by subtype / era"
              value={activeSubtype}
              onChange={setActiveSubtype}
              options={facets.subtypes}
              ctrl={ctrl}
              ctrlActive={ctrlActive}
              menuMinWidth={170}
              menuMaxHeight={320}
            />
          )}
          {artists.length > 0 && (
            <ArtistTypeahead
              value={activeArtist}
              onChange={setActiveArtist}
              artists={artists}
              ctrl={ctrl}
              ctrlActive={ctrlActive}
            />
          )}
          {showVariantToggles && (
            <>
              <button
                type="button"
                onClick={() => setOnlyAltArt(!onlyAltArt)}
                className="footer-btn shrink-0 inline-flex items-center whitespace-nowrap px-3 text-xs font-medium outline-none"
                style={{ ...(onlyAltArt ? ctrlActive : ctrl), height: 30 }}
                aria-pressed={onlyAltArt}
                aria-label={altArtAria}
                title={altArtTitle}
              >
                Alt art
              </button>
              <button
                type="button"
                onClick={() => setFlattenWall(!flattenWall)}
                className="footer-btn shrink-0 inline-flex items-center whitespace-nowrap px-3 text-xs font-medium outline-none"
                style={{ ...(flattenWall ? ctrlActive : ctrl), height: 30 }}
                aria-pressed={flattenWall}
                aria-label={flattenWall ? 'Flattened wall: each print is its own tile' : 'Flatten wall: show each alt art as its own tile'}
                title={flattenWall ? 'Each print is its own tile on the wall' : 'Break out every alt art as its own tile'}
              >
                Flatten
              </button>
            </>
          )}
          {isOnePiece && (
            <button
              type="button"
              onClick={() => setOnlyErrata(!onlyErrata)}
              className="footer-btn shrink-0 inline-flex items-center whitespace-nowrap px-3 text-xs font-medium outline-none"
              style={{ ...(onlyErrata ? ctrlActive : ctrl), height: 30 }}
              aria-pressed={onlyErrata}
              aria-label={onlyErrata ? 'Showing only cards with an official errata' : 'Show only cards with an official errata'}
              title={
                onlyErrata
                  ? 'Showing only cards whose text has been officially corrected by Bandai'
                  : 'Show only cards whose text has been officially corrected by Bandai (errata)'
              }
            >
              Errata
            </button>
          )}
          {hasPricing && (
            <button
              type="button"
              onClick={() => setShowTilePrices(!showTilePrices)}
              className="footer-btn shrink-0 inline-flex items-center whitespace-nowrap px-3 text-xs font-medium outline-none"
              style={{ ...(showTilePrices ? ctrlActive : ctrl), height: 30 }}
              aria-pressed={showTilePrices}
              aria-label={showTilePrices ? 'Hide market prices on tiles' : 'Show market prices on tiles'}
              title={
                showTilePrices
                  ? 'Hide market prices on tile thumbnails'
                  : isGundam
                    ? 'Overlay eBay active listing prices on each tile'
                    : 'Overlay TCGPlayer market price on each tile thumbnail'
              }
            >
              Prices
            </button>
          )}
          {isOnePiece && (
            <>
              {/* Language picker (desktop). Single-select pill group
                  with two options. EN | JP do two things in one
                  motion: (1) trim the wall to cards Bandai publishes
                  in that region, (2) swap every image URL to the
                  matching localized scan. CN was removed in v13 -
                  Bandai's TC/TW CDNs hot-link the JP file so the CN
                  pill shipped duplicate JP scans. See
                  samples/jp-cn-compare/. */}
              <div
                className="inline-flex items-center"
                style={{
                  ...ctrl,
                  height: 30,
                  padding: 2,
                  overflow: 'hidden',
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
                      className="inline-flex items-center justify-center gap-1 px-2.5 text-[11px] font-semibold outline-none"
                      style={{
                        height: 24,
                        borderRadius: 4,
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
            </>
          )}

          {/* Sort picker · same custom popover as the facet filters so it
              toggles closed on re-click, sits flush under the trigger, and
              highlights when a non-default sort is active (the old native
              select gave no hint that a sticky sort was applied). */}
          <FacetPopover
            placeholder="Sort: Default"
            ariaLabel="Sort cards"
            value={wallSort === 'default' ? null : wallSort}
            onChange={(v) => setWallSort((v ?? 'default') as typeof wallSort)}
            options={sortOptions}
            ctrl={ctrl}
            ctrlActive={ctrlActive}
            menuMinWidth={150}
          />

          {/* Search.
              Width sized to fit the entire placeholder at rest.
              "Name, code, or card text…" at text-xs (12px Inter) is
              ~150px of glyph run; with pl-3 (12px) + pr-7 (28px for
              the clear-button cap) the input needs ≥190px of outer
              width or the placeholder truncates to "Name, code, or
              card tex" - the bug screenshot that triggered this
              fix. w-56 (224px) leaves ~34px of breathing room so
              the ellipsis renders cleanly across Inter weight
              variations. Focus still expands by ~64px so users
              typing a longer query get more visible characters
              without the placeholder ever appearing truncated at
              rest. */}
          <div
            className="relative w-56 transition-[width] duration-300 focus-within:w-72"
            style={{ height: 30 }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              /* Placeholder hints at the card-text coverage so users
                 discover they can search rules text ("when attacking",
                 "blocker") instead of just names. If you reword this,
                 re-check the parent container's w-* class above -
                 the width was sized to this exact string. */
              placeholder="Name, code, or card text…"
              className="w-full h-full pl-3 pr-7 text-xs outline-none"
              style={{ ...(searchQuery.trim() ? ctrlActive : ctrl), height: 30 }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center"
                style={{
                  right: 6,
                  width: 16,
                  height: 16,
                  borderRadius: 999,
                  background: 'var(--text-primary)',
                  color: 'var(--bg)',
                  cursor: 'pointer',
                  border: 'none',
                  padding: 0,
                }}
              >
                <X size={10} strokeWidth={3} />
              </button>
            )}
          </div>

          {/* Spacer pushes the zoom widget to the right edge - keeps
              filters left-aligned (logical reading order) and the
              tactile zoom slider away from the click-heavy filter
              group so users don't bump it by mistake. */}
          <div className="flex-1" />

          {/* Zoom slider */}
          <div
            className="flex items-center gap-2 px-3"
            style={{ ...ctrl, height: 30 }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
            <input
              /* Max matches MAX_COLUMNS in card-grid so the rightmost
                 tick maps to the densest grid (≈30 columns). Widened
                 from 72→110px so the extra range still has enough
                 pixels per tick to grab. */
              type="range" min={1} max={29} step={1} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="zoom-slider" aria-label="Zoom level" style={{ width: 110 }}
            />
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
          </div>
        </div>
      </div>

      {/* ── Mobile nav menu · overlay dropdown ───────────────────────────
          Renders as a focused modal layer, NOT inline page flow. A
          backdrop dims + blurs everything below the brand row so the
          menu reads as a drop-down (the brand row stays crisp at z-60,
          above the backdrop). Closes on backdrop tap, the X, or Escape;
          body scroll is locked while open (see effect above). */}
      <AnimatePresence>
        {mobileOpen && (
          <motion.div
            key="mobile-nav-backdrop"
            className="nav:hidden fixed left-0 right-0 bottom-0"
            style={{
              top: 48,
              zIndex: 55,
              background: 'color-mix(in srgb, var(--bg) 30%, rgba(0,0,0,0.6))',
              backdropFilter: 'blur(3px)',
              WebkitBackdropFilter: 'blur(3px)',
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: HEADER_DROPDOWN_EASE }}
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {mobileOpen && (
        <motion.div
          key="mobile-nav-menu"
          id="mobile-nav-menu"
          role="menu"
          aria-label="Site menu"
          className="nav:hidden fixed left-0 right-0 px-4 pb-4 pt-3 flex flex-col gap-2.5 overflow-y-auto"
          style={{
            top: 48,
            zIndex: 56,
            maxHeight: 'calc(100dvh - 48px)',
            background: 'var(--bg-surface)',
            borderBottom: '1px solid var(--border-subtle)',
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
            boxShadow: 'var(--shadow-card)',
          }}
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.2, ease: HEADER_DROPDOWN_EASE }}
        >
          <select
            value={activeCollection}
            onChange={(e) => { setActiveCollection(e.target.value as typeof activeCollection); setMobileOpen(false) }}
            className="w-full px-3 py-2 text-sm outline-none cursor-pointer appearance-none font-medium"
            style={{ ...ctrl }}
            aria-label="Collection"
          >
            {COLLECTIONS.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.available}>
                {c.name}{!c.available ? ' (soon)' : ''}
              </option>
            ))}
          </select>

          {/* NOTE: The mobile sheet used to be the home for every
              filter on the page. We've since promoted them all to
              persistent rows directly under the brand row:
                row-2: Search + Set
                row-3: Card type + Rarity + Color + More
                row-4: Zoom slider
              So this sheet now only holds Collection (above) and the
              meta nav links (below). The trade-off is a taller fixed
              header on mobile, but every filter is one tap away with
              no sheet-open / sheet-close round-trip. */}

          <Link
            href="/tier-list"
            onClick={() => setMobileOpen(false)}
            className="footer-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ ...ctrl }}
            aria-label={tierPoolCount > 0 ? `Open tier list maker (${tierPoolCount} queued)` : 'Open tier list maker'}
          >
            <Layers size={16} strokeWidth={2.25} aria-hidden fill={tierPoolCount > 0 ? 'currentColor' : 'none'} />
            <span>Tier list maker</span>
            {tierPoolCount > 0 && (
              <span
                className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
              >
                {tierPoolCount}
              </span>
            )}
          </Link>

          <Link
            href="/sealed"
            onClick={() => setMobileOpen(false)}
            className="footer-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ ...ctrl }}
            aria-label="Booster box dashboard"
          >
            <Package size={16} strokeWidth={2.25} aria-hidden />
            <span>Booster boxes</span>
          </Link>

          <Link
            href="/chart-race"
            onClick={() => setMobileOpen(false)}
            className="footer-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ ...ctrl }}
            aria-label="Chart Race maker"
          >
            <LineChart size={16} strokeWidth={2.25} aria-hidden />
            <span>Chart Race maker</span>
          </Link>

          <Link
            href="/tournaments"
            onClick={() => setMobileOpen(false)}
            className={`footer-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium${tournamentLive ? ' tournament-live-breathe' : ''}`}
            style={{ ...ctrl }}
            aria-label={tournamentLive ? 'Tournaments (live now)' : 'Tournaments'}
          >
            <Trophy size={16} strokeWidth={2.25} aria-hidden />
            <span>Tournaments</span>
            {tournamentLive && <LivePill />}
          </Link>

          {/* How-it-works link · groups with Feedback so the two
              "meta" actions sit at the bottom of the mobile sheet,
              separated from the filter/action controls above. */}
          <Link
            href="/help"
            onClick={() => setMobileOpen(false)}
            className="footer-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ ...ctrl }}
            aria-label="How it works"
          >
            <HelpCircle size={14} strokeWidth={2.25} aria-hidden />
            <span>How it works</span>
          </Link>

          {/* Feedback link - give the X handle a visible home in mobile nav */}
          <a
            href="https://x.com/point_onefive"
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setMobileOpen(false)}
            className="footer-btn inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ ...ctrl }}
            aria-label="Feedback on X (@point_onefive)"
          >
            <svg width="12" height="12" viewBox="0 0 1200 1227" fill="currentColor" aria-hidden>
              <path d="M714.2 519.3 1160.9 0H1055L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9L515.5 750.2l327.3 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l305 436.2 47.5 67.9 395.9 566.3H892.4L569.2 687.8Z" />
            </svg>
            <span>Feedback (@point_onefive)</span>
          </a>
        </motion.div>
        )}
      </AnimatePresence>

      {/* Active-filter chip strip - visible whenever at least one filter
          is on. Lives in the fixed header (not the scrollable card wall)
          so the current filter state is always visible while browsing. */}
      {(activeSet || activeRarity || activeColor || activeCardType || activeSubtype || activeArtist || onlyAltArt || onlyErrata || flattenWall || searchQuery.trim()) && (
        <div
          className="flex flex-wrap items-center gap-1.5 px-4"
          style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 6, paddingBottom: 6 }}
        >
          <span
            className="text-[10px] tracking-[0.18em] uppercase mr-1 shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            Filters
          </span>
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
          <button
            type="button"
            onClick={() => {
              setActiveSet(null); setActiveRarity(null); setActiveColor(null)
              setActiveCardType(null); setActiveSubtype(null); setActiveArtist(null)
              setOnlyAltArt(false); setOnlyErrata(false); setFlattenWall(false)
              setSearchQuery('')
            }}
            className="ml-1 text-[10px] tracking-[0.14em] uppercase"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
          >
            Clear all
          </button>
        </div>
      )}
    </header>
  )
}
