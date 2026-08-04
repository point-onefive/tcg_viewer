import 'server-only'
import { getServiceClient } from './supabase'

// ─────────────────────────────────────────────────────────────────────────
// Pragmatic, DB-backed rate limiter for the public enroll route. Counts recent
// enroll attempts per wallet and per IP in a short sliding window (see the
// enroll_attempts table, migration 023) and blocks obvious bursts with a 429.
//
// DB-backed rather than in-memory so the limit holds across serverless
// instances (a per-instance Map would reset on every cold start and not be
// shared between concurrent lambdas). Best-effort by design: if the table is
// missing (pre-migration) or a query fails, we ALLOW the enroll so the limiter
// can never take down sign-ups. The thresholds are generous enough that a
// legitimate person signing up for one - or even a handful - of paid games in
// parallel is never blocked; they only trip on spammy automation.
// ─────────────────────────────────────────────────────────────────────────

// Per-wallet: a real user might join a few lobbies in a minute, so keep this
// comfortably above normal behavior while still blocking scripted floods.
const WALLET_LIMIT = 8
const WALLET_WINDOW_SECONDS = 60

// Per-IP: covers a NAT / shared network (several people on one IP) while still
// stopping a single host from hammering the endpoint.
const IP_LIMIT = 30
const IP_WINDOW_SECONDS = 300

export interface EnrollRateLimitInput {
  wallet?: string | null
  ip?: string | null
}

export interface RateLimitResult {
  ok: boolean
  retryAfterSeconds?: number
  reason?: string
}

async function countSince(
  column: 'wallet_address' | 'ip',
  value: string,
  windowSeconds: number,
): Promise<number> {
  const sb = getServiceClient()
  const since = new Date(Date.now() - windowSeconds * 1000).toISOString()
  const { count, error } = await sb
    .from('enroll_attempts')
    .select('id', { count: 'exact', head: true })
    .eq(column, value)
    .gte('created_at', since)
  if (error) throw error
  return count ?? 0
}

/**
 * Record this enroll attempt and decide whether it is over the limit. Records
 * FIRST (so even rejected/hammered attempts count against the window), then
 * checks both the per-wallet and per-IP sliding windows. Returns { ok: true }
 * on any internal failure so a limiter problem never blocks a real sign-up.
 */
export async function checkAndRecordEnroll(
  input: EnrollRateLimitInput,
): Promise<RateLimitResult> {
  const wallet = input.wallet ? input.wallet.toLowerCase() : null
  const ip = input.ip ? input.ip.trim() : null
  if (!wallet && !ip) return { ok: true }

  try {
    const sb = getServiceClient()
    await sb.from('enroll_attempts').insert({ wallet_address: wallet, ip })

    if (wallet) {
      const walletCount = await countSince('wallet_address', wallet, WALLET_WINDOW_SECONDS)
      if (walletCount > WALLET_LIMIT) {
        return {
          ok: false,
          retryAfterSeconds: WALLET_WINDOW_SECONDS,
          reason: 'Too many sign-up attempts from this wallet. Please wait a minute and try again.',
        }
      }
    }
    if (ip) {
      const ipCount = await countSince('ip', ip, IP_WINDOW_SECONDS)
      if (ipCount > IP_LIMIT) {
        return {
          ok: false,
          retryAfterSeconds: IP_WINDOW_SECONDS,
          reason:
            'Too many sign-up attempts from this network. Please wait a few minutes and try again.',
        }
      }
    }
    return { ok: true }
  } catch {
    // Table missing (pre-migration) or a transient DB error: never block a
    // legitimate enroll on the rate limiter.
    return { ok: true }
  }
}

/** Best-effort client IP from the standard proxy headers (Vercel sets these). */
export function clientIpFromRequest(request: Request): string | null {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  return request.headers.get('x-real-ip')?.trim() || null
}
