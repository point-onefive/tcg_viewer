'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, X } from 'lucide-react'
import { Card, CardSet } from '@/lib/types'
import { useStore, COLLECTIONS } from '@/lib/store'
import { CardTile } from './card-tile'

const GAP = 14

interface CardGridProps {
  cards: Card[]
  sets: CardSet[]
}

const CARD_RATIO = 7 / 5 // height / width
const HEADER_H = 48    // px reserved for fixed header

// Minimum columns so that 1 full card fits within the viewport height
function minColumnsForViewport(windowWidth: number, windowHeight: number): number {
  const usableHeight = windowHeight - HEADER_H - GAP
  const containerWidth = Math.min(windowWidth, 1800) - 32
  // cardWidth = containerWidth / cols, cardHeight = cardWidth * CARD_RATIO
  // We need cardHeight <= usableHeight
  // => cols >= containerWidth * CARD_RATIO / usableHeight
  const minCols = Math.ceil((containerWidth * CARD_RATIO) / usableHeight)
  return Math.max(minCols, 1)
}

// zoom 1 = fewest cols (biggest cards), zoom 12 = most cols (tiny cards)
function zoomToColumns(zoom: number, windowWidth: number, windowHeight: number) {
  const desired = zoom + 1 // zoom 1 → 2, zoom 12 → 13 (capped below)
  const capped = Math.min(desired, 12)
  const floor = minColumnsForViewport(windowWidth, windowHeight)
  return Math.max(capped, floor)
}

export function CardGrid({ cards, sets }: CardGridProps) {
  const {
    searchQuery, setSearchQuery,
    activeSet, setActiveSet,
    activeRarity, setActiveRarity,
    activeColor, setActiveColor,
    activeCollection,
    zoom,
  } = useStore()
  const collectionName = COLLECTIONS.find((c) => c.id === activeCollection)?.name ?? 'Collection'
  const [mounted, setMounted] = useState(false)
  const [windowWidth, setWindowWidth] = useState(1200)
  const [windowHeight, setWindowHeight] = useState(800)
  // Collapsed set codes — lets users hide sections to skip long scrolls.
  // Reset when collection changes so stale codes don't linger.
  //
  // Default behaviour: open the FIRST set in the collection, collapse the
  // rest. Otherwise landing on One Piece would mount ~2,500 rows worth of
  // virtual estimates and immediately request ~90 card images. This way
  // the user sees one fully-rendered set on arrival and progressively
  // expands more as they explore — cuts initial layout & network burst.
  const [collapsedSets, setCollapsedSets] = useState<Set<string>>(() => new Set())
  // Sets the user has explicitly toggled (open OR closed) at least once.
  // Auto-expand-on-scroll respects this so we never undo an intentional
  // collapse. Cleared on collection change.
  const [userToggledSets, setUserToggledSets] = useState<Set<string>>(() => new Set())
  // We track which collection we last initialised so reactive resets fire
  // exactly once per collection switch without depending on `sets` (which
  // would re-run on every prop identity change).
  const lastInitCollectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (lastInitCollectionRef.current === activeCollection) return
    lastInitCollectionRef.current = activeCollection
    setUserToggledSets(new Set())
    if (sets.length <= 1) {
      setCollapsedSets(new Set())
      return
    }
    const collapsed = new Set<string>()
    for (let i = 1; i < sets.length; i++) collapsed.add(sets[i].setCode)
    setCollapsedSets(collapsed)
  }, [activeCollection, sets])
  const toggleSet = useCallback((setCode: string) => {
    setUserToggledSets((prev) => {
      if (prev.has(setCode)) return prev
      const next = new Set(prev)
      next.add(setCode)
      return next
    })
    setCollapsedSets((prev) => {
      const next = new Set(prev)
      if (next.has(setCode)) next.delete(setCode)
      else next.add(setCode)
      return next
    })
  }, [])
  // Auto-expand triggered by scroll proximity. Skips sets the user has
  // explicitly touched so an intentional collapse stays collapsed even
  // when they scroll back over it.
  const autoExpandSet = useCallback((setCode: string) => {
    if (userToggledSets.has(setCode)) return
    setCollapsedSets((prev) => {
      if (!prev.has(setCode)) return prev
      const next = new Set(prev)
      next.delete(setCode)
      return next
    })
  }, [userToggledSets])

  useEffect(() => {
    setMounted(true)
    setWindowWidth(window.innerWidth)
    setWindowHeight(window.innerHeight)
    const onResize = () => {
      setWindowWidth(window.innerWidth)
      setWindowHeight(window.innerHeight)
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // Pinch-to-zoom: two-finger gesture maps to the same 1–12 zoom scale used
  // by the slider. We listen on `document` (not the grid div) because iOS
  // routes multi-touch events to the element where the first finger landed,
  // which is usually a child tile. We also support iOS Safari's proprietary
  // `gesturestart/gesturechange` events so native page zoom doesn't win.
  //
  // Guards against false triggers during normal scroll:
  //  - Require actual 2 touches throughout touchmove (Android).
  //  - Ignore near-1.0 scale (deadzone) so momentum/palm noise is rejected.
  //  - Only arm after user crosses a clear distance threshold.
  useEffect(() => {
    let startDist = 0
    let startZoom = 5
    let active = false
    let armed = false // flips true once scale has moved past the deadzone

    const DEADZONE_LOG2 = 0.12 // ~8.6% scale change required before we act

    const applyScale = (scale: number) => {
      if (!Number.isFinite(scale) || scale <= 0) return
      const log = Math.log2(scale)
      if (!armed && Math.abs(log) < DEADZONE_LOG2) return
      armed = true
      // Pinch out (scale > 1) grows cards → fewer columns → lower zoom index.
      const delta = -Math.round(log * 6)
      const next = Math.max(1, Math.min(12, startZoom + delta))
      if (next !== useStore.getState().zoom) {
        useStore.getState().setZoom(next)
      }
    }

    const reset = () => {
      active = false
      armed = false
      startDist = 0
    }

    // ── Touch events (Android / modern iOS) ──
    //
    // We MUST be careful about how `touchmove` is attached. A non-passive
    // `touchmove` listener on `document` forces the browser to wait for
    // our JS handler before scrolling can begin — even for single-finger
    // pans we never want to intercept. That's a major mobile scroll-jank
    // source. So the strategy is:
    //   1. Always listen for `touchstart` passively (cheap).
    //   2. Only attach the non-passive `touchmove` listener AFTER a
    //      2-finger touchstart, and remove it as soon as the gesture ends.
    //   Single-finger scroll never sees a JS handler on its hot path.
    const onTouchMove = (e: TouchEvent) => {
      if (!active) return
      if (e.touches.length !== 2 || startDist <= 0) {
        reset()
        document.removeEventListener('touchmove', onTouchMove)
        return
      }
      e.preventDefault()
      const dx = e.touches[0].clientX - e.touches[1].clientX
      const dy = e.touches[0].clientY - e.touches[1].clientY
      const dist = Math.hypot(dx, dy)
      applyScale(dist / startDist)
    }
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        startDist = Math.hypot(dx, dy)
        startZoom = useStore.getState().zoom
        active = true
        armed = false
        document.addEventListener('touchmove', onTouchMove, { passive: false })
      } else {
        // Any touch count other than 2 tears the gesture down so a stray
        // second touch during a scroll can't zoom.
        reset()
        document.removeEventListener('touchmove', onTouchMove)
      }
    }
    const onTouchEnd = () => {
      reset()
      document.removeEventListener('touchmove', onTouchMove)
    }

    // ── iOS Safari gesture events (non-standard, but required to suppress
    //    the native page pinch-zoom even with user-scalable=no in some cases).
    //    Only arm on explicit multi-touch start so single-finger scroll
    //    momentum can't flip us on. ──
    type GestureEvt = Event & { scale: number }
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      startZoom = useStore.getState().zoom
      active = true
      armed = false
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      if (!active) return
      applyScale((e as GestureEvt).scale)
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      reset()
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchEnd, { passive: true })
    document.addEventListener('gesturestart', onGestureStart as EventListener)
    document.addEventListener('gesturechange', onGestureChange as EventListener)
    document.addEventListener('gestureend', onGestureEnd as EventListener)
    return () => {
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      document.removeEventListener('gesturestart', onGestureStart as EventListener)
      document.removeEventListener('gesturechange', onGestureChange as EventListener)
      document.removeEventListener('gestureend', onGestureEnd as EventListener)
    }
  }, [])

  const columns = zoomToColumns(zoom, windowWidth, windowHeight)

  const filtered = useMemo(() => {
    let result = cards
    if (activeSet) result = result.filter((c) => c.setCode === activeSet)
    if (activeRarity) result = result.filter((c) => c.rarity === activeRarity)
    if (activeColor) result = result.filter((c) => c.colors?.includes(activeColor))
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim()
      result = result.filter(
        (c) =>
          c.name.toLowerCase().includes(q) ||
          c.code.toLowerCase().includes(q) ||
          c.setName.toLowerCase().includes(q)
      )
    }
    return result
  }, [cards, activeSet, activeRarity, activeColor, searchQuery])

  // Card counts per set (from filtered results) — shown in collapsed headers.
  const setCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const c of filtered) counts.set(c.setCode, (counts.get(c.setCode) ?? 0) + 1)
    return counts
  }, [filtered])

  const visibleSetCodes = useMemo(() => Array.from(setCounts.keys()), [setCounts])
  const allCollapsed =
    visibleSetCodes.length > 0 && visibleSetCodes.every((s) => collapsedSets.has(s))

  const { rows, rowMeta, firstCardRowIndex } = useMemo(() => {
    const rows: (Card[] | CardSet)[] = []
    const rowMeta: ('cards' | 'header')[] = []
    let currentSet = ''
    let currentCollapsed = false
    let firstCardRowIndex = -1

    for (const card of filtered) {
      if (card.setCode !== currentSet) {
        currentSet = card.setCode
        currentCollapsed = collapsedSets.has(currentSet)
        const set = sets.find((s) => s.setCode === currentSet)
        if (set) {
          rows.push(set)
          rowMeta.push('header')
        }
      }
      if (currentCollapsed) continue
      const lastRow = rows[rows.length - 1]
      if (rowMeta[rowMeta.length - 1] === 'cards' && Array.isArray(lastRow) && lastRow.length < columns) {
        lastRow.push(card)
      } else {
        rows.push([card])
        rowMeta.push('cards')
        if (firstCardRowIndex === -1) firstCardRowIndex = rows.length - 1
      }
    }

    return { rows, rowMeta, firstCardRowIndex }
  }, [filtered, columns, sets, collapsedSets])

  const estimateSize = useCallback(
    (index: number) => {
      if (rowMeta[index] === 'header') return 44
      const padding = 32
      const containerWidth = Math.min(window.innerWidth, 1800) - padding
      const cardWidth = (containerWidth - GAP * (columns - 1)) / columns
      return Math.round(cardWidth * (7 / 5)) + GAP
    },
    [columns, rowMeta]
  )

  const virtualizer = useWindowVirtualizer({
    count: mounted ? rows.length : 0,
    estimateSize,
    // Was 12 — that mounted ~72 extra CardTile components on each side of
    // the viewport. Each tile costs subscriptions, animations, and an
    // image request, so 4 is plenty (≈2 rows of preload).
    overscan: 4,
    scrollMargin: 48,
  })

  if (!mounted) {
    return <div style={{ minHeight: '100vh' }} />
  }

  if (filtered.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-sm tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
          No cards found
        </p>
        <button
          type="button"
          onClick={() => {
            setActiveSet(null)
            setActiveRarity(null)
            setActiveColor(null)
            setSearchQuery('')
          }}
          className="px-3 py-1.5 text-xs font-medium"
          style={{
            background: 'color-mix(in srgb, #E85D2A 14%, transparent)',
            color: '#E85D2A',
            border: '1px solid color-mix(in srgb, #E85D2A 45%, transparent)',
            borderRadius: 6,
          }}
        >
          Clear filters
        </button>
      </div>
    )
  }

  return (
    <div className="mx-auto px-4 md:px-4" style={{ maxWidth: 1800 }}>
      {/* Fixed 48px header spacer */}
      <div style={{ height: 48 }} />

      {/* Collection title - top-level grouping (collection > set).
          Sits on a lifted surface panel to create depth against the page bg. */}
      <div
        className="-mx-4 md:-mx-4 px-4 md:px-4 py-3 md:py-3.5"
        style={{
          background: 'var(--bg-surface)',
          borderTop: '1px solid var(--border-subtle)',
          borderBottom: '1px solid var(--border-subtle)',
          boxShadow: '0 1px 0 0 var(--border-subtle)',
        }}
      >
        <div
          className="text-[10px] tracking-[0.22em] uppercase mb-1"
          style={{ color: 'var(--text-muted)' }}
        >
          Collection
        </div>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2
            className="uppercase"
            style={{
              fontFamily: 'var(--font-display)',
              color: 'var(--text-primary)',
              fontSize: 'clamp(20px, 2.4vw, 28px)',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              lineHeight: 1,
            }}
          >
            {collectionName}
          </h2>
          <span
            className="text-[11px] tracking-[0.16em] uppercase"
            style={{ color: 'var(--text-muted)' }}
          >
            {filtered.length.toLocaleString()} cards
            {activeSet ? ` · ${activeSet}` : ` · ${sets.length} sets`}
          </span>
          {visibleSetCodes.length > 1 && (
            <button
              type="button"
              onClick={() => {
                // Explicitly mark every visible set as user-touched so the
                // auto-expand-on-scroll observer doesn't immediately
                // override a "Collapse all" gesture as the user scrolls.
                setUserToggledSets(new Set(visibleSetCodes))
                setCollapsedSets(allCollapsed ? new Set() : new Set(visibleSetCodes))
              }}
              className="text-[10px] tracking-[0.16em] uppercase ml-auto inline-flex items-center gap-1 px-2 py-1"
              style={{
                color: 'var(--text-primary)',
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                lineHeight: 1,
              }}
              aria-label={allCollapsed ? 'Expand all sets' : 'Collapse all sets'}
            >
              {allCollapsed ? 'Expand all' : 'Collapse all'}
            </button>
          )}
        </div>
        {/* Active filter chips - visible only when at least one filter is on */}
        {(activeSet || activeRarity || activeColor || searchQuery.trim()) && (
          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <span
              className="text-[10px] tracking-[0.18em] uppercase mr-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Filters
            </span>
            {activeSet && (
              <FilterChip label={activeSet} onClear={() => setActiveSet(null)} />
            )}
            {activeRarity && (
              <FilterChip label={activeRarity} onClear={() => setActiveRarity(null)} />
            )}
            {activeColor && (
              <FilterChip label={activeColor} onClear={() => setActiveColor(null)} />
            )}
            {searchQuery.trim() && (
              <FilterChip
                label={`"${searchQuery.trim()}"`}
                onClear={() => setSearchQuery('')}
              />
            )}
            <button
              type="button"
              onClick={() => {
                setActiveSet(null)
                setActiveRarity(null)
                setActiveColor(null)
                setSearchQuery('')
              }}
              className="text-[10px] tracking-[0.14em] uppercase underline underline-offset-2 ml-1"
              style={{ color: 'var(--text-muted)' }}
            >
              Clear all
            </button>
          </div>
        )}
      </div>

      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]
          const type = rowMeta[virtualRow.index]
          const top = virtualRow.start - virtualizer.options.scrollMargin

          if (type === 'header') {
            const set = row as CardSet
            const isCollapsed = collapsedSets.has(set.setCode)
            const count = setCounts.get(set.setCode) ?? 0
            return (
              <SetHeaderRow
                key={"header-" + set.setCode}
                set={set}
                count={count}
                isCollapsed={isCollapsed}
                onToggle={toggleSet}
                onAutoExpand={autoExpandSet}
                style={{ height: virtualRow.size, transform: "translateY(" + top + "px)" }}
              />
            )
          }

          const cardRow = row as Card[]
          // Only the very first card row gets eager image loading; this
          // resolves the LCP warning without flooding the network on load.
          const isFirstCardRow = virtualRow.index === firstCardRowIndex
          return (
            <div
              key={"row-" + virtualRow.index}
              className="absolute top-0 left-0 w-full"
              style={{ height: virtualRow.size, transform: "translateY(" + top + "px)" }}
            >
              <div
                className="grid"
                style={{ gridTemplateColumns: "repeat(" + columns + ", 1fr)", gap: GAP }}
              >
                {cardRow.map((card) => (
                  <CardTile key={card.id} card={card} priority={isFirstCardRow} />
                ))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="h-20" />
    </div>
  )
}

/**
 * Set header row that auto-expands as the user scrolls toward it.
 *
 * Uses an IntersectionObserver with a generous bottom rootMargin so the
 * expansion fires while the header is still ~400px below the viewport.
 * That gives the next set's images time to start loading before the user
 * actually reaches them, producing the "accordion-on-scroll" feel
 * without an empty flash.
 *
 * Crucially this only fires on collapsed headers, and parent state
 * (`userToggledSets`) suppresses re-expansion of any set the user has
 * explicitly collapsed.
 */
function SetHeaderRow({
  set,
  count,
  isCollapsed,
  onToggle,
  onAutoExpand,
  style,
}: {
  set: CardSet
  count: number
  isCollapsed: boolean
  onToggle: (setCode: string) => void
  onAutoExpand: (setCode: string) => void
  style: React.CSSProperties
}) {
  const rowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isCollapsed) return
    const el = rowRef.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            onAutoExpand(set.setCode)
            // Once expanded the observer becomes irrelevant for this set;
            // the effect will tear down on the `isCollapsed` change.
          }
        }
      },
      {
        // Expand BEFORE the header is on-screen so the cards are mounted
        // and images are already in flight when the user gets there.
        // Negative top + positive bottom widens the trigger region into
        // a ~400px band just below the visible viewport.
        rootMargin: '0px 0px 400px 0px',
        threshold: 0,
      },
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [isCollapsed, set.setCode, onAutoExpand])

  return (
    <div
      ref={rowRef}
      className="absolute top-0 left-0 w-full flex flex-col justify-end pb-2"
      style={style}
    >
      <div
        className="w-full mb-2"
        style={{ height: 1, background: 'var(--border-subtle)' }}
      />
      <button
        type="button"
        onClick={() => onToggle(set.setCode)}
        className="flex items-center gap-2 text-left w-full -ml-1 pl-1 py-1 rounded"
        aria-expanded={!isCollapsed}
        aria-label={`${isCollapsed ? 'Expand' : 'Collapse'} ${set.setName}`}
        style={{ cursor: 'pointer', background: 'transparent' }}
      >
        <ChevronRight
          size={12}
          strokeWidth={2.5}
          style={{
            color: 'var(--text-secondary)',
            transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
            transition: 'transform 0.15s ease',
            flexShrink: 0,
          }}
        />
        <div className="flex items-baseline gap-2.5 flex-wrap">
          <span
            className="text-xs font-bold tracking-[0.12em] uppercase"
            style={{ fontFamily: 'var(--font-display)', color: 'var(--text-primary)' }}
          >
            {set.setCode}
          </span>
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--text-secondary)' }}>·</span>
          <span className="text-[10px] tracking-wider uppercase" style={{ color: 'var(--text-secondary)' }}>
            {set.setName}
          </span>
          {set.releaseDate && (
            <>
              <span className="text-[10px] tracking-wider" style={{ color: 'var(--text-muted)' }}>·</span>
              <span className="text-[10px] tracking-wider tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {set.releaseDate}
              </span>
            </>
          )}
          <span className="text-[10px] tracking-wider" style={{ color: 'var(--text-muted)' }}>·</span>
          <span className="text-[10px] tracking-wider tabular-nums" style={{ color: 'var(--text-muted)' }}>
            {count} cards
          </span>
        </div>
      </button>
    </div>
  )
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span
      className="inline-flex items-center gap-1 pl-2 pr-1 py-0.5 text-[11px] font-medium"
      style={{
        background: 'color-mix(in srgb, #E85D2A 14%, transparent)',
        color: '#E85D2A',
        border: '1px solid color-mix(in srgb, #E85D2A 45%, transparent)',
        borderRadius: 4,
        lineHeight: 1.4,
      }}
    >
      <span className="max-w-[180px] truncate">{label}</span>
      <button
        type="button"
        onClick={onClear}
        aria-label={`Clear filter ${label}`}
        className="inline-flex items-center justify-center rounded-sm transition-colors"
        style={{
          width: 14,
          height: 14,
          color: 'currentColor',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'color-mix(in srgb, #E85D2A 25%, transparent)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent'
        }}
      >
        <X size={10} strokeWidth={2.5} />
      </button>
    </span>
  )
}
