import 'server-only'
import { getServiceClient } from '@/lib/tournament/supabase'
import { type Availability, sanitizeAvailability } from './availability'
import { type Region, sanitizeRegion } from '@/lib/tournament/region'
import { sanitizeCountry } from './country'

// ── Supabase client (service role - bypasses RLS) ─────────────────────────
// Wallet profiles live in the SAME project as the tournament tables
// (cardwall-tournaments) because wallet_profiles has a foreign key into the
// players table. Reuse the tournament service client so there is one trust
// boundary and one set of credentials.
function getSupabase() {
  return getServiceClient()
}

// ── Types ─────────────────────────────────────────────────────────────────

export interface WalletProfile {
  walletAddress: string
  username: string | null
  xHandle: string | null
  avatarUrl: string | null
  availability: Availability | null
  /** Coarse region for scheduling; pre-fills tournament sign-up. */
  region: Region | null
  /** Optional self-declared country (ISO 3166-1 alpha-2); shows as a flag. */
  country: string | null
  createdAt: string
  updatedAt: string
}

export interface WalletStanding extends WalletProfile {
  tournamentsPlayed: number
  wins: number
  losses: number
  draws: number
}

export interface UpdateProfileInput {
  username?: string | null
  xHandle?: string | null
  avatarUrl?: string | null
  availability?: Availability | null
  region?: Region | null
  country?: string | null
}

// ── Validation ─────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,20}$/
const X_HANDLE_RE = /^[a-zA-Z0-9_]{1,15}$/

export function validateUsername(value: string): string | null {
  if (!USERNAME_RE.test(value)) {
    return 'Username must be 3-20 characters: letters, numbers, _ or -'
  }
  return null
}

export function normalizeXHandle(value: string): string {
  return value.replace(/^@/, '').toLowerCase().trim()
}

export function validateXHandle(value: string): string | null {
  const normalized = normalizeXHandle(value)
  if (!X_HANDLE_RE.test(normalized)) {
    return 'X handle must be 1-15 alphanumeric characters or underscores'
  }
  return null
}

// ── Mappers ────────────────────────────────────────────────────────────────

function rowToProfile(row: Record<string, unknown>): WalletProfile {
  return {
    walletAddress: row.wallet_address as string,
    username: (row.username as string | null) ?? null,
    xHandle: (row.x_handle as string | null) ?? null,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    availability: sanitizeAvailability(row.availability),
    region: sanitizeRegion(row.region),
    country: sanitizeCountry(row.country),
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  }
}

function rowToStanding(row: Record<string, unknown>): WalletStanding {
  return {
    ...rowToProfile(row),
    tournamentsPlayed: Number(row.tournaments_played ?? 0),
    wins: Number(row.wins ?? 0),
    losses: Number(row.losses ?? 0),
    draws: Number(row.draws ?? 0),
  }
}

// ── Queries ────────────────────────────────────────────────────────────────

/** Get profile by wallet address. Returns null if not found. */
export async function getProfile(walletAddress: string): Promise<WalletProfile | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('wallet_profiles')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .maybeSingle()
  if (error) throw new Error(`getProfile: ${error.message}`)
  if (!data) return null
  return rowToProfile(data as Record<string, unknown>)
}

/** Upsert a wallet profile (creates on first sign-in). Returns the profile. */
export async function upsertProfile(walletAddress: string): Promise<WalletProfile> {
  const supabase = getSupabase()
  const addr = walletAddress.toLowerCase()
  const { data, error } = await supabase
    .from('wallet_profiles')
    .upsert({ wallet_address: addr }, { onConflict: 'wallet_address', ignoreDuplicates: true })
    .select()
    .maybeSingle()
  if (error) throw new Error(`upsertProfile: ${error.message}`)
  // If the row already existed, upsert with ignoreDuplicates returns nothing.
  // Fall back to a select.
  if (!data) return (await getProfile(addr))!
  return rowToProfile(data as Record<string, unknown>)
}

/** Update editable profile fields. Only provided fields are changed. */
export async function updateProfile(
  walletAddress: string,
  input: UpdateProfileInput,
): Promise<WalletProfile> {
  const supabase = getSupabase()
  const addr = walletAddress.toLowerCase()

  const patch: Record<string, unknown> = {}
  if ('username' in input) patch.username = input.username ?? null
  if ('xHandle' in input) patch.x_handle = input.xHandle ? normalizeXHandle(input.xHandle) : null
  if ('avatarUrl' in input) patch.avatar_url = input.avatarUrl ?? null
  if ('availability' in input) patch.availability = input.availability ? sanitizeAvailability(input.availability) : null
  if ('region' in input) patch.region = sanitizeRegion(input.region)
  if ('country' in input) patch.country = sanitizeCountry(input.country)

  if (Object.keys(patch).length === 0) {
    const existing = await getProfile(addr)
    if (!existing) throw new Error('Profile not found')
    return existing
  }

  const runUpdate = (p: Record<string, unknown>) =>
    supabase.from('wallet_profiles').update(p).eq('wallet_address', addr).select().single()

  let { data, error } = await runUpdate(patch)
  // Resilience for the migration window: if `country` doesn't exist yet
  // (migration 013 not applied), drop it and retry so the rest of the profile
  // still saves. Other fields all predate this column.
  if (error && 'country' in patch && /country/i.test(error.message)) {
    const { country: _omit, ...rest } = patch
    void _omit
    ;({ data, error } = await runUpdate(rest))
  }
  if (error) {
    if (error.code === '23505') throw new Error('That username is already taken')
    throw new Error(`updateProfile: ${error.message}`)
  }
  return rowToProfile(data as Record<string, unknown>)
}

/** Get standings with aggregated W/L for one wallet. */
export async function getStanding(walletAddress: string): Promise<WalletStanding | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('wallet_standings')
    .select('*')
    .eq('wallet_address', walletAddress.toLowerCase())
    .maybeSingle()
  if (error) throw new Error(`getStanding: ${error.message}`)
  if (!data) return null
  return rowToStanding(data as Record<string, unknown>)
}

/**
 * Get standings by X handle (case-insensitive, leading "@" tolerated). Used to
 * resolve a tournament bracket name (which only carries an X handle) into the
 * full public profile. Returns null if no wallet profile is linked to it.
 */
export async function getStandingByXHandle(xHandle: string): Promise<WalletStanding | null> {
  const handle = xHandle.trim().replace(/^@+/, '')
  if (!handle) return null
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('wallet_standings')
    .select('*')
    .ilike('x_handle', handle)
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`getStandingByXHandle: ${error.message}`)
  if (!data) return null
  return rowToStanding(data as Record<string, unknown>)
}

/** Get standings by username (case-insensitive). Returns null if not found. */
export async function getStandingByUsername(username: string): Promise<WalletStanding | null> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('wallet_standings')
    .select('*')
    .ilike('username', username)
    .maybeSingle()
  if (error) throw new Error(`getStandingByUsername: ${error.message}`)
  if (!data) return null
  return rowToStanding(data as Record<string, unknown>)
}

/** Get top N profiles by win count (global leaderboard). */
export async function getLeaderboard(limit = 50): Promise<WalletStanding[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('wallet_standings')
    .select('*')
    .not('username', 'is', null)
    .order('wins', { ascending: false })
    .order('tournaments_played', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`getLeaderboard: ${error.message}`)
  return (data ?? []).map((r) => rowToStanding(r as Record<string, unknown>))
}

// ── Prizes won ───────────────────────────────────────────────────────────────

/** One prize a wallet was actually awarded in a completed event. */
export interface WonPrize {
  id: string
  tournamentCode: string
  tournamentName: string
  game: string
  /** Final placement the prize was awarded for (1 = champion); null if unranked. */
  rank: number | null
  /** Prize title, e.g. "1st Place" or "Top 8". */
  title: string
  /** Context an image alone can't convey (shown on hover). */
  description: string
  /** Prize image (data URL / external URL); null for text-only prizes. */
  image: string | null
  awardedAt: string
}

/**
 * Every prize one wallet has won, newest first. Reads the immutable
 * awarded-prizes snapshot (never the live, still-changing pool). Resilient: a
 * missing table (migration 007 not yet applied) returns [] rather than
 * throwing, so profiles still render.
 */
export async function getPrizesWon(walletAddress: string): Promise<WonPrize[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('tournament_awarded_prizes')
    .select('id, rank, title, description, image, awarded_at, tournaments(code, name, game)')
    .eq('wallet_address', walletAddress.toLowerCase())
    .order('awarded_at', { ascending: false })
  if (error) return []
  const prizes: WonPrize[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const traw = row.tournaments
    const t = (Array.isArray(traw) ? traw[0] : traw) as Record<string, unknown> | null
    prizes.push({
      id: row.id as string,
      tournamentCode: (t?.code as string) ?? '',
      tournamentName: (t?.name as string) ?? 'Tournament',
      game: (t?.game as string) ?? '',
      rank: row.rank == null ? null : Number(row.rank),
      title: (row.title as string) ?? '',
      description: (row.description as string) ?? '',
      image: (row.image as string | null) ?? null,
      awardedAt: (row.awarded_at as string) ?? '',
    })
  }
  return prizes
}

// ── Earned badges (cosmetic awards shelf) ────────────────────────────────────

/** One awarded badge for a wallet. `badgeId` maps to the code-side catalog. */
export interface EarnedBadge {
  badgeId: string
  awardedAt: string
}

/**
 * All badge grants for one wallet. Resilient: a missing `profile_badges` table
 * (migration 014 not applied) returns [] rather than throwing, so profiles
 * still render. Ordering is left to the client (by catalog order).
 */
export async function getEarnedBadges(walletAddress: string): Promise<EarnedBadge[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('profile_badges')
    .select('badge_id, awarded_at')
    .eq('wallet_address', walletAddress.toLowerCase())
  if (error) return []
  return (data ?? []).map((r) => ({
    badgeId: (r as Record<string, unknown>).badge_id as string,
    awardedAt: ((r as Record<string, unknown>).awarded_at as string) ?? '',
  }))
}

/** One per-tournament badge a wallet earned by placement (dynamic, admin-made). */
export interface EarnedTournamentBadge {
  id: string
  tournamentCode: string
  rank: number | null
  title: string
  description: string
  image: string | null
  awardedAt: string
}

/**
 * Every per-tournament badge one wallet has been awarded, newest first. Reads
 * the immutable awarded-badges snapshot (never the live pool). Resilient: a
 * missing table (migration 015 not applied) returns [] so profiles still render.
 */
export async function getEarnedTournamentBadges(
  walletAddress: string,
): Promise<EarnedTournamentBadge[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('tournament_awarded_badges')
    .select('id, rank, title, description, image, awarded_at, tournaments(code)')
    .eq('wallet_address', walletAddress.toLowerCase())
    .order('awarded_at', { ascending: false })
  if (error) return []
  const out: EarnedTournamentBadge[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    const traw = row.tournaments
    const t = (Array.isArray(traw) ? traw[0] : traw) as Record<string, unknown> | null
    out.push({
      id: row.id as string,
      tournamentCode: (t?.code as string) ?? '',
      rank: row.rank == null ? null : Number(row.rank),
      title: (row.title as string) ?? '',
      description: (row.description as string) ?? '',
      image: (row.image as string | null) ?? null,
      awardedAt: (row.awarded_at as string) ?? '',
    })
  }
  return out
}

/** A standalone, hand-granted badge (not tied to any tournament). */
export interface ManualBadge {
  id: string
  title: string
  description: string
  image: string | null
  awardedAt: string
}

/**
 * Every standalone badge a wallet has been hand-granted, newest first. Reads
 * manual_awarded_badges (migration 019). Resilient: a missing table returns []
 * so profiles still render.
 */
export async function getManualBadges(walletAddress: string): Promise<ManualBadge[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('manual_awarded_badges')
    .select('id, title, description, image, awarded_at')
    .eq('wallet_address', walletAddress.toLowerCase())
    .order('awarded_at', { ascending: false })
  if (error) return []
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>
    return {
      id: row.id as string,
      title: (row.title as string) ?? '',
      description: (row.description as string) ?? '',
      image: (row.image as string | null) ?? null,
      awardedAt: (row.awarded_at as string) ?? '',
    }
  })
}

// ── Backfill: link existing tournament players to a wallet ──────────────────
//
// Players who signed up before wallet auth (or who enrolled with just their X
// handle) have a `players` row with an x_handle but no wallet_address, so their
// results do not roll up into the wallet leaderboard. When that person connects
// a wallet and sets the SAME X handle on their profile, we claim those rows by
// stamping the wallet_address onto every unclaimed player row with a matching
// handle. This makes their past + current tournament record count immediately.
//
// Returns the number of player rows linked. Safe to call repeatedly.

/** Link unclaimed player rows with the given X handle to a wallet address. */
export async function linkPlayersByXHandle(
  walletAddress: string,
  xHandle: string,
): Promise<number> {
  const supabase = getSupabase()
  const addr = walletAddress.toLowerCase()
  const handle = normalizeXHandle(xHandle)
  if (!handle) return 0

  const { data, error } = await supabase
    .from('players')
    .update({ wallet_address: addr })
    .eq('x_handle', handle)
    .is('wallet_address', null)
    .select('id')
  if (error) throw new Error(`linkPlayersByXHandle: ${error.message}`)

  // Also claim any prizes that were awarded to this handle before the wallet
  // existed. The awarded-prizes snapshot is frozen at award time, so its
  // wallet_address may be null even though the matching player row is now
  // linked; stamping it here makes the prize appear on the wallet's profile.
  // Best-effort: a missing table (migration 007 not applied) is ignored.
  try {
    await supabase
      .from('tournament_awarded_prizes')
      .update({ wallet_address: addr })
      .eq('x_handle', handle)
      .is('wallet_address', null)
  } catch (err) {
    console.error('linkPlayersByXHandle: prize backfill failed', err)
  }

  return (data ?? []).length
}

/**
 * Backfill a coarse region onto this wallet's tournament rows that are still
 * "Unspecified". Runs after a profile edit that sets a region, so legacy
 * waitlist entries and existing player rows (including pre-wallet sign-ups that
 * were just linked by handle) inherit it instead of staying null. Only fills
 * nulls - never overwrites a region a player already chose for a specific
 * event. Matches by wallet address and, as a safety net, by X handle for rows
 * not yet wallet-linked. Best-effort; returns how many rows were filled.
 */
export async function backfillRegionForWallet(
  walletAddress: string,
  xHandle: string | null,
  region: Region,
): Promise<{ players: number; waitlist: number }> {
  const supabase = getSupabase()
  const addr = walletAddress.toLowerCase()
  const handle = xHandle ? normalizeXHandle(xHandle) : null

  async function fillNulls(table: 'players' | 'tournament_waitlist'): Promise<number> {
    let filled = 0
    // By wallet first; rows it fills drop out of the handle pass below since
    // they're no longer null, so nothing is double-counted.
    const byWallet = await supabase
      .from(table)
      .update({ region })
      .is('region', null)
      .eq('wallet_address', addr)
      .select('id')
    filled += byWallet.data?.length ?? 0
    if (handle) {
      const byHandle = await supabase
        .from(table)
        .update({ region })
        .is('region', null)
        .eq('x_handle', handle)
        .select('id')
      filled += byHandle.data?.length ?? 0
    }
    return filled
  }

  const [players, waitlist] = await Promise.all([
    fillNulls('players'),
    fillNulls('tournament_waitlist'),
  ])
  return { players, waitlist }
}

/**
 * Admin backfill: link players by X handle to a wallet that already has that
 * handle on its profile. Used when reconciling a known participant manually.
 * Looks up the wallet by username so an operator can pass a friendly name.
 */
export async function backfillPlayerByUsername(username: string): Promise<number> {
  const profile = await getStandingByUsername(username)
  if (!profile) throw new Error(`No wallet profile with username "${username}"`)
  if (!profile.xHandle) throw new Error(`Profile "${username}" has no X handle to match on`)
  return linkPlayersByXHandle(profile.walletAddress, profile.xHandle)
}
