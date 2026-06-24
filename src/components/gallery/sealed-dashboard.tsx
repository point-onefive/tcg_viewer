// Booster box price dashboard. One tile per box; clicking a tile
// expands an inline detail panel with the full history chart. Kept
// self-contained so it doesn't depend on the wall's set/language
// filters - this page only cares about box products.

'use client'

import { useMemo, useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowUpDown, Package, Search, X } from 'lucide-react'
import dynamic from 'next/dynamic'
import { SiteNavMenu } from '@/components/gallery/site-nav-menu'
import { Footer } from '@/components/gallery/footer'
import {
  BoxPricing,
  formatRelative,
  formatUsd,
  getBoxes,
  useEnsureBoxesLoaded,
} from '@/lib/pricing'
const Sparkline = dynamic(
  () => import('./pricing-sparkline').then((m) => m.Sparkline),
  { ssr: false, loading: () => <div className="sb-sparkline-skeleton" /> },
)

/**
 * Upgrade a TCGPlayer product image URL to its high-resolution square
 * source. The op_hub pricing pipeline stores the `_200w` thumbnail
 * (~200px wide → soft/blurry on retina tiles and the detail panel). The
 * same product ID also serves an `_in_1000x1000` original, which Next's
 * image optimizer downscales to crisp WebP at whatever size each spot
 * requests - so a single uniform source covers tiles AND the modal.
 */
function hiResBoxImage(url: string | null): string | null {
  if (!url) return url
  return url.replace(
    /(tcgplayer-cdn\.tcgplayer\.com\/product\/\d+)_[^/.]+\.(?:jpg|jpeg|png|webp)/i,
    '$1_in_1000x1000.jpg',
  )
}

const BoxLineChart = dynamic(
  () => import('./box-line-chart').then((m) => m.BoxLineChart),
  { ssr: false, loading: () => <div className="sb-detail-chart-skeleton" /> },
)

// The zoom scrubber maps one notch to exactly one column, so every notch on the
// track produces a visible change (no dead notches where scrubbing does
// nothing). Each breakpoint exposes only the column counts that actually fit:
// phones top out at 4 columns, small tablets at 6, desktop at 12.
function colRangeForWidth(windowWidth: number): { min: number; max: number } {
  if (windowWidth < 640) return { min: 1, max: 4 } // phones
  if (windowWidth < 768) return { min: 2, max: 6 } // small tablets
  return { min: 2, max: 12 } // desktop
}

// Resolve the live column count: the chosen zoom (which IS the column count)
// clamped into whatever range the current viewport supports.
function zoomToCols(zoom: number, windowWidth: number): number {
  const { min, max } = colRangeForWidth(windowWidth)
  return Math.min(Math.max(Math.round(zoom), min), max)
}

// Row gap runs larger than column gap so the foot (name · listings ·
// sparkline) reads as part of its own tile instead of floating in the
// seam above the next row's box art.
function gapForCols(cols: number): { col: number; row: number } {
  if (cols >= 10) return { col: 8, row: 14 }
  if (cols >= 7)  return { col: 10, row: 18 }
  return { col: 14, row: 26 }
}

// Percent move across a box's whole tracked window (first snapshot -> latest).
// Shared by the tile badge and the gainers/losers sort so they always agree.
function boxTrendPct(box: BoxPricing): number | null {
  if (box.history.length < 2) return null
  const first = box.history[0][1]
  const last = box.history[box.history.length - 1][1]
  if (!first) return null
  return ((last - first) / first) * 100
}

// Sort modes offered in the toolbar. `release` uses scoreSetAbbr (set order is
// a faithful proxy for release order: OP01 -> OP02 -> ...); the rest sort on
// live price / movement / name. Boxes missing the relevant value sink to the
// bottom so a half-tracked print never outranks one with real data.
type SortMode =
  | 'release-desc'
  | 'release-asc'
  | 'gainers'
  | 'losers'
  | 'price-desc'
  | 'price-asc'
  | 'name'

const SORT_OPTIONS: { value: SortMode; label: string }[] = [
  { value: 'release-desc', label: 'Release: newest' },
  { value: 'release-asc', label: 'Release: oldest' },
  { value: 'gainers', label: 'Biggest gainers' },
  { value: 'losers', label: 'Biggest losers' },
  { value: 'price-desc', label: 'Price: high to low' },
  { value: 'price-asc', label: 'Price: low to high' },
  { value: 'name', label: 'Name: A to Z' },
]

// Sink nullish values to the end regardless of sort direction.
function nullsLast(value: number | null, descending: boolean): number {
  if (value == null || Number.isNaN(value)) return descending ? -Infinity : Infinity
  return value
}

function sortBoxes(boxes: BoxPricing[], mode: SortMode): BoxPricing[] {
  const out = [...boxes]
  switch (mode) {
    case 'release-desc':
      return out.sort((a, b) => scoreSetAbbr(b.setAbbr) - scoreSetAbbr(a.setAbbr) || a.name.localeCompare(b.name))
    case 'release-asc':
      return out.sort((a, b) => scoreSetAbbr(a.setAbbr) - scoreSetAbbr(b.setAbbr) || a.name.localeCompare(b.name))
    case 'gainers':
      return out.sort((a, b) => nullsLast(boxTrendPct(b), true) - nullsLast(boxTrendPct(a), true))
    case 'losers':
      return out.sort((a, b) => nullsLast(boxTrendPct(a), false) - nullsLast(boxTrendPct(b), false))
    case 'price-desc':
      return out.sort((a, b) => nullsLast(b.market, true) - nullsLast(a.market, true))
    case 'price-asc':
      return out.sort((a, b) => nullsLast(a.market, false) - nullsLast(b.market, false))
    case 'name':
      return out.sort((a, b) => a.name.localeCompare(b.name))
    default:
      return out
  }
}

// Free-text search across set code + name. Tokenised so "op05 awakening"
// matches regardless of word order; every token must hit somewhere.
function matchesQuery(box: BoxPricing, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const haystack = `${box.setAbbr} ${box.name}`.toLowerCase()
  return q.split(/\s+/).every((token) => haystack.includes(token))
}

/** Card-wall-style zoom scrubber. `fluid` stretches the track to fill
 *  its flex slot (mobile row); otherwise it's a fixed 90px desktop pill.
 *  `min`/`max` come from the active breakpoint so every notch maps to a
 *  distinct column count (no dead notches). `value` is the live, clamped
 *  column count so the thumb always sits within the track. */
function ZoomScrubber({
  value,
  setZoom,
  min,
  max,
  ctrl,
  className,
  fluid = false,
}: {
  value: number
  setZoom: (z: number) => void
  min: number
  max: number
  ctrl: React.CSSProperties
  className?: string
  fluid?: boolean
}) {
  return (
    <div
      className={`items-center gap-2 px-3 ${className ?? 'flex'}${fluid ? ' flex-1 min-w-0' : ''}`}
      style={{ ...ctrl, height: 30 }}
    >
      <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
      </svg>
      <input
        type="range" min={min} max={max} step={1} value={value}
        onChange={(e) => setZoom(Number(e.target.value))}
        className="zoom-slider" aria-label="Zoom level"
        style={fluid ? { width: '100%' } : { width: 90 }}
      />
      <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
        <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
        <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
      </svg>
    </div>
  )
}

export function SealedDashboard() {
  const ready = useEnsureBoxesLoaded()
  // Zoom IS the desired column count. Phones default to 2-up (roomy box art),
  // larger screens to 5-up; each is then clamped to the breakpoint's range.
  const [zoom, setZoom] = useState(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 2 : 5,
  )
  const [windowWidth, setWindowWidth] = useState(1200)

  useEffect(() => {
    const update = () => setWindowWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update, { passive: true })
    return () => window.removeEventListener('resize', update)
  }, [])

  const columns = zoomToCols(zoom, windowWidth)
  const zoomRange = colRangeForWidth(windowWidth)

  // Toolbar state: free-text search + sort mode. Default keeps the familiar
  // release order (OP01 -> newest, then special products) the page has always
  // opened on; newest-first and the price/movement sorts are a click away.
  const [query, setQuery] = useState('')
  const [sortMode, setSortMode] = useState<SortMode>('release-asc')

  const boxes = useMemo(() => {
    if (!ready) return []
    return getBoxes()
  }, [ready])

  // What the grid actually renders: boxes filtered by the search query then
  // ordered by the chosen sort mode.
  const visibleBoxes = useMemo(
    () => sortBoxes(boxes.filter((b) => matchesQuery(b, query)), sortMode),
    [boxes, query, sortMode],
  )

  const [activeId, setActiveId] = useState<string | null>(null)

  const stats = useMemo(() => {
    const withMarket = visibleBoxes.filter((b) => b.market !== null)
    const totalMarket = withMarket.reduce((sum, b) => sum + (b.market || 0), 0)
    return {
      count: visibleBoxes.length,
      total: boxes.length,
      avg: withMarket.length ? totalMarket / withMarket.length : 0,
      max: withMarket.length ? Math.max(...withMarket.map((b) => b.market || 0)) : 0,
    }
  }, [visibleBoxes, boxes.length])

  const ctrl: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
    borderRadius: 6,
    color: 'var(--text-primary)',
  }

  return (
    <div className="sb-page">
      {/* Row 1 - same brand lockup + nav cluster as the gallery header */}
      <header className="sb-header">
        <div className="sb-header__inner">
          <div className="flex items-center gap-2 min-w-0">
            <Link href="/" className="sb-brand group" aria-label="The Card Wall - home">
              <span className="sb-brand__mascot">
                <img
                  src="/images/site-logo.png"
                  alt=""
                  aria-hidden
                  width={22}
                  height={22}
                  className="sb-brand__logo"
                />
              </span>
              <span className="sb-brand__wordmark">
                <span className="sb-brand__the" aria-hidden>the</span>
                <span>Card Wall</span>
              </span>
            </Link>
            <span className="sb-brand__beta" aria-label="Beta release">beta</span>
          </div>

          <div
            aria-hidden
            className="hidden xl:flex flex-1 items-center justify-center pointer-events-none select-none"
          >
            <span className="sb-tagline">
              <span className="sb-tagline__quote">“</span>
              Daily TCGPlayer market prices for every booster box
              <span className="sb-tagline__quote">”</span>
            </span>
          </div>

          {/* Uniform right cluster: zoom (desktop) + the shared site
              menu (theme + hamburger). Every destination lives in the
              menu, so this matches every other page. */}
          <div className="flex items-center gap-2 shrink-0">
            <ZoomScrubber value={columns} setZoom={setZoom} min={zoomRange.min} max={zoomRange.max} ctrl={ctrl} className="hidden sm:flex" />
            <SiteNavMenu />
          </div>
        </div>
      </header>

      {/* Centered page title, matching the tier-list / chart-race header
          so all the tool pages share one masthead aesthetic. */}
      <div className="mx-auto flex items-center justify-center gap-2 px-4 pt-5" style={{ maxWidth: 1800 }}>
        <Package size={20} strokeWidth={2.25} style={{ color: '#E85D2A', flexShrink: 0 }} aria-hidden />
        <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Sealed product</h1>
      </div>

      {/* Mobile zoom scrubber sits below the title with breathing room,
          not crammed under the nav bar. Desktop keeps it in the header. */}
      <div className="sm:hidden mx-auto flex items-center px-4 pt-4" style={{ maxWidth: 1800 }}>
        <ZoomScrubber value={columns} setZoom={setZoom} min={zoomRange.min} max={zoomRange.max} ctrl={ctrl} fluid />
      </div>

      <main className="sb-main">
        {/* Collection band - mirrors the card wall's set/collection header */}
        <div className="sb-collection-band">
          <div className="sb-collection-band__eyebrow">Collection</div>
          <div className="sb-collection-band__row">
            <h2 className="sb-collection-band__title">One Piece booster boxes</h2>
            <span className="sb-collection-band__meta">
              {query.trim()
                ? `${stats.count.toLocaleString()} of ${stats.total.toLocaleString()} boxes`
                : `${stats.total.toLocaleString()} boxes`}
              {stats.avg > 0 && <> · avg {formatUsd(stats.avg)}</>}
              {stats.max > 0 && <> · top {formatUsd(stats.max)}</>}
            </span>
          </div>
        </div>

        {/* Toolbar - search + sort. Lets users find a box fast or reorder by
            release, movement, or price without leaving the grid. */}
        {ready && boxes.length > 0 && (
          <div className="sb-toolbar">
            <div className="sb-search" style={ctrl}>
              <Search size={14} strokeWidth={2.25} aria-hidden className="sb-search__icon" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search boxes…"
                aria-label="Search boxes"
                className="sb-search__input"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="sb-search__clear"
                  aria-label="Clear search"
                >
                  <X size={13} strokeWidth={2.5} aria-hidden />
                </button>
              )}
            </div>
            <label className="sb-sort" style={ctrl}>
              <ArrowUpDown size={13} strokeWidth={2.25} aria-hidden className="sb-sort__icon" />
              <span className="sr-only">Sort boxes</span>
              <select
                value={sortMode}
                onChange={(e) => setSortMode(e.target.value as SortMode)}
                className="sb-sort__select"
                aria-label="Sort boxes"
              >
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        )}

        {!ready ? (
          <div className="sb-loading" aria-live="polite">Loading box prices…</div>
        ) : boxes.length === 0 ? (
          <div className="sb-empty">
            <p>
              No booster box data yet. Run{' '}
              <code>op-hub pricing sync-tcgtracking</code> on the VPS to
              populate the dashboard.
            </p>
          </div>
        ) : visibleBoxes.length === 0 ? (
          <div className="sb-empty">
            <p>
              No boxes match “{query.trim()}”.{' '}
              <button type="button" className="sb-empty__link" onClick={() => setQuery('')}>
                Clear search
              </button>
            </p>
          </div>
        ) : (
          <div
            // Dense = tiles too narrow for the overlay chrome (trend
            // badge, full-size price). CSS strips those down so the
            // box art stays legible at high zoom-out.
            className={`sb-grid${windowWidth / columns < 150 ? ' sb-grid--dense' : ''}`}
            style={{
              // minmax(0, 1fr) lets columns shrink below their content's
              // intrinsic width (a plain 1fr refuses to, which pushed the last
              // column off-screen at 4-up on narrow phones).
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: `${gapForCols(columns).row}px ${gapForCols(columns).col}px`,
            }}
          >
            {visibleBoxes.map((box) => (
              <BoxTile
                key={box.tcgplayerId}
                box={box}
                active={String(box.tcgplayerId) === activeId}
                onClick={() =>
                  setActiveId((prev) =>
                    prev === String(box.tcgplayerId) ? null : String(box.tcgplayerId),
                  )
                }
              />
            ))}
          </div>
        )}

        {activeId && <BoxDetail boxId={activeId} onClose={() => setActiveId(null)} />}
      </main>

      <Footer />
    </div>
  )
}

function BoxTile({
  box,
  active,
  onClick,
}: {
  box: BoxPricing
  active: boolean
  onClick: () => void
}) {
  const trend = useMemo(() => {
    const delta = boxTrendPct(box)
    return delta == null ? null : { delta }
  }, [box])

  const imageUrl = hiResBoxImage(box.imageUrl)
  const shortName = box.name.replace(/^[^:]+:\s*/, '').replace(/\s*-\s*Booster Box.*$/i, '')

  return (
    <button
      type="button"
      className={`sb-tile${active ? ' sb-tile--active' : ''}`}
      onClick={onClick}
      aria-label={`${box.setAbbr} ${box.name}`}
    >
      <div className="sb-tile__stage">
        <div className="sb-tile__img-wrap">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt={box.name}
              fill
              sizes="(max-width: 640px) 45vw, (max-width: 1280px) 25vw, 220px"
              className="sb-tile__img object-contain"
              quality={75}
            />
          ) : (
            <div className="sb-tile__image-fallback" aria-hidden>
              {box.setAbbr || '?'}
            </div>
          )}
        </div>
        <div className="sb-tile__shine" aria-hidden />
      </div>

      <div className="sb-tile__foot">
        {(box.market != null || trend) && (
          <div className="sb-tile__market-row">
            {box.market != null ? (
              <span className="sb-tile__market-price">{formatUsd(box.market)}</span>
            ) : (
              <span className="sb-tile__market-price sb-tile__market-price--na">-</span>
            )}
            {trend ? (
              <span
                className={`sb-tile__market-change sb-tile__market-change--${trend.delta >= 0 ? 'up' : 'down'}`}
                title={`${trend.delta >= 0 ? '+' : ''}${trend.delta.toFixed(1)}% over ${box.history.length} snapshots`}
              >
                {trend.delta >= 0 ? '▲' : '▼'} {Math.abs(trend.delta).toFixed(1)}%
              </span>
            ) : null}
          </div>
        )}
        <span className="sb-tile__set">{box.setAbbr}</span>
        <div className="sb-tile__name">{shortName || box.name}</div>
        {box.listings ? (
          <div className="sb-tile__meta">{box.listings} listings</div>
        ) : null}
        {box.history.length >= 2 && (
          <div className="sb-tile__spark">
            <Sparkline data={box.history} />
          </div>
        )}
      </div>
    </button>
  )
}

function BoxDetail({ boxId, onClose }: { boxId: string; onClose: () => void }) {
  const box = useMemo(() => getBoxes().find((b) => String(b.tcgplayerId) === boxId), [boxId])
  if (!box) return null

  const imageUrl = hiResBoxImage(box.imageUrl)

  return (
    <div
      className="sb-detail-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`${box.name} pricing detail`}
      onClick={onClose}
    >
      <div className="sb-detail" onClick={(e) => e.stopPropagation()}>
        <div className="sb-detail__head">
          <div className="sb-detail__heading">
            <span className="sb-detail__set">{box.setAbbr}</span>
            <span className="sb-detail__name">{box.name}</span>
          </div>
          <button type="button" onClick={onClose} className="sb-detail__close" aria-label="Close">
            ×
          </button>
        </div>

        <div className="sb-detail__body">
          <div className="sb-detail__image">
            {imageUrl ? (
              <div className="sb-detail__img-wrap">
                <Image
                  src={imageUrl}
                  alt={box.name}
                  fill
                  sizes="(max-width: 768px) 80vw, 360px"
                  className="object-contain"
                  quality={75}
                />
              </div>
            ) : null}
          </div>

          <div className="sb-detail__stats">
            <div className="sb-detail__price">{formatUsd(box.market)}</div>
            <div className="sb-detail__pricesub">
              {formatUsd(box.low)} – {formatUsd(box.high)} listing range
            </div>
            {box.listings != null && (
              <div className="sb-detail__row">
                <span>Listings</span>
                <span>{box.listings}</span>
              </div>
            )}
            <div className="sb-detail__row">
              <span>Snapshots</span>
              <span>{box.history.length}</span>
            </div>
            <div className="sb-detail__row">
              <span>Last refresh</span>
              <span>{formatRelative(box.syncedAt)}</span>
            </div>
          </div>
        </div>

        {box.history.length >= 2 && (
          <div className="sb-detail__chart">
            <BoxLineChart data={box.history} />
          </div>
        )}
      </div>
    </div>
  )
}

function scoreSetAbbr(rawCode: string): number {
  const PREFIX_BUCKET: Record<string, number> = {
    OP: 0,
    ST: 1000,
    EB: 2000,
    PRB: 3000,
  }
  const FALLBACK_BUCKET = 9000

  const normalized = rawCode.replace(/-(?=\d)/g, '')
  const segments = normalized.split(/[^A-Z0-9]+/i)

  let bestBucket = FALLBACK_BUCKET
  let chosenNum = 0
  for (const seg of segments) {
    const m = seg.match(/^([A-Z]+)0*(\d+)?$/)
    if (!m) continue
    const bucket = PREFIX_BUCKET[m[1]] ?? FALLBACK_BUCKET
    const num = m[2] ? parseInt(m[2], 10) : 0
    if (
      bucket > bestBucket ||
      (bestBucket === FALLBACK_BUCKET && bucket < FALLBACK_BUCKET)
    ) {
      bestBucket = bucket
      chosenNum = num
    } else if (bucket === bestBucket && num > chosenNum) {
      chosenNum = num
    }
  }
  return bestBucket + chosenNum
}
