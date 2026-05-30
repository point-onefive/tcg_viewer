// Tile price badge. Sits in the top-right corner of a card tile and
// renders the market price (eBay active listings for Gundam; TCGPlayer
// market for One Piece). Off by default for visual cleanliness; users
// opt in via the "Prices" toggle in the header. Renders nothing when
// no pricing data exists for the wall card id.

'use client'

import { useStore } from '@/lib/store'
import {
  formatUsdCompact,
  getCardPricingForCollection,
  useEnsurePricingLoadedForCollection,
} from '@/lib/pricing'

interface PriceBadgeProps {
  /** Wall card id (either base "GD01-001" or variant "GD01-001_p1"). */
  printId: string
}

export function PriceBadge({ printId }: PriceBadgeProps) {
  const collection = useStore((s) => s.activeCollection)

  // Triggers the lazy pricing-bundle load on first mount and re-renders
  // once the chunk lands. While the chunk is in flight, getCardPricingForCollection
  // returns null and the badge is invisible - no skeleton flash.
  useEnsurePricingLoadedForCollection(collection)

  const pricing = getCardPricingForCollection(collection, printId)
  if (!pricing) return null

  const price = pricing.primaryMarket
  if (price === null || price === undefined) return null

  // For TCGPlayer-sourced data, skip the badge when the market is
  // flagged as a phantom (no real sale comps). The lightbox still shows
  // the price + warning chip; the tile stays clean.
  if ((pricing.flags ?? []).includes('phantom_market')) return null

  const isEbaySource = pricing.source === 'ebay'
  const lowConfidence = isEbaySource ? false : (pricing.listings ?? 0) < 2

  return (
    <span
      className="card-tile__price-badge"
      style={{ opacity: lowConfidence ? 0.62 : 1 }}
      aria-label={`Market price ${formatUsdCompact(price)}`}
      title={
        lowConfidence
          ? `${formatUsdCompact(price)} · few listings`
          : isEbaySource
            ? `${formatUsdCompact(price)} eBay active`
            : `${formatUsdCompact(price)} market`
      }
    >
      {formatUsdCompact(price)}
    </span>
  )
}
