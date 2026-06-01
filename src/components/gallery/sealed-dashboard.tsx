// Booster box price dashboard. One tile per box; clicking a tile
// expands an inline detail panel with the full history chart. Kept
// self-contained so it doesn't depend on the wall's set/language
// filters - this page only cares about box products.

'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { HelpCircle, Layers, Package } from 'lucide-react'
import dynamic from 'next/dynamic'
import { ThemeToggle } from '@/components/gallery/theme-toggle'
import { Footer } from '@/components/gallery/footer'
import {
  BoxPricing,
  formatRelative,
  formatUsd,
  getBoxes,
  useEnsureBoxesLoaded,
} from '@/lib/pricing'
import type { CardSet } from '@/lib/types'
import setsMeta from '@/lib/sets-one-piece.json'
import { useStore } from '@/lib/store'

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
 * requests — so a single uniform source covers tiles AND the modal.
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

const SET_LOOKUP = new Map<string, CardSet>(
  (setsMeta as CardSet[]).map((s) => [s.setCode, s]),
)

/** "EB-01" → "EB01", "OP01" → "OP01". Hybrid codes try each segment. */
function lookupSetMeta(setAbbr: string): CardSet | null {
  const direct = setAbbr.replace(/-(?=\d)/g, '')
  if (SET_LOOKUP.has(direct)) return SET_LOOKUP.get(direct)!
  for (const seg of setAbbr.split(/[^A-Z0-9]+/i)) {
    if (SET_LOOKUP.has(seg)) return SET_LOOKUP.get(seg)!
  }
  return null
}

export function SealedDashboard() {
  const ready = useEnsureBoxesLoaded()
  const tierPoolCount = useStore((s) => s.tierPool.length)

  const boxes = useMemo(() => {
    if (!ready) return []
    const all = getBoxes()
    return [...all].sort((a, b) => {
      const ao = scoreSetAbbr(a.setAbbr)
      const bo = scoreSetAbbr(b.setAbbr)
      if (ao !== bo) return ao - bo
      return a.name.localeCompare(b.name)
    })
  }, [ready])

  const grouped = useMemo(() => {
    const out: { setAbbr: string; setInfo: CardSet | null; items: BoxPricing[] }[] = []
    for (const box of boxes) {
      const last = out[out.length - 1]
      if (!last || last.setAbbr !== box.setAbbr) {
        out.push({ setAbbr: box.setAbbr, setInfo: lookupSetMeta(box.setAbbr), items: [box] })
      } else {
        last.items.push(box)
      }
    }
    return out
  }, [boxes])

  const [activeId, setActiveId] = useState<string | null>(null)

  const stats = useMemo(() => {
    const withMarket = boxes.filter((b) => b.market !== null)
    const totalMarket = withMarket.reduce((sum, b) => sum + (b.market || 0), 0)
    return {
      count: boxes.length,
      avg: withMarket.length ? totalMarket / withMarket.length : 0,
      max: withMarket.length ? Math.max(...withMarket.map((b) => b.market || 0)) : 0,
    }
  }, [boxes])

  const ctrl: React.CSSProperties = {
    background: 'var(--bg-surface)',
    border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
    borderRadius: 6,
    color: 'var(--text-primary)',
  }

  return (
    <div className="sb-page">
      {/* Row 1 — same brand lockup + nav cluster as the gallery header */}
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

          <div className="flex items-center gap-2 shrink-0">
            <Link
              href="/help"
              className="footer-btn inline-flex items-center justify-center"
              style={{ ...ctrl, width: 30, height: 30 }}
              aria-label="How it works"
              title="How it works"
            >
              <HelpCircle size={14} strokeWidth={2.25} aria-hidden />
            </Link>
            <ThemeToggle />
            <Link
              href="/tier-list"
              className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
              style={{
                ...ctrl,
                height: 30,
                background: tierPoolCount > 0 ? 'var(--text-primary)' : 'var(--bg-surface)',
                color: tierPoolCount > 0 ? 'var(--bg)' : 'var(--text-primary)',
              }}
              aria-label="Open tier list maker"
            >
              <Layers size={12} strokeWidth={2.25} aria-hidden />
              Tiers
            </Link>
            <span
              className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium pointer-events-none"
              style={{
                ...ctrl,
                height: 30,
                background: 'var(--text-primary)',
                color: 'var(--bg)',
                borderColor: 'var(--text-primary)',
              }}
              aria-current="page"
            >
              <Package size={12} strokeWidth={2.25} aria-hidden />
              Sealed
            </span>
          </div>
        </div>
      </header>

      <main className="sb-main">
        {/* Collection band — mirrors the card wall's set/collection header */}
        <div className="sb-collection-band">
          <div className="sb-collection-band__eyebrow">Sealed product</div>
          <div className="sb-collection-band__row">
            <h1 className="sb-collection-band__title">One Piece booster boxes</h1>
            <span className="sb-collection-band__meta">
              {stats.count.toLocaleString()} boxes
              {stats.avg > 0 && <> · avg {formatUsd(stats.avg)}</>}
              {stats.max > 0 && <> · top {formatUsd(stats.max)}</>}
            </span>
          </div>
        </div>

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
        ) : (
          <div className="sb-sections">
            {grouped.map((group) => (
              <section key={group.setAbbr} className="sb-section">
                <SetSectionHeader
                  setAbbr={group.setAbbr}
                  setInfo={group.setInfo}
                  count={group.items.length}
                />
                <div className="sb-grid">
                  {group.items.map((box) => (
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
              </section>
            ))}
          </div>
        )}

        {activeId && <BoxDetail boxId={activeId} onClose={() => setActiveId(null)} />}
      </main>

      <Footer />
    </div>
  )
}

function SetSectionHeader({
  setAbbr,
  setInfo,
  count,
}: {
  setAbbr: string
  setInfo: CardSet | null
  count: number
}) {
  return (
    <div className="sb-set-header">
      <div className="sb-set-header__rule" aria-hidden />
      <div className="sb-set-header__row">
        <span className="sb-set-header__code">{setAbbr}</span>
        {setInfo && (
          <>
            <span className="sb-set-header__name">{setInfo.setName}</span>
            {setInfo.releaseDate && (
              <span className="sb-set-header__date">{setInfo.releaseDate}</span>
            )}
          </>
        )}
        <span className="sb-set-header__count">
          {count} {count === 1 ? 'box' : 'boxes'}
        </span>
      </div>
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
    if (box.history.length < 2) return null
    const first = box.history[0][1]
    const last = box.history[box.history.length - 1][1]
    if (!first) return null
    const delta = ((last - first) / first) * 100
    return { delta }
  }, [box.history])

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
        {box.market != null && (
          <span className="sb-tile__price-badge">{formatUsd(box.market)}</span>
        )}
        {trend && (
          <span
            className={`sb-tile__trend sb-tile__trend--${trend.delta >= 0 ? 'up' : 'down'}`}
            title={`${trend.delta >= 0 ? '+' : ''}${trend.delta.toFixed(1)}% over ${box.history.length} snapshots`}
          >
            {trend.delta >= 0 ? '▲' : '▼'} {Math.abs(trend.delta).toFixed(1)}%
          </span>
        )}
      </div>

      <div className="sb-tile__foot">
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
