'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
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
  const { searchQuery, activeSet, activeRarity, activeColor, activeCollection, zoom } = useStore()
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
      <div className="flex items-center justify-center h-[60vh]">
        <p className="text-sm tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
          No cards found
        </p>
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
