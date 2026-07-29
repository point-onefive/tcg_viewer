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
