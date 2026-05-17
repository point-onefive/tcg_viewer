/**
 * Deterministic mock market data for the card-overlay prototype.
 *
 * Why mock first: we want to evaluate the aesthetic of putting market
 * numbers on the gallery before committing to a real backend (PSA + eBay
 * + Supabase). Real ingestion lands in a follow-up.
 *
 * Determinism: every value derives from a 32-bit hash of the card id, so
 * the same card shows the same numbers across reloads / SSR. No flicker,
 * no "the screenshot doesn't match what I see now" pain when comparing
 * designs.
 *
 * Scope: one-piece only for now. The grading market for the other
 * collections (Gundam especially) is too thin to overlay realistically.
 */

import type { Card } from './types'
import type { Collection } from './store'

export type MarketTrend = 'up' | 'down' | 'flat'

export interface MarketSnapshot {
  cardId: string
  // Supply (graded)
  psa10Pop: number
  psa9Pop: number
  totalGraded: number
  pop30dDelta: number          // signed change in PSA 10 population over 30d
  // Pricing (USD)
  psa10LowestBin: number       // lowest active BIN for PSA 10
  psa10Median30d: number       // 30d median sold price for PSA 10
  rawMedian30d: number         // 30d median sold price for raw
  // Supply (live)
  activeListings: number       // PSA 10 active listings on eBay
  // Composite
  sleeperScore: number         // 0-100
  priceTrend: MarketTrend      // 30d momentum
  // Provenance
  asOf: string
  source: 'mock'
}

/** FNV-1a 32-bit hash. Stable, no deps. */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

/** mulberry32 PRNG seeded by hash. Returns 0..1. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface Tier {
  popMean: number      // mean PSA 10 population
  popJitter: number    // multiplicative jitter range
  priceFloor: number   // PSA 10 price floor
  priceCeil: number    // PSA 10 price ceiling
  rawFactor: number    // raw price as fraction of PSA 10 median
}

/** Rarity buckets drive plausible value ranges. */
const TIER_BY_RARITY: Record<string, Tier> = {
  SEC: { popMean:   55, popJitter: 0.6, priceFloor: 280, priceCeil: 1800, rawFactor: 0.10 },
  L:   { popMean:  220, popJitter: 0.7, priceFloor:  60, priceCeil:  450, rawFactor: 0.18 },
  SR:  { popMean:  140, popJitter: 0.7, priceFloor:  80, priceCeil:  700, rawFactor: 0.14 },
  R:   { popMean:  340, popJitter: 0.8, priceFloor:  35, priceCeil:  220, rawFactor: 0.22 },
  UC:  { popMean:  620, popJitter: 0.9, priceFloor:  18, priceCeil:   90, rawFactor: 0.30 },
  C:   { popMean: 1100, popJitter: 1.0, priceFloor:  12, priceCeil:   55, rawFactor: 0.35 },
  P:   { popMean:   95, popJitter: 0.6, priceFloor: 110, priceCeil:  900, rawFactor: 0.12 },
  TR:  { popMean:   40, popJitter: 0.5, priceFloor: 200, priceCeil: 1400, rawFactor: 0.10 },
}

const DEFAULT_TIER: Tier = TIER_BY_RARITY.R

function tierFor(card: Card): Tier {
  if (!card.rarity) return DEFAULT_TIER
  return TIER_BY_RARITY[card.rarity] ?? DEFAULT_TIER
}

/** Has-variants cards lean a bit pricier and scarcer in graded land. */
function variantBoost(card: Card): number {
  const n = card.variants?.length ?? 0
  if (n === 0) return 1.0
  if (n === 1) return 1.18
  return 1.35
}

const ASOF = new Date().toISOString()

/**
 * Get the deterministic mock market snapshot for a card.
 * Returns null for collections we have not scoped market data to yet.
 */
export function getMockMarket(card: Card, collection: Collection): MarketSnapshot | null {
  if (collection !== 'one-piece') return null

  const seed = hash32(card.id)
  const r = rng(seed)
  const tier = tierFor(card)
  const boost = variantBoost(card)

  // Population: log-normal-ish around tier mean, with jitter.
  const popJ = 1 + (r() * 2 - 1) * tier.popJitter
  const psa10Pop = Math.max(3, Math.round(tier.popMean * popJ / boost))
  const psa9Pop = Math.round(psa10Pop * (1.4 + r() * 1.6))
  const totalGraded = psa10Pop + psa9Pop + Math.round(psa9Pop * (0.4 + r() * 0.5))

  // 30d pop delta: usually small, occasionally spiky.
  const popSpike = r() < 0.12
  const pop30dDelta = Math.round(
    (popSpike ? r() * 0.45 : r() * 0.08) * psa10Pop * (r() < 0.18 ? -1 : 1)
  )

  // PSA 10 median price: logspace between floor & ceil, biased by boost.
  const lf = Math.log(tier.priceFloor)
  const lc = Math.log(tier.priceCeil)
  const lp = lf + r() * (lc - lf)
  const psa10Median30d = Math.round(Math.exp(lp) * boost)

  // Lowest BIN sits 0.85..1.20x of median (sometimes undervalued, sometimes greedy).
  const binFactor = 0.85 + r() * 0.35
  const psa10LowestBin = Math.round(psa10Median30d * binFactor)

  // Raw price as a fraction of PSA 10 median.
  const rawMedian30d = Math.max(
    3,
    Math.round(psa10Median30d * tier.rawFactor * (0.7 + r() * 0.7))
  )

  // Active PSA 10 listings: scales sublinearly with pop, with floor.
  const activeListings = Math.max(0, Math.round(Math.log10(psa10Pop + 1) * (1.3 + r() * 2.8)))

  // Trend: roughly 40% flat, 35% up, 25% down. PSA 10 cards with pop spike skew down.
  const trendRoll = r()
  let priceTrend: MarketTrend
  if (popSpike && pop30dDelta > 0) {
    priceTrend = trendRoll < 0.65 ? 'down' : 'flat'
  } else if (trendRoll < 0.4) {
    priceTrend = 'flat'
  } else if (trendRoll < 0.75) {
    priceTrend = 'up'
  } else {
    priceTrend = 'down'
  }

  // Sleeper score: low pop + low active supply + raw-to-graded gap + uptrend - pop growth risk.
  const scarcity = 100 / (1 + Math.log10(psa10Pop + 1) * 1.6)    // 0..~60
  const thinSupply = activeListings <= 3 ? 22 : activeListings <= 6 ? 12 : 0
  const trendBoost = priceTrend === 'up' ? 18 : priceTrend === 'flat' ? 6 : 0
  const popRisk = Math.max(0, pop30dDelta) / Math.max(1, psa10Pop) * 60
  const raw = scarcity + thinSupply + trendBoost - popRisk
  const sleeperScore = Math.max(0, Math.min(100, Math.round(raw)))

  return {
    cardId: card.id,
    psa10Pop,
    psa9Pop,
    totalGraded,
    pop30dDelta,
    psa10LowestBin,
    psa10Median30d,
    rawMedian30d,
    activeListings,
    sleeperScore,
    priceTrend,
    asOf: ASOF,
    source: 'mock',
  }
}

/** USD with no decimals, compact for higher values. */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  if (n >= 10000) return `$${(n / 1000).toFixed(1)}k`
  return `$${n.toLocaleString('en-US')}`
}

/** Compact integer formatter. */
export function fmtNum(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '-'
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`
  return n.toLocaleString('en-US')
}

/* ─── Public-safe "Pulse" derivation ──────────────────────────────────
 *
 * The site never exposes raw PSA pop or eBay prices in the DOM. Instead
 * we publish a derived "Pulse" - a qualitative summary that captures the
 * shape of a card's market state without leaking the data we got from
 * vendor APIs. Pulse is the input for the Pulse Wall (tile auras) and
 * the lightbox Market Pulse panel.
 *
 * If we ever want to be even more conservative we can quantize further.
 */

export type Heat = 'cold' | 'cool' | 'neutral' | 'warm' | 'hot'
export type Scarcity = 'abundant' | 'common' | 'limited' | 'scarce' | 'rare'
export type Movement = 'falling' | 'soft' | 'steady' | 'climbing' | 'surging' | null
export type SupplyState = 'flooded' | 'available' | 'thin' | 'squeezed'

export interface Pulse {
  cardId: string
  heat: Heat              // composite "is this card on" right now
  scarcity: Scarcity      // graded supply, bucketed
  movement: Movement      // price action direction (null if no signal)
  supply: SupplyState     // live listing supply pressure
  /** 0..1 normalized for animation intensity (pulse speed/glow alpha). */
  intensity: number
  /** Hex color suggested for the tile aura. Derived from heat. */
  color: string
  /** Short qualitative phrase set, max 3, for the lightbox panel. */
  tags: string[]
  /**
   * Shape-only sparkline. 12 points in 0..1 range. We deliberately omit
   * any axis labels or absolute values when this gets rendered so the
   * picture reads as a wave, not as a price chart.
   */
  trend: number[]
}

const HEAT_COLOR: Record<Heat, string> = {
  cold:    '#5b8bd8',   // cool blue
  cool:    '#7aa3c8',
  neutral: '#9aa0a6',
  warm:    '#e8a23c',   // warm amber
  hot:     '#e85d2a',   // brand orange = on-fire
}

function scarcityFor(psa10Pop: number): Scarcity {
  if (psa10Pop <= 25) return 'rare'
  if (psa10Pop <= 75) return 'scarce'
  if (psa10Pop <= 200) return 'limited'
  if (psa10Pop <= 600) return 'common'
  return 'abundant'
}

function supplyFor(activeListings: number): SupplyState {
  if (activeListings <= 2) return 'squeezed'
  if (activeListings <= 6) return 'thin'
  if (activeListings <= 18) return 'available'
  return 'flooded'
}

function movementFor(
  trend: MarketTrend,
  pop30dDelta: number,
  psa10Pop: number,
): Movement {
  // Pop growing fast = supply catching up = soft signal even if price is flat.
  const popRisk = pop30dDelta / Math.max(1, psa10Pop)
  if (popRisk > 0.20) return 'falling'      // supply flood incoming
  if (trend === 'up' && popRisk < 0.05) return 'surging'
  if (trend === 'up') return 'climbing'
  if (trend === 'down') return 'soft'
  if (trend === 'flat') return 'steady'
  return null
}

/**
 * Compose a Pulse from raw inputs. Designed so a Pulse computed from a
 * MarketSnapshot today and a Pulse computed from real Supabase data
 * tomorrow are interchangeable.
 */
export function pulseFromSnapshot(s: MarketSnapshot): Pulse {
  const scarcity = scarcityFor(s.psa10Pop)
  const supply = supplyFor(s.activeListings)
  const movement = movementFor(s.priceTrend, s.pop30dDelta, s.psa10Pop)

  // Heat = a coarse aggregate of sleeperScore + scarcity + supply pressure.
  // We bucket so the wall does not animate every single tile.
  let heat: Heat
  if (s.sleeperScore >= 80) heat = 'hot'
  else if (s.sleeperScore >= 60) heat = 'warm'
  else if (s.sleeperScore >= 35) heat = 'neutral'
  else if (s.sleeperScore >= 18) heat = 'cool'
  else heat = 'cold'

  // Intensity drives animation speed. Hot cards pulse faster.
  const intensity = Math.max(0, Math.min(1, s.sleeperScore / 100))

  // Qualitative tags, max 3, ordered by salience.
  const tags: string[] = []
  if (scarcity === 'rare' || scarcity === 'scarce') tags.push(capitalize(scarcity))
  if (supply === 'squeezed' || supply === 'thin') tags.push('Thin supply')
  if (movement === 'surging') tags.push('Surging')
  else if (movement === 'climbing') tags.push('Heating')
  else if (movement === 'falling') tags.push('Supply flood')
  else if (movement === 'soft') tags.push('Cooling')
  if (tags.length === 0) tags.push('Steady')

  // Sparkline: deterministic shape from card id, biased by movement.
  const seed = hash32(s.cardId + ':spark')
  const r = rng(seed)
  const drift = movement === 'surging' ? 0.06
              : movement === 'climbing' ? 0.025
              : movement === 'falling' ? -0.05
              : movement === 'soft' ? -0.02
              : 0
  const trend: number[] = []
  let y = 0.45 + r() * 0.2
  for (let i = 0; i < 12; i++) {
    y += drift + (r() - 0.5) * 0.12
    y = Math.max(0.05, Math.min(0.95, y))
    trend.push(y)
  }

  return {
    cardId: s.cardId,
    heat,
    scarcity,
    movement,
    supply,
    intensity,
    color: HEAT_COLOR[heat],
    tags: tags.slice(0, 3),
    trend,
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
