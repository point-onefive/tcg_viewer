import 'server-only'
import { getServiceClient } from './supabase'
import {
  computeReliabilityScore,
  EMPTY_RELIABILITY_COUNTERS,
  type ReliabilityCounters,
  type WalletReliability,
} from './paid'

// ─────────────────────────────────────────────────────────────────────────
// Wallet reliability data access (P1 autopilot / fairness).
//
// Backed by the wallet_reliability table (migration 021). EVERY read and write
// here is BEST-EFFORT: if the table is missing (migration not applied yet) or a
// query fails, we treat reliability as absent/neutral and never throw. That
// keeps the app fully functional before 021 lands on the DB.
//
// Idempotency: counters must only be incremented on the actual unresolved ->
// resolved match transition. That transition is guarded by the caller (a
// conditional match UPDATE in enforceRoundDeadlines that only one racing runner
// can win), so `bumpReliability` itself just applies the delta the caller
// already earned the right to write. A wallet plays at most one match per round
// and only the current round is enforced, so no wallet is bumped concurrently
// for two different matches.
// ─────────────────────────────────────────────────────────────────────────

const TABLE = 'wallet_reliability'

function normalizeWallet(wallet: string | null | undefined): string | null {
  const w = (wallet ?? '').trim().toLowerCase()
  return /^0x[0-9a-f]{40}$/.test(w) ? w : null
}

function rowToReliability(wallet: string, r: Record<string, unknown> | null): WalletReliability {
  const counters: ReliabilityCounters = {
    matchesPlayed: Number(r?.matches_played ?? 0) || 0,
    matchesOnTime: Number(r?.matches_on_time ?? 0) || 0,
    noShows: Number(r?.no_shows ?? 0) || 0,
    doubleForfeits: Number(r?.double_forfeits ?? 0) || 0,
    cleanDrops: Number(r?.clean_drops ?? 0) || 0,
    disputesLost: Number(r?.disputes_lost ?? 0) || 0,
  }
  const score = r?.score != null ? Number(r.score) : computeReliabilityScore(counters)
  return { walletAddress: wallet, ...counters, score }
}

/**
 * Read one wallet's reliability. Returns null when the wallet is unknown, has
 * no row yet, has an invalid address, or the table is unavailable (pre-migration).
 * A null result must be treated as NEUTRAL by callers (never a penalty / block).
 */
export async function getReliability(wallet: string | null | undefined): Promise<WalletReliability | null> {
  const addr = normalizeWallet(wallet)
  if (!addr) return null
  try {
    const sb = getServiceClient()
    const { data, error } = await sb
      .from(TABLE)
      .select('*')
      .eq('wallet_address', addr)
      .maybeSingle()
    if (error || !data) return null
    return rowToReliability(addr, data as Record<string, unknown>)
  } catch {
    return null
  }
}

/**
 * Batch reliability lookup keyed by lowercased wallet address. Best-effort: any
 * failure yields an empty map (all wallets read as neutral). Used to enrich the
 * paid snapshot / admin approval queue in one round-trip.
 */
export async function getReliabilityMany(
  wallets: (string | null | undefined)[],
): Promise<Map<string, WalletReliability>> {
  const out = new Map<string, WalletReliability>()
  const addrs = [...new Set(wallets.map(normalizeWallet).filter((a): a is string => !!a))]
  if (addrs.length === 0) return out
  try {
    const sb = getServiceClient()
    const { data, error } = await sb.from(TABLE).select('*').in('wallet_address', addrs)
    if (error || !data) return out
    for (const r of data as Record<string, unknown>[]) {
      const w = normalizeWallet(r.wallet_address as string)
      if (w) out.set(w, rowToReliability(w, r))
    }
  } catch {
    /* table missing / transient: everyone reads neutral */
  }
  return out
}

/** A signed set of counter increments applied atomically to one wallet's row. */
export interface ReliabilityDelta {
  matchesPlayed?: number
  matchesOnTime?: number
  noShows?: number
  doubleForfeits?: number
  cleanDrops?: number
  disputesLost?: number
}

/**
 * Apply a counter delta to a wallet's reliability row (creating it if absent),
 * recompute and store the derived score, and stamp updated_at. BEST-EFFORT: a
 * missing table or any error is swallowed (returns null) so a fairness write can
 * never break the surrounding match-resolution path. Callers must only invoke
 * this once per earned transition (see the module-level idempotency note).
 */
export async function bumpReliability(
  wallet: string | null | undefined,
  delta: ReliabilityDelta,
): Promise<WalletReliability | null> {
  const addr = normalizeWallet(wallet)
  if (!addr) return null
  try {
    const sb = getServiceClient()
    const { data: existing, error: readErr } = await sb
      .from(TABLE)
      .select('*')
      .eq('wallet_address', addr)
      .maybeSingle()
    if (readErr) return null // table missing / unreadable -> no-op

    const base = existing
      ? rowToReliability(addr, existing as Record<string, unknown>)
      : { walletAddress: addr, ...EMPTY_RELIABILITY_COUNTERS, score: null }

    const next: ReliabilityCounters = {
      matchesPlayed: base.matchesPlayed + (delta.matchesPlayed ?? 0),
      matchesOnTime: base.matchesOnTime + (delta.matchesOnTime ?? 0),
      noShows: base.noShows + (delta.noShows ?? 0),
      doubleForfeits: base.doubleForfeits + (delta.doubleForfeits ?? 0),
      cleanDrops: base.cleanDrops + (delta.cleanDrops ?? 0),
      disputesLost: base.disputesLost + (delta.disputesLost ?? 0),
    }
    const score = computeReliabilityScore(next)
    const { error: upErr } = await sb.from(TABLE).upsert(
      {
        wallet_address: addr,
        matches_played: next.matchesPlayed,
        matches_on_time: next.matchesOnTime,
        no_shows: next.noShows,
        double_forfeits: next.doubleForfeits,
        clean_drops: next.cleanDrops,
        disputes_lost: next.disputesLost,
        score,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'wallet_address' },
    )
    if (upErr) return null
    return { walletAddress: addr, ...next, score }
  } catch {
    return null
  }
}
