// Shared (client + server) constants and helpers for paid tournaments. Mirrors
// the locked parameters in docs/paid-tournaments-escrow.md and the contract's
// payout presets. No 'server-only' here so the admin form and the lobby can
// import the labels/presets too.

export type PayoutPreset = 'wta' | 'top3' | 'top6' | 'top8'

/** Post-rake split in basis points (sums to 10000), matching the contract. */
export const PAYOUT_PRESETS: Record<PayoutPreset, number[]> = {
  wta: [10000],
  top3: [5000, 3000, 2000],
  top6: [4000, 2200, 1400, 1000, 800, 600],
  top8: [3300, 2000, 1400, 1000, 800, 600, 500, 400],
}

export const PAYOUT_PRESET_LABELS: Record<PayoutPreset, string> = {
  wta: 'Winner take all',
  top3: 'Top 3 (50 / 30 / 20)',
  top6: 'Top 6',
  top8: 'Top 8',
}

/** v1 defaults. Entry is stored per game in 6-decimal USDC units. */
export const DEFAULT_ENTRY_FEE_USDC = 10_000_000 // $10
export const DEFAULT_RAKE_BPS = 1500 // 15%
export const MAX_RAKE_BPS = 2000 // must match the contract cap
export const BPS_DENOMINATOR = 10_000

export function isPayoutPreset(x: unknown): x is PayoutPreset {
  return typeof x === 'string' && x in PAYOUT_PRESETS
}

export function payoutBpsForPreset(p: PayoutPreset): number[] {
  return PAYOUT_PRESETS[p]
}

/** Number of paid places for a preset (its payout depth). */
export function payoutDepth(p: PayoutPreset): number {
  return PAYOUT_PRESETS[p].length
}

/** Format 6-decimal USDC units as a dollar string ($10 or $12.50). */
export function formatUsdc(units: number | null | undefined): string {
  if (units == null) return '-'
  const dollars = units / 1_000_000
  return `$${Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2)}`
}

// ── Wallet reliability (P1 autopilot / fairness) ───────────────────────────
// A cross-tournament, wallet-keyed attendance reputation. Counters accumulate
// across every paid event the wallet plays; the score is a derived 0..100 value.
// See supabase/migrations/021_paid_autopilot.sql for the backing table. Pure /
// framework-free so both the server (service.ts, reliability.ts) and the client
// (admin approval queue) can import the shape + formula.

/** Raw counters mirrored from the wallet_reliability row. */
export interface ReliabilityCounters {
  matchesPlayed: number
  matchesOnTime: number
  noShows: number
  doubleForfeits: number
  cleanDrops: number
  disputesLost: number
}

/** A wallet's reliability: counters + the derived score (null = neutral). */
export interface WalletReliability extends ReliabilityCounters {
  walletAddress: string
  /** 0..100, or null when there is nothing to score yet (0 matches played). */
  score: number | null
}

export const EMPTY_RELIABILITY_COUNTERS: ReliabilityCounters = {
  matchesPlayed: 0,
  matchesOnTime: 0,
  noShows: 0,
  doubleForfeits: 0,
  cleanDrops: 0,
  disputesLost: 0,
}

/** Points knocked off the score per recorded no-show (serial ghosting craters). */
export const RELIABILITY_NO_SHOW_PENALTY = 15

/**
 * Deterministic reliability score in [0, 100], or null for a wallet that has
 * played nothing yet (fresh accounts start neutral, never penalized).
 *
 * Formula (documented so it stays stable across cron + lazy-on-read runs):
 *   score = clamp( round(100 * matchesOnTime / matchesPlayed)
 *                    - RELIABILITY_NO_SHOW_PENALTY * noShows,
 *                  0, 100 )
 *
 * A strong-attendance player barely feels one lapse; a serial no-show craters.
 * A double_forfeit counts as a played-not-on-time match for both sides (it drags
 * the on-time ratio) but carries no extra per-no-show penalty on its own, so a
 * single "both silent" round is gentle - matching the locked design.
 */
export function computeReliabilityScore(c: ReliabilityCounters): number | null {
  if (!c || c.matchesPlayed <= 0) return null
  const onTimeRatio = Math.max(0, Math.min(1, c.matchesOnTime / c.matchesPlayed))
  const raw = Math.round(100 * onTimeRatio) - RELIABILITY_NO_SHOW_PENALTY * Math.max(0, c.noShows)
  return Math.max(0, Math.min(100, raw))
}

// Soft floor for the paid-enroll gate (Decision 2: repeat offenders go to a
// manual approval the operator already runs). A wallet is blocked from paid
// lobbies ONLY when it is clearly a serial offender: at least this many no-shows
// AND a score below this floor. Unknown / absent reliability never blocks.
export const RELIABILITY_GATE_MAX_NO_SHOWS = 3
export const RELIABILITY_GATE_MIN_SCORE = 30

/** True when a wallet's reliability is bad enough to block a paid enroll. */
export function isReliabilityBlocked(r: WalletReliability | null | undefined): boolean {
  if (!r) return false
  if (r.score == null) return false
  return r.noShows >= RELIABILITY_GATE_MAX_NO_SHOWS && r.score < RELIABILITY_GATE_MIN_SCORE
}
