'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { X } from 'lucide-react'
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
  useEffect(() => {
    let startDist = 0
    let startZoom = 5
    let active = false

    const applyScale = (scale: number) => {
      // Pinch out (scale > 1) grows cards → fewer columns → lower zoom index.
      const delta = -Math.round(Math.log2(scale) * 6)
      const next = Math.max(1, Math.min(12, startZoom + delta))
      if (next !== useStore.getState().zoom) {
        useStore.getState().setZoom(next)
      }
    }

    // ── Touch events (Android / modern iOS) ──
    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        startDist = Math.hypot(dx, dy)
        startZoom = useStore.getState().zoom
        active = true
      }
    }
    const onTouchMove = (e: TouchEvent) => {
      if (active && e.touches.length === 2 && startDist > 0) {
        e.preventDefault()
        const dx = e.touches[0].clientX - e.touches[1].clientX
        const dy = e.touches[0].clientY - e.touches[1].clientY
        const dist = Math.hypot(dx, dy)
        applyScale(dist / startDist)
      }
    }
    const onTouchEnd = () => {
      if (active) {
        active = false
        startDist = 0
      }
    }

    // ── iOS Safari gesture events (non-standard, but required to suppress
    //    the native page pinch-zoom even with user-scalable=no in some cases) ──
    type GestureEvt = Event & { scale: number }
    const onGestureStart = (e: Event) => {
      e.preventDefault()
      startZoom = useStore.getState().zoom
      active = true
    }
    const onGestureChange = (e: Event) => {
      e.preventDefault()
      if (active) applyScale((e as GestureEvt).scale)
    }
    const onGestureEnd = (e: Event) => {
      e.preventDefault()
      active = false
    }

    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchmove', onTouchMove, { passive: false })
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

  const { rows, rowMeta } = useMemo(() => {
    const rows: (Card[] | CardSet)[] = []
    const rowMeta: ('cards' | 'header')[] = []
    let currentSet = ''

    for (const card of filtered) {
      if (card.setCode !== currentSet) {
        currentSet = card.setCode
        const set = sets.find((s) => s.setCode === currentSet)
        if (set) {
          rows.push(set)
          rowMeta.push('header')
        }
      }
      const lastRow = rows[rows.length - 1]
      if (rowMeta[rowMeta.length - 1] === 'cards' && Array.isArray(lastRow) && lastRow.length < columns) {
        lastRow.push(card)
      } else {
        rows.push([card])
        rowMeta.push('cards')
      }
    }

    return { rows, rowMeta }
  }, [filtered, columns, sets])

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
    overscan: 12,
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
        </div>
        {/* Active filter chips — visible only when at least one filter is on */}
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
            return (
              <div
                key={"header-" + set.setCode}
                className="absolute top-0 left-0 w-full flex flex-col justify-end pb-2"
                style={{ height: virtualRow.size, transform: "translateY(" + top + "px)" }}
              >
                <div
                  className="w-full mb-2"
                  style={{ height: 1, background: 'var(--border-subtle)' }}
                />
                <div className="flex items-baseline gap-2.5">
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
                  {set.cardCount != null && (
                    <>
                      <span className="text-[10px] tracking-wider" style={{ color: 'var(--text-muted)' }}>·</span>
                      <span className="text-[10px] tracking-wider tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {set.cardCount} cards
                      </span>
                    </>
                  )}
                </div>
              </div>
            )
          }

          const cardRow = row as Card[]
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
                  <CardTile key={card.id} card={card} />
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
