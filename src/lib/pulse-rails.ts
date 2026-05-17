/**
 * Pulse Rails - selection logic for the /pulse scanner.
 *
 * Each rail is a curated horizontal list of cards picked from the catalog
 * by a specific market criterion. Rails are pure functions over the
 * cards + their MarketSnapshots so they're trivially testable and easy to
 * swap mock data for real Supabase data later.
 *
 * Asset-class scoping: when sealed/raw/promo items land in the watchlist
 * (post-ingest), they'll get their own rails or get woven into existing
 * ones via the kind filter. For v1 we only have card singles.
 */

import type { Card } from './types'
import type { Collection } from './store'
import {
  getMockMarket,
  pulseFromSnapshot,
  type MarketSnapshot,
  type Pulse,
} from './market-mock'

export interface ScannedCard {
  card: Card
  snapshot: MarketSnapshot
  pulse: Pulse
}

export interface Rail {
  id: string
  title: string
  subtitle: string
  cards: ScannedCard[]
}

const RAIL_SIZE = 14

/**
 * Build all rails for a collection. One pass over cards, multiple ranked
 * extractions. Returns rails in display order.
 */
export function buildRails(cards: Card[], collection: Collection): Rail[] {
  const scanned: ScannedCard[] = []
  for (const card of cards) {
    const snap = getMockMarket(card, collection)
    if (!snap) continue
    scanned.push({ card, snapshot: snap, pulse: pulseFromSnapshot(snap) })
  }
  if (scanned.length === 0) return []

  return [
    rail(
      'heating-up',
      'Heating Up',
      'Price action climbing over the last 30 days. Highest-momentum signals first.',
      [...scanned]
        .filter((s) => s.snapshot.priceTrend === 'up')
        .sort((a, b) => b.snapshot.sleeperScore - a.snapshot.sleeperScore)
    ),
    rail(
      'sleepers',
      'Quiet Sleepers',
      'Low population, thin live supply, no recent volatility. Underpriced relative to scarcity.',
      [...scanned]
        .filter(
          (s) =>
            s.snapshot.priceTrend === 'flat' &&
            s.snapshot.activeListings <= 4 &&
            s.snapshot.psa10Pop <= 120
        )
        .sort((a, b) => b.snapshot.sleeperScore - a.snapshot.sleeperScore)
    ),
    rail(
      'thin-supply',
      'Thin Supply',
      'PSA 10 floor is being squeezed - very few active listings.',
      [...scanned]
        .filter((s) => s.snapshot.activeListings <= 2)
        .sort((a, b) => a.snapshot.activeListings - b.snapshot.activeListings || b.snapshot.sleeperScore - a.snapshot.sleeperScore)
    ),
    rail(
      'newly-scarce',
      'Newly Scarce',
      'Population growth flat or declining and still low PSA 10 pop.',
      [...scanned]
        .filter((s) => s.snapshot.pop30dDelta <= 0 && s.snapshot.psa10Pop <= 80)
        .sort((a, b) => a.snapshot.psa10Pop - b.snapshot.psa10Pop)
    ),
    rail(
      'floor-squeezes',
      'Floor Squeezes',
      'Lowest BIN sitting at or below the 30-day median. Possible mispricing.',
      [...scanned]
        .filter((s) => s.snapshot.psa10LowestBin <= s.snapshot.psa10Median30d * 0.92)
        .sort(
          (a, b) =>
            a.snapshot.psa10LowestBin / a.snapshot.psa10Median30d -
            b.snapshot.psa10LowestBin / b.snapshot.psa10Median30d
        )
    ),
    rail(
      'pop-watch',
      'Pop Watch',
      'PSA 10 population grew sharply in the last 30 days. Watch for supply flood.',
      [...scanned]
        .filter((s) => s.snapshot.pop30dDelta > 0 && s.snapshot.pop30dDelta / s.snapshot.psa10Pop > 0.10)
        .sort((a, b) => b.snapshot.pop30dDelta / b.snapshot.psa10Pop - a.snapshot.pop30dDelta / a.snapshot.psa10Pop)
    ),
  ].filter((r) => r.cards.length > 0)
}

function rail(id: string, title: string, subtitle: string, cards: ScannedCard[]): Rail {
  return { id, title, subtitle, cards: cards.slice(0, RAIL_SIZE) }
}
