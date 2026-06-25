'use client'

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  Copy,
  Eye,
  EyeOff,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Minus,
  MoreHorizontal,
  Plus,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react'
import { useStore } from '@/lib/store'
import { getCards } from '@/lib/data'
import { applyLanguageFilter } from '@/lib/card-filter'
import type { Card } from '@/lib/types'
import {
  DECK_GROUPS,
  deckMainCount,
  deckToText,
  groupDeckEntries,
  isLeaderType,
  maxCopiesFor,
  type Deck,
  type DeckEntry,
} from '@/lib/deck-types'
import { BrandLockup } from '@/components/gallery/brand-lockup'
import { SiteNavMenu } from '@/components/gallery/site-nav-menu'

const ctrlBase: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
}

/** One Piece (and friends) color names → accent hex for the tile rail. */
const COLOR_HEX: Record<string, string> = {
  Red: '#d2433a',
  Green: '#3a9d52',
  Blue: '#3a6fd2',
  Purple: '#8a4fd0',
  Black: '#555b66',
  Yellow: '#e0b020',
}

/**
 * Soft cap on saved decks per collection. Plain decks are tiny JSON, but
 * custom-card art is stored as downscaled data-URLs, so an unbounded pile
 * could eventually bump localStorage's ~5MB ceiling. 30 is far more than
 * any human juggles by hand while keeping us comfortably clear of quota.
 */
const MAX_DECKS_PER_COLLECTION = 30

/** Pixels of offset per faked card edge in a stack (see stackShadow). */
const STACK_OFFSET = 5

/**
 * Smallest tile we let a deck card shrink to before it stops reading as a
 * card. Kept low (like the wall) so high zoom can pack a whole deck into
 * view; the fit guard in deckColumns uses it as a ceiling.
 */
const MIN_TILE = 30

/**
 * Gutter between cards, shrinking as the grid densifies - exactly like the
 * wall's gapForColumns. A roomy seam at low zoom (where the stacked-card
 * shadow + quantity stepper hang into it) collapsing to a hairline at high
 * zoom so freed pixels go to card art instead of whitespace, which is also
 * what lets the column count climb on a narrow phone.
 */
function deckGap(cols: number): number {
  if (cols >= 10) return 4
  if (cols >= 8) return 6
  if (cols >= 6) return 9
  if (cols >= 4) return 13
  return 16
}

/**
 * Pick an integer column count from the zoom step and the *measured*
 * container width, mirroring the main wall's model: each scrubber notch is
 * one more column (`zoom + 1`), clamped to a per-breakpoint ceiling and to
 * whatever actually fits the width. The cards are then laid out in a
 * centered flex-wrap at a width derived from this count, so every notch is
 * a real, evenly-spaced size step and a full row always spans the
 * container edge-to-edge with identical left/right margins.
 */
function deckColumns(zoom: number, width: number): number {
  if (!width) return 4
  const narrow = width < 520
  // Phones top out lower than desktop, same as the wall's mobile cap, but
  // still far more than a couple of steps.
  const ceiling = narrow ? 10 : 14
  const desired = zoom + 1 // notch 1 -> 2 cols (biggest), notch 13 -> 14
  // Conservative fit check using the tightest gap so we never demand more
  // columns than physically fit.
  const maxFit = Math.max(2, Math.floor((width + 4) / (MIN_TILE + 4)))
  return Math.max(2, Math.min(desired, ceiling, maxFit))
}

const R2_HOSTNAME = 'pub-6d5072ccd26a467db70791436c203abb.r2.dev'

/**
 * Make any card image URL renderable in a plain `<img>`. Bandai's
 * cardlist CDN hotlink-protects direct cross-origin loads (the wall
 * normally goes through `next/image`), so for non-R2 remote URLs we
 * route through Next's image optimizer - same trick the tier-list page
 * uses. Data-URLs (custom proxies), R2 mirrors, and already-proxied
 * URLs pass through untouched. Width/quality are picked from the
 * allow-lists in next.config.js so the optimizer accepts the request.
 */
function toImgSrc(src: string): string {
  if (!src) return src
  if (src.startsWith('data:') || src.startsWith('blob:')) return src
  if (src.startsWith('/_next/image')) return src
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src
  try {
    if (new URL(src).hostname === R2_HOSTNAME) return src
  } catch {
    return src
  }
  return `/_next/image?url=${encodeURIComponent(src)}&w=384&q=75`
}

/**
 * Layered box-shadow that fakes a stack of cards behind the tile (a la
 * a solitaire pile). One extra "edge" per additional copy, capped at 3
 * so a 4-of doesn't sprawl. The shadow hangs into the grid gutter
 * (deckGap), and its per-edge offset scales with the card so it stays
 * clear of the next card at every zoom.
 *
 * Each edge is drawn as a card-coloured sliver (`--bg-surface`, lighter
 * than the charcoal page) plus a hairline, so the pile reads as actual
 * cards fanned behind the top one rather than a dark block.
 */
function stackShadow(qty: number, offset: number = STACK_OFFSET): string | undefined {
  const layers = Math.min(qty - 1, 3)
  if (layers <= 0) return undefined
  const parts: string[] = []
  for (let i = 1; i <= layers; i++) {
    const o = i * offset
    parts.push(`${o}px ${o}px 0 0 var(--bg-surface)`)
    parts.push(`${o}px ${o}px 0 1px color-mix(in srgb, var(--text-primary) 24%, transparent)`)
  }
  return parts.join(', ')
}

/**
 * Downscale a pasted/uploaded image to a card-sized data-URL. Data-URLs
 * (unlike blob:) survive a reload, so a saved deck's custom proxies keep
 * their art. Capping the longest edge at 420px keeps localStorage well
 * under quota even with a handful of proxies.
 */
function fileToCardDataUrl(file: File, maxEdge = 420): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('read failed'))
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('decode failed'))
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight))
        const w = Math.max(1, Math.round(img.naturalWidth * scale))
        const h = Math.max(1, Math.round(img.naturalHeight * scale))
        const canvas = document.createElement('canvas')
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          // No 2D context (rare) - fall back to the raw data-URL.
          resolve(String(reader.result))
          return
        }
        ctx.drawImage(img, 0, 0, w, h)
        try {
          resolve(canvas.toDataURL('image/webp', 0.85))
        } catch {
          resolve(canvas.toDataURL('image/png'))
        }
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Section header echoing the tier-list page's labelled regions: a small
 * brand-orange icon, a tracked-out uppercase wordmark, a tapering rule,
 * and an optional count chip on the right.
 */
function SectionLabel({
  label,
  count,
  accent = '#E85D2A',
}: {
  label: string
  count?: number
  accent?: string
}) {
  return (
    <div className="mb-2.5 flex items-center gap-x-3">
      <h2
        className="font-display"
        style={{
          fontSize: 12,
          fontWeight: 800,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-primary)',
        }}
      >
        {label}
      </h2>
      {typeof count === 'number' && (
        <span
          className="inline-flex items-center justify-center text-[11px] font-bold leading-none"
          style={{
            minWidth: 20,
            height: 18,
            padding: '0 6px',
            borderRadius: 999,
            background: 'color-mix(in srgb, ' + accent + ' 16%, transparent)',
            color: accent,
          }}
        >
          {count}
        </span>
      )}
      <div
        aria-hidden
        className="hidden flex-1 sm:block"
        style={{
          height: 1,
          minWidth: 24,
          background:
            'linear-gradient(to right, color-mix(in srgb, ' + accent + ' 45%, transparent), transparent)',
        }}
      />
    </div>
  )
}

/**
 * Signature card-density scrubber, shared visual language with the wall
 * and the tier-list page. Full-width on mobile, compact on desktop.
 */
function ZoomScrubber({
  value,
  onChange,
  max = 13,
}: {
  value: number
  onChange: (v: number) => void
  max?: number
}) {
  return (
    <div
      className="flex w-full items-center gap-3 px-3"
      style={{ ...ctrlBase, height: 38 }}
    >
      <span
        className="shrink-0 text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.12em' }}
      >
        Card size
      </span>
      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
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
        value={Math.min(value, max)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="zoom-slider flex-1"
        aria-label="Card size"
      />
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
        <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6" />
      </svg>
    </div>
  )
}

interface PrintOption {
  id: string
  src: string
  label: string
}

/** Base print + every variant for a gallery card, for the alt-art picker. */
function printOptionsFor(card: Card | undefined): PrintOption[] {
  if (!card) return []
  const base: PrintOption = {
    id: card.id,
    src: card.imageLarge || card.imageSmall,
    label: 'Base',
  }
  const variants = (card.variants ?? [])
    .filter((v) => !v.comingSoon)
    .map((v) => ({ id: v.id, src: v.imageUrl, label: v.label || v.id }))
  return [base, ...variants]
}

export function DeckBuilder() {
  return <DeckBuilderInner />
}

function DeckBuilderInner() {
  const formId = useId()
  const activeCollection = useStore((s) => s.activeCollection)
  const language = useStore((s) => s.language)
  const decks = useStore((s) => s.decks)
  const activeDeckId = useStore((s) => s.activeDeckId)
  const createDeck = useStore((s) => s.createDeck)
  const setActiveDeck = useStore((s) => s.setActiveDeck)

  // Bundle for the active collection, language-resolved so the alt-art
  // picker thumbnails match what the wall renders.
  const cards = useMemo(
    () => applyLanguageFilter(getCards(activeCollection), language),
    [activeCollection, language],
  )
  const cardById = useMemo(() => {
    const m = new Map<string, Card>()
    for (const c of cards) m.set(c.id, c)
    return m
  }, [cards])

  // Decks for the active collection only (board / pins are per-collection
  // too). A deck made while browsing One Piece never shows up under Pokémon.
  const collectionDecks = useMemo(
    () => decks.filter((d) => d.collection === activeCollection),
    [decks, activeCollection],
  )
  const activeDeck: Deck | undefined = useMemo(() => {
    const byId = collectionDecks.find((d) => d.id === activeDeckId)
    return byId ?? collectionDecks[0]
  }, [collectionDecks, activeDeckId])

  // Keep the store's activeDeckId pointing at a deck in this collection.
  useEffect(() => {
    if (collectionDecks.length === 0) return
    if (!collectionDecks.some((d) => d.id === activeDeckId)) {
      setActiveDeck(collectionDecks[0].id)
    }
  }, [collectionDecks, activeDeckId, setActiveDeck])

  // Default density depends on the device: a phone opens at ~3 columns
  // (comfortable card size) while desktop opens larger-per-row. Seeded
  // after mount to avoid an SSR/client hydration mismatch on the inline
  // tile widths.
  const [zoom, setZoom] = useState(5)
  useEffect(() => {
    if (typeof window !== 'undefined' && window.innerWidth < 520) setZoom(2)
  }, [])
  const [flatten, setFlatten] = useState(false)

  const atDeckCap = collectionDecks.length >= MAX_DECKS_PER_COLLECTION
  const isOnePiece = activeCollection === 'one-piece'

  return (
    <div
      className="relative min-h-screen pb-28"
      style={{
        background: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* Uniform site top bar - identical to every other page. */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex items-center justify-between gap-3 px-4" style={{ maxWidth: 1800, height: 56 }}>
          <BrandLockup />
          <SiteNavMenu topOffset={56} />
        </div>
      </header>

      {/* Centered page title under the nav. */}
      <div className="mx-auto flex items-center justify-center gap-2 px-4 pt-5" style={{ maxWidth: 1800 }}>
        <WalletCards size={20} strokeWidth={2.25} style={{ color: '#E85D2A', flexShrink: 0 }} aria-hidden />
        <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Deck builder</h1>
      </div>

      {/* Snarky lede + value pills, mirroring the tier-list page. */}
      <section aria-label="About this page" className="mx-auto max-w-3xl px-4 pt-3 pb-2 text-center">
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(10px, 3vw, 26px)',
            fontStyle: 'italic',
            fontWeight: 700,
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#E85D2A', fontWeight: 800, marginRight: 3 }}>&ldquo;</span>
          Cook it, Sleeve it, Run it
          <span style={{ color: '#E85D2A', fontWeight: 800, marginLeft: 3 }}>&rdquo;</span>
        </p>
        <p
          className="mt-3 flex flex-nowrap items-center justify-center"
          style={{
            fontSize: 'clamp(8.5px, 2.4vw, 11px)',
            letterSpacing: 'clamp(0.06em, 0.5vw, 0.18em)',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            gap: 'clamp(4px, 1.4vw, 12px)',
          }}
        >
          <span>Always free</span>
          <span aria-hidden style={{ opacity: 0.5 }}>·</span>
          <span>No signup</span>
          <span aria-hidden style={{ opacity: 0.5 }}>·</span>
          <span>Sim-ready export</span>
        </p>
      </section>

      <div className="mx-auto px-4 pt-5" style={{ maxWidth: 1200 }}>
        {/* Deck tabs - switch / create decks. Scrolls horizontally with
            touchable arrow buttons + drag, since the native scrollbar thumb
            isn't grabbable on touch. */}
        <DeckTabs
          decks={collectionDecks}
          activeId={activeDeck?.id}
          atDeckCap={atDeckCap}
          maxDecks={MAX_DECKS_PER_COLLECTION}
          onSelect={setActiveDeck}
          onCreate={() => createDeck()}
        />

        {activeDeck ? (
          <DeckSurface
            formId={formId}
            isOnePiece={isOnePiece}
            deck={activeDeck}
            cardById={cardById}
            zoom={zoom}
            onZoom={setZoom}
            flatten={flatten}
            onToggleFlatten={() => setFlatten((v) => !v)}
          />
        ) : (
          <NoDecks onCreate={() => createDeck()} />
        )}

        <p className="mt-10 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Your decks are saved on this device. They&rsquo;ll be here when you come back, as long as you use the same browser and keep your site data.
        </p>
      </div>
    </div>
  )
}

/**
 * Horizontally scrollable deck switcher. When the decks overflow the row we
 * surface touchable chevron buttons + edge fades and enable click-drag, so a
 * phone user has a real control to move left/right (the native scrollbar thumb
 * isn't grabbable on touch - the thing the user was tapping that "did nothing").
 * Native swipe still works; the scrollbar itself is hidden to avoid confusion.
 */
function DeckTabs({
  decks,
  activeId,
  atDeckCap,
  maxDecks,
  onSelect,
  onCreate,
}: {
  decks: Deck[]
  activeId: string | undefined
  atDeckCap: boolean
  maxDecks: number
  onSelect: (id: string) => void
  onCreate: () => void
}) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [overflowing, setOverflowing] = useState(false)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)
  const drag = useRef({ active: false, moved: false, startX: 0, startLeft: 0 })

  const update = useCallback(() => {
    const el = scrollRef.current
    if (!el) return
    setOverflowing(el.scrollWidth > el.clientWidth + 2)
    setCanLeft(el.scrollLeft > 2)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', update)
    }
  }, [update, decks.length])

  const nudge = (dir: 1 | -1) => {
    const el = scrollRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(150, el.clientWidth * 0.8), behavior: 'smooth' })
  }

  // Click-drag to pan (desktop nicety). A small threshold distinguishes a
  // drag from a tap; a real drag swallows the trailing click so it doesn't
  // also switch decks.
  const onPointerDown = (e: React.PointerEvent) => {
    const el = scrollRef.current
    if (!el) return
    drag.current = { active: true, moved: false, startX: e.clientX, startLeft: el.scrollLeft }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const el = scrollRef.current
    const d = drag.current
    if (!el || !d.active) return
    const dx = e.clientX - d.startX
    if (!d.moved && Math.abs(dx) < 5) return
    d.moved = true
    el.scrollLeft = d.startLeft - dx
    el.setPointerCapture?.(e.pointerId)
  }
  const endDrag = () => {
    drag.current.active = false
  }
  const onClickCapture = (e: React.MouseEvent) => {
    if (drag.current.moved) {
      e.preventDefault()
      e.stopPropagation()
      drag.current.moved = false
    }
  }

  // Inline arrow buttons sit *beside* the scroll area (flex siblings), so they
  // never float on top of a tab or read as a vertical blob. They share the tab
  // pills' surface/border so the row looks like one cohesive control. Both
  // slots render together (only while the row overflows) to keep the row width
  // stable; the inactive direction is simply dimmed and non-interactive.
  const arrow = (dir: 1 | -1, enabled: boolean) => (
    <button
      type="button"
      onClick={() => nudge(dir)}
      disabled={!enabled}
      aria-label={dir === -1 ? 'Scroll decks left' : 'Scroll decks right'}
      className="inline-flex shrink-0 items-center justify-center"
      style={{
        ...ctrlBase,
        width: 30,
        height: 32,
        padding: 0,
        opacity: enabled ? 1 : 0.3,
        cursor: enabled ? 'pointer' : 'default',
        pointerEvents: enabled ? 'auto' : 'none',
        color: 'var(--text-muted)',
      }}
    >
      {dir === -1 ? <ChevronLeft size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
    </button>
  )

  return (
    <div className="mb-4 flex items-center gap-1.5">
      {overflowing && arrow(-1, canLeft)}

      <div
        ref={scrollRef}
        role="tablist"
        aria-label="Saved decks"
        className="no-scrollbar flex min-w-0 flex-1 items-center gap-2 overflow-x-auto pt-1.5 pb-2"
        style={{ touchAction: 'pan-x', cursor: 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={onClickCapture}
      >
        {decks.map((d) => {
          const active = activeId === d.id
          const n = d.entries.reduce((s, e) => s + e.qty, 0)
          return (
            <button
              key={d.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(d.id)}
              className="footer-btn inline-flex shrink-0 items-center gap-2 px-3 text-xs font-semibold"
              style={{
                ...ctrlBase,
                height: 32,
                ...(active
                  ? {
                      borderColor: 'color-mix(in srgb, #E85D2A 55%, transparent)',
                      boxShadow: '0 0 0 1px color-mix(in srgb, #E85D2A 22%, transparent) inset',
                    }
                  : {}),
              }}
            >
              <span className="max-w-[160px] truncate">{d.name}</span>
              <span style={{ color: 'var(--text-muted)' }}>{n}</span>
            </button>
          )
        })}
        <button
          type="button"
          onClick={onCreate}
          disabled={atDeckCap}
          className="footer-btn inline-flex shrink-0 items-center gap-1.5 px-3 text-xs font-semibold"
          style={{ ...ctrlBase, height: 32, opacity: atDeckCap ? 0.45 : 1 }}
          aria-label="New deck"
          title={atDeckCap ? `You've reached ${maxDecks} decks for this game. Delete one to make room.` : 'Create a new empty deck'}
        >
          <Plus size={14} aria-hidden />
          New deck
        </button>
      </div>

      {overflowing && arrow(1, canRight)}
    </div>
  )
}

function NoDecks({ onCreate }: { onCreate: () => void }) {
  return (
    <div
      className="flex flex-col items-center justify-center gap-3 rounded-[10px] px-6 py-14 text-center"
      style={{
        border: '1.5px dashed color-mix(in srgb, var(--text-primary) 22%, transparent)',
        background: 'color-mix(in srgb, var(--bg-surface) 70%, transparent)',
      }}
    >
      <WalletCards size={30} strokeWidth={1.75} style={{ color: '#E85D2A', opacity: 0.8 }} aria-hidden />
      <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Start your first deck
      </p>
      <p className="max-w-md text-xs" style={{ color: 'var(--text-muted)' }}>
        Open any card on the wall and tap <strong>Deck</strong> to add it here, or create an empty deck and add cards as you go.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="footer-btn mt-1 inline-flex items-center gap-1.5 px-4 text-sm font-semibold"
        style={{ ...ctrlBase, height: 36 }}
      >
        <Plus size={15} aria-hidden />
        New deck
      </button>
    </div>
  )
}

interface DeckSurfaceProps {
  formId: string
  isOnePiece: boolean
  deck: Deck
  cardById: Map<string, Card>
  zoom: number
  onZoom: (v: number) => void
  flatten: boolean
  onToggleFlatten: () => void
}

function DeckSurface({ formId, isOnePiece, deck, cardById, zoom, onZoom, flatten, onToggleFlatten }: DeckSurfaceProps) {
  const renameDeck = useStore((s) => s.renameDeck)
  const deleteDeck = useStore((s) => s.deleteDeck)
  const duplicateDeck = useStore((s) => s.duplicateDeck)
  const clearDeck = useStore((s) => s.clearDeck)

  const [copied, setCopied] = useState(false)
  const [showList, setShowList] = useState(true)
  const [customOpen, setCustomOpen] = useState(false)
  const [artOpen, setArtOpen] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const copyTimer = useRef<number | null>(null)

  // Measure the live width of the card area so the column count (and thus
  // each card's width) is derived from the actual container, not a guess.
  // A callback ref re-attaches the observer whenever the grid mounts
  // (e.g. when the deck stops being empty).
  const [gridWidth, setGridWidth] = useState(0)
  const gridRoRef = useRef<ResizeObserver | null>(null)
  const gridRef = useCallback((el: HTMLDivElement | null) => {
    gridRoRef.current?.disconnect()
    if (!el) return
    const measure = () => setGridWidth(el.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    gridRoRef.current = ro
  }, [])
  const columns = deckColumns(zoom, gridWidth)
  const gap = deckGap(columns)
  // Cap the scrubber so its travel matches the column range this viewport
  // can actually show - no dead notches at the small end on a phone.
  const maxZoom = Math.max(2, deckColumns(99, gridWidth) - 1)
  // Fixed-width tiles in a centered flex-wrap so EVERY row - full or
  // partial - has identical left/right margins. The width is derived from
  // the measured container so a full row spans it edge-to-edge (centered,
  // so the margins are ~0 and equal), and a partial last row is centered
  // instead of dumping all its slack on the right (the lopsided gap the
  // user flagged). `columns` comes straight from the scrubber, so each
  // notch is an evenly-spaced, viewport-aware size step.
  const cardWidth = gridWidth > 0
    ? Math.floor((gridWidth - gap * (columns - 1)) / columns)
    : 150
  const gridStyle: React.CSSProperties = {
    display: 'flex',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap,
  }

  useEffect(() => {
    setConfirmClear(false)
    setConfirmDelete(false)
    setArtOpen(null)
    setMenuOpen(false)
    setCustomOpen(false)
  }, [deck.id])

  useEffect(() => () => {
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
  }, [])

  const groups = useMemo(() => groupDeckEntries(deck), [deck])
  const mainCount = deckMainCount(deck)
  const deckText = useMemo(() => deckToText(deck), [deck])
  const isEmpty = deck.entries.length === 0

  const leaderGroup = useMemo(() => groups.find((g) => g.key === 'LEADER'), [groups])
  const restGroups = useMemo(() => groups.filter((g) => g.key !== 'LEADER'), [groups])
  const restEntries = useMemo(() => restGroups.flatMap((g) => g.entries), [restGroups])

  // Running tally of the non-leader card types, shown as a lean table
  // inside the deck frame (replaces the old free-floating count pills).
  // The main types render as a fixed skeleton so the columns are stable
  // as you build; "Other" (custom proxies) only appears once used.
  const tally = useMemo(() => {
    const byKey = new Map(groups.map((g) => [g.key, g.count]))
    const cols = ['CHARACTER', 'EVENT', 'STAGE'].map((key) => ({
      key,
      label: DECK_GROUPS.find((d) => d.key === key)?.label ?? key,
      count: byKey.get(key) ?? 0,
    }))
    const other = byKey.get('CUSTOM') ?? 0
    if (other > 0) cols.push({ key: 'CUSTOM', label: 'Other', count: other })
    return cols
  }, [groups])

  const handleCopy = useCallback(async () => {
    if (!deckText) return
    const finish = () => {
      setCopied(true)
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current)
      copyTimer.current = window.setTimeout(() => setCopied(false), 1600)
    }
    try {
      await navigator.clipboard.writeText(deckText)
      finish()
    } catch {
      const ta = document.createElement('textarea')
      ta.value = deckText
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        finish()
      } finally {
        document.body.removeChild(ta)
      }
    }
  }, [deckText])

  const cornerCount = isOnePiece ? `${mainCount}/50` : `${mainCount}`

  // One tile, expanded into `qty` copies in flat view.
  const renderEntry = (entry: DeckEntry) => {
    const card = entry.kind === 'gallery' ? cardById.get(entry.cardId) : undefined
    if (flatten) {
      return Array.from({ length: entry.qty }).map((_, i) => (
        <DeckTile
          key={`${entry.uid}-${i}`}
          deckId={deck.id}
          entry={entry}
          card={card}
          width={cardWidth}
          flat
          artOpen={false}
          setArtOpen={setArtOpen}
        />
      ))
    }
    return (
      <DeckTile
        key={entry.uid}
        deckId={deck.id}
        entry={entry}
        card={card}
        width={cardWidth}
        artOpen={artOpen === entry.uid}
        setArtOpen={setArtOpen}
      />
    )
  }

  return (
    <>
      {/* Export bucket: three equal-width actions split across the full
          width, with the list visibility toggle (eye) centred between
          Copy and Duplicate so the row reads symmetrically. */}
      <div className="mb-2 flex items-stretch gap-2">
        <button
          type="button"
          onClick={handleCopy}
          disabled={isEmpty}
          className="footer-btn inline-flex flex-1 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
          style={{
            ...ctrlBase,
            height: 32,
            opacity: isEmpty ? 0.45 : 1,
            color: copied ? '#1f7a3f' : 'var(--text-primary)',
            borderColor: copied ? 'color-mix(in srgb, #1f7a3f 50%, var(--border-subtle))' : 'var(--border-subtle)',
          }}
          title="Copy a sim-ready list to your clipboard"
        >
          {copied ? <Check size={14} aria-hidden /> : <ClipboardCopy size={14} aria-hidden />}
          {copied ? 'Copied' : 'Copy list'}
        </button>
        <button
          type="button"
          onClick={() => setShowList((v) => !v)}
          disabled={isEmpty}
          className="footer-btn inline-flex shrink-0 items-center justify-center"
          style={{ ...ctrlBase, width: 40, height: 32, padding: 0, opacity: isEmpty ? 0.45 : 1 }}
          aria-pressed={showList}
          aria-label={showList ? 'Hide deck list' : 'Show deck list'}
          title={showList ? 'Hide deck list' : 'Show deck list'}
        >
          {showList ? <Eye size={16} aria-hidden /> : <EyeOff size={16} aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => duplicateDeck(deck.id)}
          disabled={isEmpty}
          className="footer-btn inline-flex flex-1 items-center justify-center gap-1.5 px-3 text-xs font-semibold"
          style={{ ...ctrlBase, height: 32, opacity: isEmpty ? 0.45 : 1 }}
          title="Save a copy of this deck"
        >
          <Copy size={14} aria-hidden />
          Duplicate
        </button>
      </div>

      {showList && !isEmpty && (
        <div className="mb-3">
          <textarea
            readOnly
            value={deckText}
            onFocus={(e) => e.currentTarget.select()}
            className="w-full font-mono text-xs"
            rows={Math.min(14, deck.entries.length + 2)}
            style={{ ...ctrlBase, padding: 10, lineHeight: 1.5, resize: 'vertical' }}
            aria-label="Deck list text"
          />
          <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            One <span className="font-mono">{'{qty}x{cardId}'}</span> line per card, leader first. Paste straight into OPTCGSim or any sim that imports by card id.
          </p>
        </div>
      )}

      {customOpen && (
        <CustomCardForm formId={formId} deckId={deck.id} onClose={() => setCustomOpen(false)} />
      )}

      {/* View controls: full-width flatten toggle, then the signature
          scrubber parked immediately above the deck frame it resizes. */}
      <div className="mb-2 flex">
        <button
          type="button"
          onClick={onToggleFlatten}
          className="footer-btn inline-flex w-full items-center justify-center gap-1.5 px-3 text-xs font-semibold"
          style={{ ...ctrlBase, height: 32 }}
          aria-pressed={flatten}
          title={flatten ? 'Currently flat - tap to stack duplicates' : 'Currently stacked - tap to spread every copy'}
        >
          <Layers size={14} aria-hidden />
          {flatten ? 'Stack duplicates' : 'Flatten'}
        </button>
      </div>
      <div className="mb-3">
        <ZoomScrubber value={zoom} onChange={onZoom} max={maxZoom} />
      </div>

      {/* Deck frame. Not clipped (overflow visible) so the deck menu can
          escape it. */}
      <div
        className="relative rounded-[12px] p-4 sm:p-5"
        style={{
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          background:
            'linear-gradient(180deg, color-mix(in srgb, var(--bg-surface) 97%, var(--bg)) 0%, color-mix(in srgb, var(--bg-surface) 92%, var(--bg)) 100%)',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute top-0"
          style={{
            left: 16,
            right: 16,
            height: 2,
            borderRadius: 2,
            background:
              'linear-gradient(90deg, transparent 0%, color-mix(in srgb, #E85D2A 75%, transparent) 30%, color-mix(in srgb, #E85D2A 75%, transparent) 70%, transparent 100%)',
            opacity: 0.85,
          }}
        />

        {/* Header: deck name + a single overflow menu nesting the rarely
            used deck actions (custom card, clear, delete). */}
        <div className="relative mb-4">
          <input
            type="text"
            value={deck.name}
            onChange={(e) => renameDeck(deck.id, e.target.value)}
            placeholder="Untitled deck"
            maxLength={60}
            aria-label="Deck name"
            className="block w-full bg-transparent text-center font-display font-extrabold tracking-tight outline-none"
            style={{
              color: 'var(--text-primary)',
              fontSize: 'clamp(18px, 3vw, 26px)',
              lineHeight: 1.15,
              letterSpacing: '-0.015em',
              padding: '0 40px',
              borderBottom: '1px solid transparent',
              paddingBottom: 4,
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderBottomColor = 'color-mix(in srgb, #E85D2A 55%, transparent)'
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderBottomColor = 'transparent'
            }}
          />
          <div className="absolute right-0 top-0">
            <button
              type="button"
              onClick={() => setMenuOpen((v) => !v)}
              className="footer-btn inline-flex items-center justify-center"
              style={{ ...ctrlBase, width: 32, height: 32, padding: 0 }}
              aria-label="Deck actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
            >
              <MoreHorizontal size={16} aria-hidden />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setMenuOpen(false)} aria-hidden />
                <div
                  role="menu"
                  aria-label="Deck actions"
                  className="absolute right-0 top-full z-50 mt-1 flex flex-col gap-0.5 p-1.5"
                  style={{
                    minWidth: 184,
                    borderRadius: 10,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface)',
                    boxShadow: 'var(--shadow-lightbox)',
                  }}
                >
                  <button
                    type="button"
                    role="menuitem"
                    className="db-menu-item"
                    onClick={() => { setCustomOpen(true); setMenuOpen(false) }}
                  >
                    <ImagePlus size={14} aria-hidden />
                    Add custom card
                  </button>
                  {!isEmpty && (
                    <button
                      type="button"
                      role="menuitem"
                      className="db-menu-item"
                      onClick={() => {
                        if (confirmClear) {
                          clearDeck(deck.id)
                          setConfirmClear(false)
                          setMenuOpen(false)
                        } else {
                          setConfirmClear(true)
                          setTimeout(() => setConfirmClear(false), 4000)
                        }
                      }}
                      style={confirmClear ? { color: '#dc2626' } : undefined}
                    >
                      <X size={14} aria-hidden />
                      {confirmClear ? 'Clear all cards?' : 'Clear deck'}
                    </button>
                  )}
                  <div aria-hidden style={{ height: 1, background: 'var(--border-subtle)', margin: '3px 4px' }} />
                  <button
                    type="button"
                    role="menuitem"
                    className="db-menu-item db-menu-item--danger"
                    onClick={() => {
                      if (confirmDelete) deleteDeck(deck.id)
                      else {
                        setConfirmDelete(true)
                        setTimeout(() => setConfirmDelete(false), 4000)
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden />
                    {confirmDelete ? 'Delete this deck?' : 'Delete deck'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>

        {isEmpty ? (
          <div className="py-10 text-center">
            <ImagePlus size={28} strokeWidth={1.75} aria-hidden style={{ color: '#E85D2A', opacity: 0.7, display: 'inline-block', marginBottom: 6 }} />
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>This deck is empty</p>
            <p className="mx-auto mt-1 max-w-md text-xs" style={{ color: 'var(--text-muted)' }}>
              Open a card on the wall and tap <strong>Deck</strong>, or use the <strong>&middot;&middot;&middot;</strong> menu to add a custom card.
            </p>
          </div>
        ) : (
          <>
            {/* Lean type tally - a running breakdown of the deck (leader
                excluded), nested between the name and the cards. */}
            <div
              className="mb-4 flex overflow-hidden rounded-lg"
              style={{ maxWidth: 440, border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg) 35%, transparent)' }}
            >
              {tally.map((c, i) => (
                <div
                  key={c.key}
                  className="flex flex-1 flex-col items-center justify-center gap-0.5 py-2"
                  style={i > 0 ? { borderLeft: '1px solid var(--border-subtle)' } : undefined}
                >
                  <span className="text-[15px] font-bold tabular-nums" style={{ color: 'var(--text-primary)', lineHeight: 1 }}>
                    {c.count}
                  </span>
                  <span className="text-[10px] font-semibold uppercase" style={{ letterSpacing: '0.08em', color: 'var(--text-muted)' }}>
                    {c.label}
                  </span>
                </div>
              ))}
            </div>

            <div ref={gridRef} className="flex flex-col gap-4">
              {leaderGroup && (
                <div style={gridStyle}>
                  {leaderGroup.entries.flatMap(renderEntry)}
                </div>
              )}
              {leaderGroup && restEntries.length > 0 && (
                <div aria-hidden style={{ height: 1, background: 'var(--border-subtle)', opacity: 0.65 }} />
              )}
              {restEntries.length > 0 && (
                <div style={gridStyle}>
                  {restEntries.flatMap(renderEntry)}
                </div>
              )}
            </div>

            {/* Subtle card count tucked into the corner (faded orange), in
                place of the old standalone pill. */}
            <div
              className="pointer-events-none absolute font-display tabular-nums"
              style={{
                right: 14,
                bottom: 10,
                fontSize: 12,
                fontWeight: 800,
                letterSpacing: '0.01em',
                color: 'color-mix(in srgb, #E85D2A 58%, transparent)',
              }}
            >
              {cornerCount}
            </div>
          </>
        )}

        {/* Branded footer stamp inside the frame, for parity with the
            tier-list board. */}
        <div aria-hidden className="pointer-events-none mt-6 flex items-center justify-center gap-2 opacity-30">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/images/site-logo.png" alt="" width={15} height={22} style={{ width: 15, height: 22, imageRendering: 'pixelated', display: 'block' }} />
          <span
            className="whitespace-nowrap"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 15, lineHeight: 1, letterSpacing: '-0.015em', textTransform: 'uppercase', color: 'var(--text-primary)' }}
          >
            <span aria-hidden style={{ fontSize: 10, fontWeight: 500, fontStyle: 'italic', textTransform: 'lowercase', opacity: 0.7, marginRight: 5 }}>the</span>
            Card Wall
          </span>
        </div>
      </div>
    </>
  )
}

interface DeckTileProps {
  deckId: string
  entry: DeckEntry
  card: Card | undefined
  width: number
  flat?: boolean
  artOpen: boolean
  setArtOpen: (uid: string | null) => void
}

function DeckTile({ deckId, entry, card, width, flat = false, artOpen, setArtOpen }: DeckTileProps) {
  const setDeckEntryQty = useStore((s) => s.setDeckEntryQty)
  const removeDeckEntry = useStore((s) => s.removeDeckEntry)
  const setDeckEntryPrint = useStore((s) => s.setDeckEntryPrint)

  const prints = useMemo(() => printOptionsFor(card), [card])
  const hasAlts = !flat && prints.length > 1
  const accent = entry.color ? (COLOR_HEX[entry.color] ?? null) : null
  const isLeader = isLeaderType(entry.cardType)
  const maxCopies = maxCopiesFor(entry)
  const atMax = entry.qty >= maxCopies

  // Offset scales with the card so the fanned pile stays clear of the
  // (also shrinking) grid gap at every zoom level.
  const stackOffset = Math.max(2, Math.min(STACK_OFFSET, Math.round(width / 30)))
  const innerShadow = accent ? `inset 3px 0 0 0 ${accent}` : undefined
  const stack = flat ? undefined : stackShadow(entry.qty, stackOffset)
  const boxShadow = [innerShadow, stack].filter(Boolean).join(', ') || undefined

  return (
    <div style={{ position: 'relative', width }}>
      <div
        className="group relative overflow-hidden"
        style={{
          width: '100%',
          aspectRatio: '5 / 7',
          borderRadius: 8,
          border: '1px solid var(--border-subtle)',
          background: 'var(--bg-surface)',
          boxShadow,
        }}
      >
        {entry.src ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={entry.kind === 'gallery' ? toImgSrc(entry.src) : entry.src}
            alt={entry.name}
            style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 p-2 text-center">
            <ImageIcon size={20} aria-hidden style={{ color: 'var(--text-muted)' }} />
            <span className="text-[10px] font-semibold leading-tight" style={{ color: 'var(--text-secondary)' }}>
              {entry.name}
            </span>
            {entry.cardId && (
              <span className="font-mono text-[9px]" style={{ color: 'var(--text-muted)' }}>{entry.cardId}</span>
            )}
          </div>
        )}

        {/* Remove / decrement (×) */}
        <button
          type="button"
          onClick={() => (flat ? setDeckEntryQty(deckId, entry.uid, entry.qty - 1) : removeDeckEntry(deckId, entry.uid))}
          className="absolute right-1 top-1 z-10 flex items-center justify-center rounded-full opacity-0 shadow-md transition group-hover:opacity-100"
          style={{ width: 20, height: 20, background: 'var(--text-primary)', color: 'var(--bg)', fontSize: 11, fontWeight: 700 }}
          aria-label={flat ? 'Remove one copy' : 'Remove from deck'}
        >
          ✕
        </button>

        {/* Alt-art toggle */}
        {hasAlts && (
          <button
            type="button"
            onClick={() => setArtOpen(artOpen ? null : entry.uid)}
            className="absolute left-1 top-1 z-10 flex items-center justify-center rounded opacity-0 shadow-md transition group-hover:opacity-100"
            style={{ width: 22, height: 20, background: 'color-mix(in srgb, var(--bg) 75%, transparent)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)' }}
            aria-label="Change art"
            title="Change art"
          >
            <ImageIcon size={12} aria-hidden />
          </button>
        )}

        {/* Card id chip (bottom-left), echoing the wall's index. */}
        {entry.cardId && (
          <span
            className="absolute bottom-1 left-1 z-10 rounded px-1 font-mono text-[9px] leading-none"
            style={{ padding: '2px 4px', background: 'color-mix(in srgb, var(--bg) 70%, transparent)', color: 'var(--text-secondary)' }}
          >
            {entry.cardId}
          </span>
        )}
      </div>

      {/* Quantity stepper (stacked mode only; leaders read as a single
          copy but can still be removed). */}
      {!flat && (
        <div
          className="absolute left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-1.5 py-0.5"
          style={{
            bottom: -9,
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <button
            type="button"
            onClick={() => setDeckEntryQty(deckId, entry.uid, entry.qty - 1)}
            className="flex items-center justify-center rounded-full"
            style={{ width: 18, height: 18, color: 'var(--text-primary)' }}
            aria-label="One fewer copy"
          >
            <Minus size={12} aria-hidden />
          </button>
          <span className="min-w-[14px] text-center text-xs font-bold tabular-nums" style={{ color: isLeader ? '#E85D2A' : 'var(--text-primary)' }}>
            {entry.qty}
          </span>
          <button
            type="button"
            onClick={() => setDeckEntryQty(deckId, entry.uid, entry.qty + 1)}
            disabled={atMax}
            className="flex items-center justify-center rounded-full"
            style={{ width: 18, height: 18, color: 'var(--text-primary)', opacity: atMax ? 0.3 : 1, cursor: atMax ? 'not-allowed' : 'pointer' }}
            aria-label="One more copy"
            title={atMax ? (isLeader ? 'A deck has one leader' : `Max ${maxCopies} copies of a card`) : 'One more copy'}
          >
            <Plus size={12} aria-hidden />
          </button>
        </div>
      )}

      {/* Alt-art popover */}
      {artOpen && hasAlts && (
        <>
          <div className="fixed inset-0" style={{ zIndex: 40 }} onClick={() => setArtOpen(null)} aria-hidden />
          <div
            role="dialog"
            aria-label="Choose art"
            className="absolute left-0 top-full z-50 mt-1 flex max-w-[280px] flex-wrap gap-1.5 p-2"
            style={{ ...ctrlBase, boxShadow: 'var(--shadow-lightbox)', width: 'max-content' }}
          >
            {prints.map((p) => {
              const selected = (entry.printId ?? entry.cardId) === p.id
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    setDeckEntryPrint(deckId, entry.uid, p.id, p.src)
                    setArtOpen(null)
                  }}
                  className="overflow-hidden rounded"
                  style={{
                    width: 46,
                    height: 64,
                    border: selected ? '2px solid #E85D2A' : '1px solid var(--border-subtle)',
                    padding: 0,
                  }}
                  title={p.label}
                  aria-label={`Use ${p.label}`}
                  aria-pressed={selected}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={toImgSrc(p.src)} alt={p.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

function CustomCardForm({ formId, deckId, onClose }: { formId: string; deckId: string; onClose: () => void }) {
  const addCustomCardToDeck = useStore((s) => s.addCustomCardToDeck)
  const [name, setName] = useState('')
  const [cardId, setCardId] = useState('')
  const [src, setSrc] = useState('')
  const [busy, setBusy] = useState(false)

  const inputStyle: React.CSSProperties = { ...ctrlBase, height: 34, padding: '0 10px', fontSize: 13 }

  const ingestFile = useCallback(async (file: File | null | undefined) => {
    if (!file || !file.type.startsWith('image/')) return
    setBusy(true)
    try {
      const dataUrl = await fileToCardDataUrl(file)
      setSrc(dataUrl)
    } catch {
      // Ignore decode failures - the user can paste a URL instead.
    } finally {
      setBusy(false)
    }
  }, [])

  const submit = () => {
    if (!name.trim() && !cardId.trim()) return
    addCustomCardToDeck(deckId, { name: name.trim(), cardId: cardId.trim(), src: src.trim() || undefined })
    setName('')
    setCardId('')
    setSrc('')
  }

  return (
    <div
      className="mb-4 p-4"
      style={{ ...ctrlBase, borderRadius: 8 }}
      onPaste={(e) => {
        const file = Array.from(e.clipboardData?.items ?? [])
          .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
          .map((i) => i.getAsFile())
          .find((f): f is File => Boolean(f))
        if (file) {
          e.preventDefault()
          void ingestFile(file)
        }
      }}
    >
      <SectionLabel label="Add a custom card" />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div
          className="flex shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden rounded text-center"
          style={{ width: 86, height: 120, border: '1px dashed var(--border-subtle)', background: 'var(--bg)' }}
        >
          {src ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          ) : (
            <>
              <ImagePlus size={34} strokeWidth={1.75} aria-hidden style={{ color: 'var(--text-muted)' }} />
              <span className="px-1 text-[10px] font-medium leading-tight" style={{ color: 'var(--text-muted)' }}>
                Paste or upload art
              </span>
            </>
          )}
        </div>
        <div className="flex flex-1 flex-col gap-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Card name (e.g. Monkey D. Luffy)"
            style={inputStyle}
            className="outline-none"
            aria-label="Custom card name"
          />
          <input
            type="text"
            value={cardId}
            onChange={(e) => setCardId(e.target.value)}
            placeholder="Card id for export (e.g. OP01-001) - optional"
            style={inputStyle}
            className="font-mono outline-none"
            aria-label="Custom card id"
          />
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={src.startsWith('data:') ? '' : src}
              onChange={(e) => setSrc(e.target.value)}
              placeholder="Paste image URL, or paste/upload an image"
              style={{ ...inputStyle, flex: 1, minWidth: 160 }}
              className="outline-none"
              aria-label="Custom card image URL"
              disabled={src.startsWith('data:')}
            />
            <label
              htmlFor={`${formId}-custom-file`}
              className="footer-btn inline-flex cursor-pointer items-center gap-1.5 px-3 text-xs font-semibold"
              style={{ ...ctrlBase, height: 34 }}
            >
              <ImagePlus size={14} aria-hidden />
              {busy ? 'Reading…' : 'Upload'}
              <input
                id={`${formId}-custom-file`}
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(e) => {
                  void ingestFile(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </label>
            {src && (
              <button
                type="button"
                onClick={() => setSrc('')}
                className="footer-btn inline-flex items-center px-2.5 text-xs font-semibold"
                style={{ ...ctrlBase, height: 34 }}
                aria-label="Clear image"
              >
                <X size={13} aria-hidden />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="footer-btn inline-flex items-center px-3 text-xs font-semibold"
          style={{ ...ctrlBase, height: 32 }}
        >
          Done
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={!name.trim() && !cardId.trim()}
          className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-semibold"
          style={{
            ...ctrlBase,
            height: 32,
            opacity: !name.trim() && !cardId.trim() ? 0.45 : 1,
            background: 'var(--text-primary)',
            color: 'var(--bg)',
            borderColor: 'var(--text-primary)',
          }}
        >
          <Plus size={14} aria-hidden />
          Add to deck
        </button>
      </div>
    </div>
  )
}
