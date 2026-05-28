// Booster box price dashboard. One tile per box; clicking a tile
// expands an inline detail panel with the full history chart. Kept
// self-contained so it doesn't depend on the wall's set/language
// filters - this page only cares about box products.

'use client'

import { useMemo, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, Package, TrendingUp, Trophy } from 'lucide-react'
import dynamic from 'next/dynamic'
import { ThemeToggle } from '@/components/gallery/theme-toggle'
import {
  BoxPricing,
  formatRelative,
  formatUsd,
  getBoxes,
  useEnsureBoxesLoaded,
} from '@/lib/pricing'
import setsMeta from '@/lib/sets-one-piece.json'

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
  // Grid sorts in canonical chronological order: OP01..OPxx, then ST
  // series, then EB series, then PRB series, then everything else.
  // Per the user's rule, OP releases always come before EB and PRB
  // releases regardless of strict calendar date. See `scoreSetAbbr`
  // below for the exact ordering logic.
  const boxes = useMemo(() => {
    if (!ready) return []
    const all = getBoxes()
    return [...all].sort((a, b) => {
      const ao = scoreSetAbbr(a.setAbbr)
      const bo = scoreSetAbbr(b.setAbbr)
      if (ao !== bo) return ao - bo
      // Same set: sort by name for stable ordering (e.g. two boxes
      // from the same OP release stay grouped).
      return a.name.localeCompare(b.name)
    })
  }, [ready])
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

  return (
    <div
      className="relative min-h-screen pb-24"
      style={{
        background: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* Sticky glass header mirrors the help page / brand lockup
          pattern so the /sealed route reads as part of the same site,
          not a stray microsite. */}
      <header
        className="sticky top-0 z-20 px-4 py-3"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="footer-btn group inline-flex items-center gap-1.5 text-xs font-medium"
              style={{
                color: 'var(--text-muted)',
                background: 'var(--bg-surface)',
                border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
                borderRadius: 6,
                height: 30,
                padding: '0 10px',
              }}
              aria-label="Back to The Card Wall"
            >
              <ArrowLeft size={14} aria-hidden />
              <span>Back to the wall</span>
            </Link>
            <div
              aria-hidden
              className="hidden sm:block"
              style={{ width: 1, height: 22, background: 'var(--text-muted)', opacity: 0.4 }}
            />
            <div className="flex items-center gap-2">
              <Package size={18} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
              <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">
                Booster boxes
              </h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 pt-8 sm:pt-10">
        {/* Page intro + freshness line. Kept compact so the stat strip
            below it owns the visual weight. */}
        <p
          className="sb-lede"
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            lineHeight: 1.55,
            color: 'var(--text-secondary)',
            letterSpacing: '-0.005em',
            maxWidth: '60ch',
          }}
        >
          Daily TCGPlayer market price across every One Piece booster
          box we track.
        </p>

        {/* Hero stat strip - three themed cards with the brand-orange
            accent treatment. Mobile-first: stacks vertically below 480px,
            two-up on tablet, three-up on desktop. Numbers are
            display-font and oversized so they read at a glance. */}
        <section
          className="sb-statstrip"
          aria-label="Booster box headline metrics"
        >
          <StatCard
            icon={<Package size={16} strokeWidth={2.25} />}
            label="Boxes tracked"
            value={String(stats.count)}
            hint="All printed sets currently sold on TCGPlayer"
          />
          <StatCard
            icon={<TrendingUp size={16} strokeWidth={2.25} />}
            label="Average market"
            value={formatUsd(stats.avg)}
            hint="Mean TCGPlayer market across every tracked box"
          />
          <StatCard
            icon={<Trophy size={16} strokeWidth={2.25} />}
            label="Top box"
            value={formatUsd(stats.max)}
            hint="Highest TCGPlayer market across every tracked box"
            featured
          />
        </section>

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
    </div>
  )
}

/**
 * Brand-themed stat card for the booster-box hero strip. Three of these
 * render side-by-side at desktop sizes and stack vertically on phones.
 * The optional `featured` flag tints the card with the brand-orange
 * accent so a single "headline" metric (e.g. Top box) can pop without
 * unbalancing the others.
 */
function StatCard({
  icon,
  label,
  value,
  hint,
  featured = false,
}: {
  icon: React.ReactNode
  label: string
  value: string
  hint: string
  featured?: boolean
}) {
  return (
    <div
      className={`sb-statcard${featured ? ' sb-statcard--featured' : ''}`}
      title={hint}
    >
      <div className="sb-statcard__head">
        <span className="sb-statcard__icon" aria-hidden>{icon}</span>
        <span className="sb-statcard__label">{label}</span>
      </div>
      <div className="sb-statcard__value">{value}</div>
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

/**
 * Score a setAbbr for canonical release order (smaller = earlier).
 *
 * Two-tier ordering:
 *   1. Prefix bucket: OP < ST < EB < PRB < everything else.
 *   2. Numeric component within the bucket.
 *
 * Per the user's rule, OP releases always come before EB and PRB
 * releases regardless of strict calendar date. The bucket sizes are
 * spaced so two-digit set numbers within a bucket can never spill
 * into the next bucket.
 *
 * Hybrid box codes that live in two sets at once (e.g. "OP15-EB04")
 * pick the *latest* side's bucket because that's the actual release
 * vehicle - "OP15-EB04" is an EB04 product first, an OP15 collab
 * second, so it groups with the EB family.
 */
function scoreSetAbbr(rawCode: string): number {
  const PREFIX_BUCKET: Record<string, number> = {
    OP: 0,
    ST: 1000,
    EB: 2000,
    PRB: 3000,
  }
  const FALLBACK_BUCKET = 9000

  // Normalize: strip separator dashes between the letter prefix and
  // the number ("EB-01" -> "EB01") but keep dashes that join two set
  // codes ("OP15-EB04"). The simplest split: any "-" followed by a
  // letter survives; "-" followed by a digit is a separator.
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

// Silence unused-import warning - setsMeta isn't needed for scoring
// any more, but other helpers may want it later, so keep the file
// path bound.
void setsMeta
