import 'server-only'
import { getServiceClient } from '@/lib/tournament/supabase'

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

  if (Object.keys(patch).length === 0) {
    const existing = await getProfile(addr)
    if (!existing) throw new Error('Profile not found')
    return existing
  }

  const { data, error } = await supabase
    .from('wallet_profiles')
    .update(patch)
    .eq('wallet_address', addr)
    .select()
    .single()
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
