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

// ── Finalist badges ─────────────────────────────────────────────────────────

/** One podium finish (gold / silver / bronze) earned in a completed event. */
export interface TournamentBadge {
  /** Tournament code, used to open the event's final standings. */
  tournamentCode: string
  tournamentName: string
  game: string
  /** 1 = gold, 2 = silver, 3 = bronze. */
  rank: number
  /** Field size the bracket finished with (for "2nd of 16"). */
  playersCount: number
  /** When the event was created (used only for ordering, newest first). */
  awardedAt: string
}

/**
 * All podium (top-3) finishes for one wallet, newest first. `final_rank` is only
 * ever set on completed tournaments, so it doubles as the "this event finished"
 * flag - no status join needed. Resilient: a missing placements column
 * (migration 006 not yet applied) returns an empty list rather than throwing,
 * so profiles still render.
 */
export async function getBadges(walletAddress: string): Promise<TournamentBadge[]> {
  const supabase = getSupabase()
  const { data, error } = await supabase
    .from('players')
    .select('final_rank, final_players, tournaments(code, name, game, created_at)')
    .eq('wallet_address', walletAddress.toLowerCase())
    .not('final_rank', 'is', null)
    .lte('final_rank', 3)
  if (error) return []
  const badges: TournamentBadge[] = []
  for (const row of (data ?? []) as Record<string, unknown>[]) {
    // Supabase returns the embedded relation as an object (or array on some
    // driver versions); normalize to a single record.
    const traw = row.tournaments
    const t = (Array.isArray(traw) ? traw[0] : traw) as Record<string, unknown> | null
    if (!t?.code) continue
    badges.push({
      tournamentCode: t.code as string,
      tournamentName: (t.name as string) ?? 'Tournament',
      game: (t.game as string) ?? '',
      rank: Number(row.final_rank),
      playersCount: Number(row.final_players ?? 0),
      awardedAt: (t.created_at as string) ?? '',
    })
  }
  badges.sort((a, b) => (a.awardedAt < b.awardedAt ? 1 : a.awardedAt > b.awardedAt ? -1 : a.rank - b.rank))
  return badges
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
