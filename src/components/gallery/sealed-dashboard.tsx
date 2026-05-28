// Booster box price dashboard. One tile per box; clicking a tile
// expands an inline detail panel with the full history chart. Kept
// self-contained so it doesn't depend on the wall's set/language
// filters - this page only cares about box products.

'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import dynamic from 'next/dynamic'
import {
  BoxPricing,
  formatRelative,
  formatUsd,
  getBoxes,
  getPricingMeta,
  useEnsureBoxesLoaded,
} from '@/lib/pricing'

const Sparkline = dynamic(
  () => import('./pricing-sparkline').then((m) => m.Sparkline),
  { ssr: false, loading: () => <div className="sb-sparkline-skeleton" /> },
)

const BoxLineChart = dynamic(
  () => import('./box-line-chart').then((m) => m.BoxLineChart),
  { ssr: false, loading: () => <div className="sb-detail-chart-skeleton" /> },
)

export function SealedDashboard() {
  // Triggers the lazy boxes-bundle load on mount. While in flight,
  // getBoxes() returns [] and we render the same "no data yet" empty
  // state we already show before the first cron run. Memoised on
  // `ready` so the sorted list stabilises once the data lands.
  const ready = useEnsureBoxesLoaded()
  const boxes = useMemo(() => (ready ? getBoxes() : []), [ready])
  const meta = getPricingMeta()
  const [activeId, setActiveId] = useState<string | null>(null)

  // Aggregate stats for the page header.
  const stats = useMemo(() => {
    const withMarket = boxes.filter((b) => b.market !== null)
    const totalMarket = withMarket.reduce((sum, b) => sum + (b.market || 0), 0)
    return {
      count: boxes.length,
      avg: withMarket.length ? totalMarket / withMarket.length : 0,
      max: withMarket.length ? Math.max(...withMarket.map((b) => b.market || 0)) : 0,
    }
  }, [boxes])

  const lastSync = meta?.lastSuccessful?.tcgtracking_full

  return (
    <main className="sb-root">
      <header className="sb-header">
        <Link href="/" className="sb-back" aria-label="Back to the card wall">
          <ArrowLeft size={14} strokeWidth={2.25} />
          <span>Card Wall</span>
        </Link>
        <h1 className="sb-title">Booster boxes</h1>
        <p className="sb-subtitle">
          Daily TCGPlayer market price across every One Piece booster box
          we track. {lastSync ? `Refreshed ${formatRelative(lastSync)}.` : ''}
        </p>

        <div className="sb-stat-row">
          <div className="sb-stat">
            <span className="sb-stat-label">Boxes</span>
            <span className="sb-stat-value">{stats.count}</span>
          </div>
          <div className="sb-stat">
            <span className="sb-stat-label">Avg market</span>
            <span className="sb-stat-value">{formatUsd(stats.avg)}</span>
          </div>
          <div className="sb-stat">
            <span className="sb-stat-label">Top box</span>
            <span className="sb-stat-value">{formatUsd(stats.max)}</span>
          </div>
        </div>
      </header>

      {boxes.length === 0 ? (
        <div className="sb-empty">
          <p>
            No booster box data yet. Run{' '}
            <code>op-hub pricing sync-tcgtracking</code> on the VPS to
            populate the dashboard.
          </p>
        </div>
      ) : (
        <div className="sb-grid">
          {boxes.map((box) => (
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
    return { delta, last, first }
  }, [box.history])

  return (
    <button
      type="button"
      className={`sb-tile${active ? ' sb-tile--active' : ''}`}
      onClick={onClick}
      aria-label={`${box.setAbbr} ${box.name}`}
    >
      <div className="sb-tile__image">
        {box.imageUrl ? (
          <Image
            src={box.imageUrl}
            alt={box.name}
            fill
            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 240px"
            className="object-contain"
          />
        ) : (
          <div className="sb-tile__image-fallback" aria-hidden>
            {box.setAbbr || '?'}
          </div>
        )}
      </div>

      <div className="sb-tile__body">
        <div className="sb-tile__top">
          <span className="sb-tile__set">{box.setAbbr || '-'}</span>
          {trend && (
            <span
              className={`sb-tile__trend sb-tile__trend--${trend.delta >= 0 ? 'up' : 'down'}`}
              title={`${trend.delta >= 0 ? '+' : ''}${trend.delta.toFixed(1)}% over ${box.history.length} snapshots`}
            >
              {trend.delta >= 0 ? '▲' : '▼'} {Math.abs(trend.delta).toFixed(1)}%
            </span>
          )}
        </div>
        <div className="sb-tile__name">{box.name}</div>
        <div className="sb-tile__price">{formatUsd(box.market)}</div>
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
          <button onClick={onClose} className="sb-detail__close" aria-label="Close">
            ×
          </button>
        </div>

        <div className="sb-detail__body">
          <div className="sb-detail__image">
            {box.imageUrl ? (
              <Image
                src={box.imageUrl}
                alt={box.name}
                fill
                sizes="(max-width: 768px) 80vw, 360px"
                className="object-contain"
              />
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
