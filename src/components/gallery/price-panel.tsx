// Lightbox pricing strip - single horizontal bar below the variant dots.
//
// Two cells: hero market price + trend sparkline.
// Supports both One Piece (TCGPlayer-sourced via op_hub) and Gundam
// (eBay Browse active listings via fetch-gundam-pricing.mjs).

'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import {
  formatRelative,
  formatUsd,
  getCardHistoryForCollection,
  getCardPricingForCollection,
  useEnsureHistoryLoadedForCollection,
  useEnsurePricingLoadedForCollection,
} from '@/lib/pricing'

const Sparkline = dynamic(() => import('./pricing-sparkline').then((m) => m.Sparkline), {
  ssr: false,
  loading: () => <div className="lbp-spark-skel" />,
})

interface PricePanelProps {
  wallCardId: string
  collection?: string
}

export function PricePanel({ wallCardId, collection = 'one-piece' }: PricePanelProps) {
  const pricingReady = useEnsurePricingLoadedForCollection(collection)
  const historyReady = useEnsureHistoryLoadedForCollection(collection)

  const pricing = pricingReady ? getCardPricingForCollection(collection, wallCardId) : null
  const history = useMemo(
    () => (historyReady && pricing ? getCardHistoryForCollection(collection, wallCardId) : []),
    [historyReady, pricing, collection, wallCardId],
  )

  if (!pricing) return null

  const heroValue = pricing.primaryMarket
  const subtype = pricing.primarySubtype
  const isEbaySource = pricing.source === 'ebay'
  const heroLabel = isEbaySource
    ? 'eBay active listings'
    : subtype
      ? `TCGPlayer ${subtype.toLowerCase()}`
      : 'TCGPlayer market'
  const listings = pricing.listings
  const syncedAt = pricing.syncedAt
  const phantomMarket = (pricing.flags ?? []).includes('phantom_market')

  const hasHistory = history.length >= 2
  const hasAnything = heroValue !== null || hasHistory
  if (!hasAnything) return null

  // When the matcher used a cross-set fallback (it couldn't find a
  // TCGPlayer product in the set the bundle declared), the displayed
  // price almost certainly belongs to a different printing of the same
  // card code. Surface a strong "verify" warning so the user doesn't
  // trust the number; the alternative (hiding outright) loses too much
  // useful signal for cards we genuinely can't disambiguate.
  const lowConfidence =
    !isEbaySource &&
    typeof pricing.matchConfidence === 'number' &&
    pricing.matchConfidence < 0.5

  return (
    <div className="lbp-shell">
      {lowConfidence && (
        <div
          className="lbp-match-warning"
          title={`Matcher confidence ${(pricing.matchConfidence ?? 0).toFixed(2)} · method ${pricing.matchMethod ?? '?'}. The TCGPlayer product paired to this wall slot likely belongs to a different printing of the same card code. Verify on TCGPlayer before trusting this price.`}
        >
          <span aria-hidden>!</span>
          <span>
            Low-confidence match. TCGPlayer product may be a different
            printing of the same card code. Verify before trusting.
          </span>
        </div>
      )}
      <section className="lbp" aria-label="Market pricing">
        <div
          className="lbp-cell lbp-cell--hero"
          data-phantom={phantomMarket ? 'true' : 'false'}
          data-empty={heroValue === null ? 'true' : 'false'}
        >
          {heroValue !== null ? (
            <>
              <div className="lbp-price">{formatUsd(heroValue)}</div>
              <div className="lbp-hero-meta">
                <span className="lbp-hero-label">{heroLabel}</span>
                {/* Listing counts are only shown for the eBay source, where they
                    reflect a real active-listings query. The TCGPlayer feed
                    reports a near-constant page-size default (mostly 25), so it
                    is not a trustworthy per-card count and is omitted. */}
                {isEbaySource && listings ? (
                  <>
                    <span className="lbp-hero-dot">·</span>
                    <span title="NM single listings filtered">
                      {listings.toLocaleString()} listing{listings === 1 ? '' : 's'}
                    </span>
                  </>
                ) : null}
                {syncedAt ? (
                  <>
                    <span className="lbp-hero-dot">·</span>
                    <span title={syncedAt}>{formatRelative(syncedAt) || 'recent'}</span>
                  </>
                ) : null}
              </div>
              {phantomMarket && (
                <div
                  className="lbp-warning"
                  title="TCGPlayer's listed market price is far above every recent eBay sale. Treat with caution."
                >
                  <span aria-hidden>!</span>
                  <span>No recent sale comps support this list price</span>
                </div>
              )}
            </>
          ) : (
            <div className="lbp-empty lbp-empty--hero">No market data yet</div>
          )}
        </div>

        <div className="lbp-cell lbp-cell--trend">
          <div className="lbp-cell-label">
            Trend
            {hasHistory && (
              <span className="lbp-cell-aside">
                {history.length} snapshot{history.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          {hasHistory ? (
            <div className="lbp-chart">
              <Sparkline data={history} />
            </div>
          ) : (
            <div className="lbp-empty">
              {isEbaySource ? 'Builds with each pricing refresh' : 'Builds with each daily sync'}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
