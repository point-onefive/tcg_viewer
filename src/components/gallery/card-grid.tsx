'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { ChevronRight, X } from 'lucide-react'
import { Card, CardSet } from '@/lib/types'
import { useStore, COLLECTIONS } from '@/lib/store'
import { filterAndBuildWall, sortWallEntries, type WallEntry } from '@/lib/card-filter'
import { getCardPricingForCollection } from '@/lib/pricing'
import { COLLECTION_FACETS, facetLabel } from '@/lib/collection-facets'
import { CardTile } from './card-tile'

// Base gap (px) at normal zoom. We tighten this at high column
// counts via gapForColumns() below so dense mosaics don't waste
// horizontal space on whitespace.
const GAP_DEFAULT = 14

interface CardGridProps {
  cards: Card[]
  sets: CardSet[]
}

const CARD_RATIO = 7 / 5 // height / width
// The fixed header height depends on breakpoint *and* (on mobile)
// which TCG is active, because every filter was lifted out of the
// hamburger sheet and into persistent rows under the brand row:
//
//   desktop : 48 brand + 40 filter toolbar                  =  88
//   mobile  : 48 brand + 40 search/set
//                      + 40 facets (One Piece only)
//                      + 40 zoom slider                     = 128 or 168
//
// The taller mobile header eats a chunk of viewport but means zero
// "open sheet, tweak, close sheet, scroll" round-trips for every
// filter on the page. The non-One Piece TCGs skip the facets row so
// they don't pay for filters that don't exist for them yet (Pokemon
// types / Digimon colors will eventually slot into that same row).
const HEADER_H_MOBILE_BASE = 128
const HEADER_H_MOBILE_ONE_PIECE = 168
const HEADER_H_DESKTOP = 88
const LG_BREAKPOINT = 1024
// Hard ceiling on how tiny we let cards get. Picked empirically: at
// 30 columns on a 1024px viewport with a 4px gap, each tile is
// ~29px wide / 41px tall - small enough to skim a 5,000-card set at
// a glance but still big enough that the image reads as a card.
// Beyond ~32 the variant-stack offset and colour bar collapse into
// noise and DOM weight per visible row grows roughly linearly with
// no visual payoff.
const MAX_COLUMNS = 30
// Tighter ceiling for sub-lg viewports. On a 390px phone screen
// 14 cols already puts each tile around 22px wide / 31px tall,
// which is the edge of "you can still identify the card." Anything
// past that and tiles collapse into colour noise - especially at
// the bottom of the slider, where the desktop floor (30 cols) on
// mobile produced a ~10x14px tile that was effectively unusable.
// Cap is applied both as a slider `max` in the mobile zoom row
// AND inside zoomToColumns() so stale persisted desktop zoom
// values don't sneak past the cap when the user loads on mobile.
const MAX_COLUMNS_MOBILE = 14

function headerHeightFor(windowWidth: number, activeCollection: string): number {
  if (windowWidth >= LG_BREAKPOINT) return HEADER_H_DESKTOP
  return activeCollection === 'one-piece'
    ? HEADER_H_MOBILE_ONE_PIECE
    : HEADER_H_MOBILE_BASE
}

// Gap shrinks as the grid densifies. Around the default ~6 columns
// a generous 14px gap reads as "card collection". At the extreme
// zoom-out we want a stamp-album feel, so the gap collapses to a
// hairline so the freed pixels go to actual card art.
function gapForColumns(cols: number): number {
  if (cols >= 24) return 4
  if (cols >= 18) return 6
  if (cols >= 13) return 10
  return GAP_DEFAULT
}

// Minimum columns so that 1 full card fits within the viewport
// height. Uses the default gap as a conservative upper bound - the
// real gap may be tighter at high column counts, but that only
// gives us *more* headroom for fitting cards vertically.
function minColumnsForViewport(windowWidth: number, windowHeight: number, activeCollection: string): number {
  const usableHeight = windowHeight - headerHeightFor(windowWidth, activeCollection) - GAP_DEFAULT
  const containerWidth = Math.min(windowWidth, 1800) - 32
  // cardWidth = containerWidth / cols, cardHeight = cardWidth * CARD_RATIO
  // We need cardHeight <= usableHeight
  // => cols >= containerWidth * CARD_RATIO / usableHeight
  const minCols = Math.ceil((containerWidth * CARD_RATIO) / usableHeight)
  return Math.max(minCols, 1)
}

// zoom 1 = fewest cols (biggest cards). High zoom = up to
// MAX_COLUMNS (smallest cards). Keep the simple "zoom + 1 → column
// count" mapping so each slider tick still feels like one step.
function zoomToColumns(zoom: number, windowWidth: number, windowHeight: number, activeCollection: string) {
  const desired = zoom + 1
  // Per-breakpoint ceiling - the desktop ceiling (30) produced
  // ugly sub-15px tiles on mobile. See MAX_COLUMNS_MOBILE comment
  // above for the empirical justification.
  const ceiling = windowWidth >= LG_BREAKPOINT ? MAX_COLUMNS : MAX_COLUMNS_MOBILE
  const capped = Math.min(desired, ceiling)
  const floor = minColumnsForViewport(windowWidth, windowHeight, activeCollection)
  return Math.max(capped, floor)
}

export function CardGrid({ cards, sets }: CardGridProps) {
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
    language,
    activeCollection,
    zoom,
    wallSort,
  } = useStore()
  const collectionName = COLLECTIONS.find((c) => c.id === activeCollection)?.name ?? 'Collection'
  const [mounted, setMounted] = useState(false)
  const [windowWidth, setWindowWidth] = useState(1200)
  const [windowHeight, setWindowHeight] = useState(800)
  // Collapsed set codes - lets users hide sections to skip long scrolls.
  // Reset when collection changes so stale codes don't linger.
  //
  // Default behaviour: open the FIRST set in the collection, collapse the
  // rest. Otherwise landing on One Piece would mount ~2,500 rows worth of
  // virtual estimates and immediately request ~90 card images. This way
  // the user sees one fully-rendered set on arrival and progressively
  // expands more as they explore - cuts initial layout & network burst.
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
    // our JS handler before scrolling can begin - even for single-finger
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

  const columns = zoomToColumns(zoom, windowWidth, windowHeight, activeCollection)
  // Pre-compute the active header height once per render - used for
  // the layout spacer below the fixed header, the virtualizer's
  // scrollMargin, and the column-fitting math (`minColumnsForViewport`
  // also recomputes it, but cheaply). Depends on collection because
  // the One Piece facets row adds another 40px on mobile.
  const headerH = headerHeightFor(windowWidth, activeCollection)

  // Filter logic lives in @/lib/card-filter so the lightbox viewer
  // can apply the exact same filter on the same inputs - that's what
  // keeps arrow-key navigation inside the filter scope ("opened a
  // Leader, arrow advances to the next Leader, not the next card in
  // the JSON bundle"). Keep the dep list aligned with the keys we
  // pass into filterCards or memoisation will silently drift.
  const { entries: wallEntries } = useMemo(
    () => {
      const result = filterAndBuildWall(cards, {
        activeSet,
        activeRarity,
        activeColor,
        activeCardType,
        activeSubtype,
        activeArtist,
        onlyAltArt,
        onlyErrata,
        searchQuery,
        flatten: flattenWall,
        language,
      })
      if (wallSort !== 'default') {
        result.entries = sortWallEntries(
          result.entries,
          wallSort,
          wallSort === 'price-desc'
            ? (id) => getCardPricingForCollection(activeCollection, id)?.primaryMarket ?? null
            : undefined,
        )
      }
      return result
    },
    [cards, activeSet, activeRarity, activeColor, activeCardType, activeSubtype, activeArtist, onlyAltArt, onlyErrata, searchQuery, flattenWall, language, wallSort, activeCollection],
  )

  // Regroup entries into contiguous blocks by *display* set. A tile's
  // display set is normally its card's setCode, but cross-set reprints
  // carry a `groupSetCode` override (e.g. an OP16 SP whose base lives in
  // OP14 is promoted into OP16). Promotion leaves the tile at its origin
  // position in the flat list, so without this regroup a promoted tile
  // would emit a stray header mid-section. Buckets keep first-appearance
  // order, which preserves the bundle's release ordering when nothing is
  // promoted.
  const groupedEntries = useMemo(() => {
    let needsRegroup = false
    for (const e of wallEntries) {
      if (e.groupSetCode && e.groupSetCode !== e.card.setCode) { needsRegroup = true; break }
    }
    if (!needsRegroup) return wallEntries
    const buckets = new Map<string, WallEntry[]>()
    const order: string[] = []
    for (const e of wallEntries) {
      const sc = e.groupSetCode ?? e.card.setCode
      if (!buckets.has(sc)) { buckets.set(sc, []); order.push(sc) }
      buckets.get(sc)!.push(e)
    }
    const flat: WallEntry[] = []
    for (const sc of order) flat.push(...buckets.get(sc)!)
    return flat
  }, [wallEntries])

  // Tile counts per set (from wall entries) - shown in collapsed headers.
  const setCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of groupedEntries) {
      const sc = e.groupSetCode ?? e.card.setCode
      counts.set(sc, (counts.get(sc) ?? 0) + 1)
    }
    return counts
  }, [groupedEntries])

  const visibleSetCodes = useMemo(() => Array.from(setCounts.keys()), [setCounts])
  const allCollapsed =
    visibleSetCodes.length > 0 && visibleSetCodes.every((s) => collapsedSets.has(s))

  // While the user is searching, sets default to EXPANDED so a query
  // like "nami" doesn't bury its hits behind a stack of 44px collapsed
  // header strips ("OP02 · 1 cards", "OP03 · 1 cards", …). But a set the
  // user EXPLICITLY collapses (tracked in `userToggledSets`) must stay
  // collapsed even during search — otherwise the collapse chevron looks
  // broken. So during search we only honor deliberate collapses, not the
  // default-collapsed state. Clearing the query snaps everything back.
  //
  // Facet toggles (alt art, color, type, rarity) do NOT force-expand.
  // Those filters often leave many cards per set and users expect to
  // collapse everything except the sets they're browsing - toggling
  // "Alt art" should not undo a deliberate "Collapse all" gesture.
  const hasActiveFilter = searchQuery.trim().length > 0

  // Effective collapse state for a set. Normally just `collapsedSets`,
  // but while searching we require the collapse to be a deliberate user
  // gesture (in `userToggledSets`) so default-collapsed sets reveal their
  // search hits while manual collapses still work.
  const isSetCollapsed = useCallback(
    (setCode: string) =>
      collapsedSets.has(setCode) && (!hasActiveFilter || userToggledSets.has(setCode)),
    [collapsedSets, hasActiveFilter, userToggledSets],
  )

  const { rows, rowMeta, firstCardRowIndex } = useMemo(() => {
    const rows: (WallEntry[] | CardSet)[] = []
    const rowMeta: ('cards' | 'header')[] = []
    let currentSet = ''
    let currentCollapsed = false
    let firstCardRowIndex = -1

    for (const entry of groupedEntries) {
      const entrySet = entry.groupSetCode ?? entry.card.setCode
      if (entrySet !== currentSet) {
        currentSet = entrySet
        currentCollapsed = isSetCollapsed(currentSet)
        const set = sets.find((s) => s.setCode === currentSet)
        if (set) {
          rows.push(set)
          rowMeta.push('header')
        }
      }
      if (currentCollapsed) continue
      const lastRow = rows[rows.length - 1]
      if (rowMeta[rowMeta.length - 1] === 'cards' && Array.isArray(lastRow) && lastRow.length < columns) {
        lastRow.push(entry)
      } else {
        rows.push([entry])
        rowMeta.push('cards')
        if (firstCardRowIndex === -1) firstCardRowIndex = rows.length - 1
      }
    }

    return { rows, rowMeta, firstCardRowIndex }
  }, [groupedEntries, columns, sets, isSetCollapsed])

  const estimateSize = useCallback(
    (index: number) => {
      if (rowMeta[index] === 'header') return 44
      const padding = 32
      const gap = gapForColumns(columns)
      const containerWidth = Math.min(window.innerWidth, 1800) - padding
      const cardWidth = (containerWidth - gap * (columns - 1)) / columns
      return Math.round(cardWidth * (7 / 5)) + gap
    },
    [columns, rowMeta]
  )

  const virtualizer = useWindowVirtualizer({
    count: mounted ? rows.length : 0,
    estimateSize,
    // Was 12 → 4 → now 2. 65% of card images hit the Next image
    // optimizer (Bandai CDNs hot-linked when no R2 mirror exists yet),
    // so each off-screen tile we mount eagerly is one more
    // optimizer hit that competes with the in-viewport row for
    // bandwidth. Two rows of preload is enough headroom for smooth
    // scrolling at desktop column counts (≤30) without flooding the
    // network the moment the user lands on the page.
    overscan: 2,
    scrollMargin: headerH,
  })

  if (!mounted) {
    return <div style={{ minHeight: '100vh' }} />
  }

  if (wallEntries.length === 0) {
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
            setActiveCardType(null)
            setOnlyAltArt(false)
            setSearchQuery('')
          }}
          className="footer-btn px-3 py-1.5 text-xs font-medium"
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
      {/* Spacer matches the fixed header (48px mobile, 88px desktop). */}
      <div style={{ height: headerH }} />

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
            {wallEntries.length.toLocaleString()} {flattenWall ? 'prints' : 'cards'}
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
              className="footer-btn text-[10px] tracking-[0.16em] uppercase ml-auto inline-flex items-center gap-1 px-2 py-1"
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
        {(activeSet || activeRarity || activeColor || activeCardType || activeSubtype || activeArtist || onlyAltArt || onlyErrata || flattenWall || searchQuery.trim()) && (
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
            {activeCardType && (
              <FilterChip
                label={facetLabel(COLLECTION_FACETS[activeCollection].cardTypes, activeCardType) || formatCardType(activeCardType)}
                onClear={() => setActiveCardType(null)}
              />
            )}
            {activeRarity && (
              <FilterChip
                label={facetLabel(COLLECTION_FACETS[activeCollection].rarities, activeRarity) || activeRarity}
                onClear={() => setActiveRarity(null)}
              />
            )}
            {activeColor && (
              <FilterChip label={activeColor} onClear={() => setActiveColor(null)} />
            )}
            {activeSubtype && (
              <FilterChip
                label={facetLabel(COLLECTION_FACETS[activeCollection].subtypes ?? [], activeSubtype) || activeSubtype}
                onClear={() => setActiveSubtype(null)}
              />
            )}
            {activeArtist && (
              <FilterChip label={activeArtist} onClear={() => setActiveArtist(null)} />
            )}
            {onlyAltArt && (
              <FilterChip
                label={flattenWall ? 'Alt prints only' : 'Has alt art'}
                onClear={() => setOnlyAltArt(false)}
              />
            )}
            {onlyErrata && (
              <FilterChip label="Errata only" onClear={() => setOnlyErrata(false)} />
            )}
            {flattenWall && (
              <FilterChip label="Flattened" onClear={() => setFlattenWall(false)} />
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
                setActiveCardType(null)
                setActiveSubtype(null)
                setActiveArtist(null)
                setOnlyAltArt(false)
                setOnlyErrata(false)
                setFlattenWall(false)
                setSearchQuery('')
              }}
              className="footer-btn text-[10px] tracking-[0.14em] uppercase px-2 py-1 ml-1"
              style={{
                color: 'var(--text-muted)',
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 6,
                lineHeight: 1,
              }}
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
            // Mirror the same effective-collapse logic used to build the
            // rows so the chevron direction always matches what's rendered
            // beneath it (expanded during search unless deliberately
            // collapsed by the user).
            const isCollapsed = isSetCollapsed(set.setCode)
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

          const entryRow = row as WallEntry[]
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
                style={{ gridTemplateColumns: "repeat(" + columns + ", 1fr)", gap: gapForColumns(columns) }}
              >
                {entryRow.map((entry) => (
                  <CardTile
                    key={entry.wallKey}
                    entry={entry}
                    priority={isFirstCardRow}
                    showStack={!flattenWall && (entry.card.variants?.length ?? 0) > 0 && entry.kind === 'base'}
                  />
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

/**
 * Display label for a Card.cardType filter value. The raw values in
 * the bundle are SHOUTY ("LEADER", "CHARACTER", …) which look harsh
 * inside a chip; we lowercase + capitalise for the UI without
 * changing the source-of-truth value in the store.
 */
function formatCardType(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()
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
