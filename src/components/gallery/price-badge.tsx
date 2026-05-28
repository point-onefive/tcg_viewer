// Tile price badge. Sits in the top-right corner of a card tile and
// renders the resolved TCGPlayer market price (Foil > Holo > Normal
// precedence, resolved server-side during JSON export). Off by default
// for visual cleanliness; users opt in via the "Prices" toggle in the
// header. Renders nothing when no pricing data exists for the wall
// card id - the absence is intentional so the wall doesn't grow noisy
// from "-" placeholders even when the toggle is on.
//
// Mount cost note: CardTile only mounts this badge when the prices
// toggle is on (see CardTile gate). The toggle is also what triggers
// the lazy pricing-bundle load via `useEnsurePricingLoaded` below, so
// users who never flip the toggle pay zero KB for the pricing JSON
// chunk + zero badge component instances on the wall.

'use client'

import {
  formatUsdCompact,
  getCardPricing,
  useEnsurePricingLoaded,
} from '@/lib/pricing'

interface PriceBadgeProps {
  /** Wall card id (either base "OP01-001" or variant "OP01-001_p1"). */
  printId: string
}

export function PriceBadge({ printId }: PriceBadgeProps) {
  // Triggers the lazy pricing-bundle load on first mount and re-renders
  // once the chunk lands. While the chunk is in flight, getCardPricing
  // returns null and the badge is invisible - same outcome as a tile
  // with no pricing data, so there's no skeleton flash to worry about.
  useEnsurePricingLoaded()

  const pricing = getCardPricing(printId)
  if (!pricing) return null

  const price = pricing.primaryMarket
  if (price === null || price === undefined) return null

  // Skip the badge when our export-time sanity layer flagged this
  // card's TCGPlayer market as a phantom (no real sale comps support
  // the headline number). The lightbox still shows the price + a
  // warning chip; the tile stays clean to avoid spreading misleading
  // numbers across the wall.
  if ((pricing.flags ?? []).includes('phantom_market')) return null

  // Insufficient-data guard: TCGTracking sometimes echoes a market price
  // even when the listing count is zero (and the value is stale). We
  // surface the badge anyway because hiding good data is worse than
  // tolerating the occasional stale row, but we soften the visual.
  const lowConfidence = (pricing.listings ?? 0) < 2

  return (
    <span
      className="card-tile__price-badge"
      style={{
        opacity: lowConfidence ? 0.62 : 1,
      }}
      aria-label={`Market price ${formatUsdCompact(price)}`}
      title={
        lowConfidence
          ? `${formatUsdCompact(price)} · few listings`
          : `${formatUsdCompact(price)} market`
      }
    >
      {formatUsdCompact(price)}
    </span>
  )
}
