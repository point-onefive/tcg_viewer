'use client'

import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import Link from 'next/link'
import { Bookmark, HelpCircle, Layers, Menu, X, Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '@/lib/store'
import { CardSet } from '@/lib/types'
import { COLLECTIONS } from '@/lib/store'

/**
 * One Piece-only filter facets. Card types and the canonical colour
 * wheel are concepts every TCG has, but the *values* differ per game
 * (Pokémon uses energy types, Digimon uses 6 different colours, etc).
 * Until we sit down and pick the right values for each TCG, these
 * controls are gated on `activeCollection === 'one-piece'`.
 *
 * `value` is the raw string the bundle stores (uppercase for cardType,
 * Title-case for colour), `label` is what we show in the option.
 */
const ONE_PIECE_CARD_TYPES = [
  { value: 'LEADER', label: 'Leader' },
  { value: 'CHARACTER', label: 'Character' },
  { value: 'EVENT', label: 'Event' },
  { value: 'STAGE', label: 'Stage' },
] as const

const ONE_PIECE_COLORS = [
  'Red',
  'Green',
  'Blue',
  'Purple',
  'Black',
  'Yellow',
] as const

// Swatch palette for the Color facet popover. Mirrors card-tile.tsx's
// COLOR_MAP so the chip beside each option matches the colour accent
// the card itself wears in the grid. Kept here (not imported from
// card-tile) so this component has no inverse dependency on a tile
// rendering concern.
const ONE_PIECE_COLOR_SWATCHES: Record<string, string> = {
  Red: '#ef4444',
  Blue: '#3b82f6',
  Green: '#22c55e',
  Purple: '#a855f7',
  Black: '#9ca3af',
  Yellow: '#eab308',
}

interface HeaderProps {
  sets: CardSet[]
}

type FacetOption = { value: string; label: string; swatch?: string }

/**
 * Custom popover dropdown for a single-select filter facet. Replaces
 * the native <select> for the in-app Card type / Colour pickers so the
 * options list inherits site styling (dark surface, rounded corners,
 * brand typography) instead of falling back to the OS-default menu - * which on macOS Chrome paints an opaque white panel that ignores
 * dark mode and feels foreign next to the rest of the header.
 *
 * The trigger + dismissal physics mirror the Collection picker above:
 *
 *   - Click trigger to toggle.
 *   - Outside mousedown OR Escape key closes (effect installed only
 *     while open, so we don't leak listeners).
 *   - AnimatePresence fades + slides 4px so the open/close motion
 *     matches the Collection picker exactly.
 *
 * `swatch` on an option draws a small filled circle to the left of
 * the label (used by the Colour facet) so the dropdown reads as a
 * palette, not a plain text list.
 */
function FacetPopover({
  placeholder,
  ariaLabel,
  value,
  onChange,
  options,
  ctrl,
  ctrlActive,
  menuMinWidth = 160,
}: {
  placeholder: string
  ariaLabel: string
  value: string | null
  onChange: (next: string | null) => void
  options: ReadonlyArray<FacetOption>
  ctrl: React.CSSProperties
  ctrlActive: React.CSSProperties
  menuMinWidth?: number
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const selectedOption = value ? options.find((o) => o.value === value) : null
  const triggerLabel = selectedOption?.label ?? placeholder
  const isActive = Boolean(value)

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        /* outline-none keeps focus indication consistent with the
           Collection picker beside it; keyboard users still get a
           visible focus ring via the global :focus-visible rule
           (selects/inputs) - buttons here use hover/active styling
           instead, matching the header's existing button language. */
        className="inline-flex items-center gap-1.5 px-3 text-xs font-medium outline-none whitespace-nowrap"
        style={{ ...(isActive ? ctrlActive : ctrl), height: 30 }}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
      >
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
        <span>{triggerLabel}</span>
        <ChevronDown
          size={12}
          strokeWidth={2.25}
          style={{
            transition: 'transform 180ms ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            color: 'var(--text-muted)',
          }}
        />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="listbox"
            aria-label={ariaLabel}
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 top-full mt-1.5 overflow-hidden"
            style={{
              transformOrigin: 'top left',
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-card)',
              zIndex: 60,
              padding: 4,
              minWidth: menuMinWidth,
            }}
          >
            {/* "Clear" row: null value, shown as a reset action.
                Sits above the real options so the popover reads as
                "[All] / Red / Green / …" the same way the trigger
                label shows the placeholder when no value is set. */}
            <FacetOptionRow
              label={placeholder}
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
          </motion.div>
        )}
      </AnimatePresence>
    </div>
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

export function Header({ sets }: HeaderProps) {
  const {
    searchQuery, setSearchQuery,
    activeSet, setActiveSet,
    activeColor, setActiveColor,
    activeCardType, setActiveCardType,
    onlyAltArt, setOnlyAltArt,
    activeCollection, setActiveCollection,
    zoom, setZoom,
    pinned, setBoardOpen,
    tierPool,
  } = useStore()

  // One Piece is the only collection with curated filter facets right
  // now (see ONE_PIECE_CARD_TYPES / ONE_PIECE_COLORS above). Gate the
  // new controls on this flag instead of repeating the comparison in
  // each render slot.
  const showOnePieceFacets = activeCollection === 'one-piece'
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const collectionRef = useRef<HTMLDivElement>(null)

  // Close collection dropdown on outside click / Escape
  useEffect(() => {
    if (!collectionOpen) return
    const onDown = (e: MouseEvent) => {
      if (collectionRef.current && !collectionRef.current.contains(e.target as Node)) {
        setCollectionOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCollectionOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [collectionOpen])

  const activeCollectionName = COLLECTIONS.find((c) => c.id === activeCollection)?.name ?? 'Collection'

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
  const ctrlActive: React.CSSProperties = {
    ...ctrl,
    borderColor: 'color-mix(in srgb, #E85D2A 55%, transparent)',
    boxShadow: '0 0 0 1px color-mix(in srgb, #E85D2A 22%, transparent) inset',
  }

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
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
        className="mx-auto flex items-center justify-between gap-6 px-4 md:px-4"
        style={{ maxWidth: 1800, height: 48 }}
      >
        {/* Brand cluster - lockup + small beta tag sit together on the left.
           The beta tag mirrors the italic lowercase "the" prefix inside the
           lockup, so it reads as a stylistic sibling rather than a separate
           UI chip. Kept tiny, no background, accent orange at low opacity. */}
        <div className="flex items-center gap-2">
        <a
          href="/"
          className="group inline-flex items-stretch overflow-hidden"
          aria-label="The Card Wall - home"
          style={{
            background: 'var(--text-primary)',
            color: 'var(--bg)',
            borderRadius: 6,
            height: 30,
            transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {/* Mascot chip - lighter panel that anchors him inside the mark */}
          <span
            className="inline-flex items-center justify-center"
            style={{
              background: 'var(--bg)',
              padding: '0 5px',
              border: '1px solid var(--text-primary)',
              borderRight: 'none',
              borderTopLeftRadius: 6,
              borderBottomLeftRadius: 6,
            }}
          >
            <img
              src="/images/site-logo.png"
              alt=""
              aria-hidden
              width={22}
              height={22}
              style={{
                height: 22,
                width: 'auto',
                imageRendering: 'pixelated',
                display: 'block',
                transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
              className="group-hover:scale-110 group-hover:-rotate-3"
            />
          </span>
          {/* Wordmark */}
          <span
            className="inline-flex items-center whitespace-nowrap"
            style={{
              padding: '0 11px',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 16,
              lineHeight: 1,
              letterSpacing: '-0.015em',
              textTransform: 'uppercase',
            }}
          >
            <span
              aria-hidden
              style={{
                fontSize: 11,
                fontWeight: 500,
                fontStyle: 'italic',
                letterSpacing: '0.02em',
                textTransform: 'lowercase',
                opacity: 0.65,
                marginRight: 5,
                lineHeight: 1,
              }}
            >
              the
            </span>
            <span>Card Wall</span>
          </span>
        </a>
          <span
            aria-label="Beta release"
            title="Beta release"
            className="inline-flex select-none"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 10,
              fontStyle: 'italic',
              fontWeight: 700,
              letterSpacing: '0.18em',
              textTransform: 'lowercase',
              color: '#E85D2A',
              opacity: 0.78,
              lineHeight: 1,
              // Tiny optical lift so the italic descender sits on the
              // same baseline as the wordmark inside the lockup.
              transform: 'translateY(1px)',
            }}
          >
            beta
          </span>
        </div>

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
        <div className="hidden lg:flex items-center gap-2">
          {/* How-it-works · compact ? icon pointing to /help, which
              replaced the deprecated first-visit guided tour. */}
          <Link
            href="/help"
            className="inline-flex items-center justify-center"
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
            className="inline-flex items-center justify-center"
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
            className="inline-flex items-center gap-1.5 px-3 text-xs font-medium"
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

          {/* Board trigger · last in the cluster so its variable-
              width count badge grows away from siblings, never into
              them. */}
          <button
            className="inline-flex items-center gap-1.5 px-3 text-xs font-medium"
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

        {/* ── Mobile right cluster ── */}
        <div className="flex lg:hidden items-center gap-2">
          {/* Board icon - only if pins exist */}
          {pinnedCount > 0 && (
            <button
              className="relative inline-flex items-center justify-center"
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
            className="relative inline-flex items-center justify-center"
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

          {/* Hamburger */}
          <button
            className="inline-flex items-center justify-center"
            style={{ ...ctrl, width: 32, height: 32 }}
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={15} /> : <Menu size={15} />}
          </button>
        </div>
      </div>

      {/* ── Desktop row-2 filter cluster · lg+ only ───────────────
          All the gallery-narrowing controls live here so the brand
          row stays uncluttered. Subtle top border separates it from
          row 1 as a visual sub-toolbar without adding background
          weight. */}
      <div
        className="hidden lg:block"
        style={{ borderTop: '1px solid var(--border-subtle)' }}
      >
        <div
          className="mx-auto flex items-center gap-2 px-4"
          style={{ maxWidth: 1800, height: 40 }}
        >
          {/* Collection Filter (custom popover so menu stays inside the site) */}
          <div ref={collectionRef} className="relative">
            <button
              type="button"
              onClick={() => setCollectionOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 text-xs font-medium"
              style={{ ...ctrl, height: 30 }}
              aria-haspopup="listbox"
              aria-expanded={collectionOpen}
              aria-label="Collection"
            >
              <span>{activeCollectionName}</span>
              <ChevronDown
                size={12}
                strokeWidth={2.25}
                style={{
                  transition: 'transform 180ms ease',
                  transform: collectionOpen ? 'rotate(180deg)' : 'rotate(0)',
                  color: 'var(--text-muted)',
                }}
              />
            </button>

            <AnimatePresence>
              {collectionOpen && (
                <motion.div
                  role="listbox"
                  aria-label="Collection"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute left-0 top-full mt-1.5 min-w-[200px] overflow-hidden"
                  style={{
                    transformOrigin: 'top left',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow-card)',
                    zIndex: 60,
                    padding: 4,
                  }}
                >
                  {COLLECTIONS.map((c) => {
                    const selected = c.id === activeCollection
                    const disabled = !c.available
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return
                          setActiveCollection(c.id)
                          setCollectionOpen(false)
                        }}
                        className="w-full flex items-center gap-2 px-2.5 text-xs font-medium text-left transition-colors whitespace-nowrap"
                        style={{
                          height: 30,
                          borderRadius: 5,
                          background: selected ? 'var(--text-primary)' : 'transparent',
                          color: selected
                            ? 'var(--bg)'
                            : disabled
                            ? 'var(--text-muted)'
                            : 'var(--text-primary)',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.55 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!selected && !disabled) {
                            e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 8%, transparent)'
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
                        <span className="flex-1">{c.name}</span>
                        {disabled && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                            soon
                          </span>
                        )}
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Set Filter */}
          <select
            value={activeSet || ''}
            onChange={(e) => setActiveSet(e.target.value || null)}
            className="px-3 py-1.5 text-xs outline-none cursor-pointer appearance-none max-w-[150px]"
            style={{ ...(activeSet ? ctrlActive : ctrl), height: 30 }}
          >
            <option value="">All Sets</option>
            {sets.map((s) => (
              <option key={s.setCode} value={s.setCode}>
                {s.setCode} · {s.setName}
              </option>
            ))}
          </select>

          {/* One Piece-only facet filters · live inline alongside the
              other narrowing controls so the user sees every available
              dimension at a glance instead of opening a popover. Each
              spreads `ctrlActive` when holding a value so the active
              state is visible without scanning the chip strip below. */}
          {showOnePieceFacets && (
            <>
              {/* Custom popovers (not native <select>) so the menu
                  inherits site styling. The native dropdown overlay
                  on macOS Chrome paints an opaque white panel that
                  ignores dark mode and feels foreign next to the
                  rest of the header. Mobile keeps native selects - those bring up the OS picker which is genuinely
                  better tuned for touch. */}
              <FacetPopover
                placeholder="All types"
                ariaLabel="Filter by card type"
                value={activeCardType}
                onChange={setActiveCardType}
                options={ONE_PIECE_CARD_TYPES}
                ctrl={ctrl}
                ctrlActive={ctrlActive}
                menuMinWidth={140}
              />
              <FacetPopover
                placeholder="All colors"
                ariaLabel="Filter by color"
                value={activeColor}
                onChange={setActiveColor}
                options={ONE_PIECE_COLORS.map((c) => ({
                  value: c,
                  label: c,
                  swatch: ONE_PIECE_COLOR_SWATCHES[c],
                }))}
                ctrl={ctrl}
                ctrlActive={ctrlActive}
                menuMinWidth={140}
              />
              <button
                type="button"
                onClick={() => setOnlyAltArt(!onlyAltArt)}
                /* outline-none mirrors the sibling selects so this
                   button doesn't show Chromium's after-click focus
                   ring (which slipped through as a bright white box
                   while the selects suppressed it). Keyboard focus
                   is still indicated via the globals.css :focus-visible
                   rule, which targets inputs/selects/textareas; for
                   buttons we rely on hover/pressed state instead, in
                   line with the existing focus-styling comment in
                   globals.css. */
                className="inline-flex items-center px-3 text-xs font-medium outline-none"
                style={{ ...(onlyAltArt ? ctrlActive : ctrl), height: 30 }}
                aria-pressed={onlyAltArt}
                aria-label={onlyAltArt ? 'Showing only cards with alt art' : 'Show only cards with alt art'}
                title="Show only cards with alt art"
              >
                Alt art
              </button>
            </>
          )}

          {/* Search */}
          <div
            className="relative w-44 transition-[width] duration-300 focus-within:w-64"
            style={{ height: 30 }}
          >
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cards…"
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

      {/* ── Mobile filter sheet ── */}
      {mobileOpen && (
        <div
          className="lg:hidden px-4 pb-4 pt-2 flex flex-col gap-3"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg) 96%, transparent)' }}
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

          <select
            value={activeSet || ''}
            onChange={(e) => { setActiveSet(e.target.value || null); setMobileOpen(false) }}
            className="w-full px-3 py-2 text-sm outline-none cursor-pointer appearance-none"
            style={{ ...(activeSet ? ctrlActive : ctrl) }}
          >
            <option value="">All Sets</option>
            {sets.map((s) => (
              <option key={s.setCode} value={s.setCode}>
                {s.setCode} · {s.setName}
              </option>
            ))}
          </select>

          {/* One Piece-only facets in the mobile sheet. Sit between
              Set and Search just like in the desktop nav so muscle
              memory carries over. Mobile selects don't close the
              sheet - the user often wants to combine facets, and
              closing per-change would force them to re-open it. */}
          {showOnePieceFacets && (
            <>
              <select
                value={activeCardType || ''}
                onChange={(e) => setActiveCardType(e.target.value || null)}
                className="w-full px-3 py-2 text-sm outline-none cursor-pointer appearance-none"
                style={{ ...(activeCardType ? ctrlActive : ctrl) }}
                aria-label="Filter by card type"
              >
                <option value="">All types</option>
                {ONE_PIECE_CARD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <select
                value={activeColor || ''}
                onChange={(e) => setActiveColor(e.target.value || null)}
                className="w-full px-3 py-2 text-sm outline-none cursor-pointer appearance-none"
                style={{ ...(activeColor ? ctrlActive : ctrl) }}
                aria-label="Filter by color"
              >
                <option value="">All colors</option>
                {ONE_PIECE_COLORS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setOnlyAltArt(!onlyAltArt)}
                /* outline-none matches the sibling selects (see the
                   desktop alt-art button for the long version). */
                className="inline-flex items-center justify-center px-3 py-2 text-sm font-medium outline-none"
                style={{ ...(onlyAltArt ? ctrlActive : ctrl) }}
                aria-pressed={onlyAltArt}
              >
                Only cards with alt art
              </button>
            </>
          )}

          <div className="relative w-full">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search cards…"
              className="w-full pl-3 pr-9 py-2 text-sm outline-none"
              style={{ ...(searchQuery.trim() ? ctrlActive : ctrl) }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear search"
                className="absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center"
                style={{
                  right: 8,
                  width: 20,
                  height: 20,
                  borderRadius: 999,
                  background: 'var(--text-primary)',
                  color: 'var(--bg)',
                  cursor: 'pointer',
                  border: 'none',
                  padding: 0,
                }}
              >
                <X size={12} strokeWidth={3} />
              </button>
            )}
          </div>

          {/* Zoom row · matches desktop icon language */}
          <div className="flex items-center gap-2 px-3 py-2" style={{ ...ctrl }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
            <input
              /* Matches the desktop slider's range so mobile users
                 get the same "as tiny as it gets" zoom-out. */
              type="range" min={1} max={29} step={1} value={zoom}
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

          <Link
            href="/tier-list"
            onClick={() => setMobileOpen(false)}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
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

          {/* How-it-works link · groups with Feedback so the two
              "meta" actions sit at the bottom of the mobile sheet,
              separated from the filter/action controls above. */}
          <Link
            href="/help"
            onClick={() => setMobileOpen(false)}
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
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
            className="inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium"
            style={{ ...ctrl }}
            aria-label="Feedback on X (@point_onefive)"
          >
            <svg width="12" height="12" viewBox="0 0 1200 1227" fill="currentColor" aria-hidden>
              <path d="M714.2 519.3 1160.9 0H1055L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9L515.5 750.2l327.3 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l305 436.2 47.5 67.9 395.9 566.3H892.4L569.2 687.8Z" />
            </svg>
            <span>Feedback (@point_onefive)</span>
          </a>
        </div>
      )}
    </header>
  )
}
