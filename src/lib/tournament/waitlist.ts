import 'server-only'
import { getServiceClient } from './supabase'
import { TournamentError } from './service'
import { generateToken, hashToken } from './tokens'
import { formatXLabel, isValidXHandle, normalizeXHandle } from './x-handle'

// ─────────────────────────────────────────────────────────────────────────
// Waitlist: wallet-backed "notify me for the next event" sign-ups.
//
// Joining requires a connected wallet (verified server-side via SIWE before
// the route calls in here). The X handle is pulled from the wallet profile, so
// there is nothing to retype. Entries are global - not tied to a tournament,
// because the next event does not exist yet. When the operator opens the next
// tournament, convertWaitlistToTournament() drops every pending entry into that
// event as a PENDING player (still subject to admin approval) and stamps the
// entry converted. All access is server-only via the service-role client.
// ─────────────────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  id: string
  xHandle: string
  walletAddress: string
  createdAt: string
}

/**
 * Add a wallet to the next-event waitlist using the X handle from its profile.
 * Idempotent: a wallet already waiting (or whose handle is already waiting)
 * returns alreadyOnList:true rather than erroring.
 */
export async function joinWaitlist(
  walletAddress: string,
  xHandleRaw: string,
): Promise<{ alreadyOnList: boolean }> {
  const addr = walletAddress.toLowerCase()
  const xHandle = normalizeXHandle(xHandleRaw)
  if (!isValidXHandle(xHandle)) {
    throw new TournamentError(
      'Add a valid X handle to your profile before joining the waitlist.',
    )
  }

  const sb = getServiceClient()

  // Already waiting on this wallet OR this handle? Treat as success.
  const { data: existing, error: lookupError } = await sb
    .from('tournament_waitlist')
    .select('id')
    .is('converted_at', null)
    .or(`wallet_address.eq.${addr},x_handle.eq.${xHandle}`)
    .maybeSingle()
  if (lookupError) throw new TournamentError(lookupError.message, 500)
  if (existing) return { alreadyOnList: true }

  const { error } = await sb.from('tournament_waitlist').insert({
    wallet_address: addr,
    x_handle: xHandle,
  })
  if (error) {
    // Unique-index race: a concurrent insert won the slot. Still "on the list".
    if (error.code === '23505') return { alreadyOnList: true }
    throw new TournamentError(`Could not join the waitlist: ${error.message}`, 500)
  }
  return { alreadyOnList: false }
}

/**
 * Public status probe: whether the waitlist backend is ready, how many are
 * waiting, and (when a wallet is supplied) whether that wallet is already on
 * the list. `available` is false (rather than a 500) when the table has not
 * been created yet (migration 005 not applied) or Supabase is unconfigured, so
 * the UI can hide the card cleanly until the backend is ready. Never throws.
 */
export async function waitlistStatus(
  walletAddress?: string | null,
): Promise<{ available: boolean; count: number; joined: boolean }> {
  let sb: ReturnType<typeof getServiceClient>
  try {
    sb = getServiceClient()
  } catch {
    return { available: false, count: 0, joined: false }
  }
  const { count, error } = await sb
    .from('tournament_waitlist')
    .select('id', { count: 'exact', head: true })
    .is('converted_at', null)
  if (error) {
    // 42P01 = undefined_table (migration not applied yet).
    return { available: false, count: 0, joined: false }
  }

  let joined = false
  if (walletAddress) {
    const { data } = await sb
      .from('tournament_waitlist')
      .select('id')
      .is('converted_at', null)
      .eq('wallet_address', walletAddress.toLowerCase())
      .maybeSingle()
    joined = Boolean(data)
  }

  return { available: true, count: count ?? 0, joined }
}

/** Admin: list everyone currently waiting (oldest first), with @ labels. */
export async function listWaitlist(): Promise<WaitlistEntry[]> {
  const sb = getServiceClient()
  const { data, error } = await sb
    .from('tournament_waitlist')
    .select('id, x_handle, wallet_address, created_at')
    .is('converted_at', null)
    .order('created_at', { ascending: true })
  if (error) throw new TournamentError(error.message, 500)
  return (data ?? []).map((r) => ({
    id: r.id as string,
    xHandle: formatXLabel(r.x_handle as string),
    walletAddress: r.wallet_address as string,
    createdAt: r.created_at as string,
  }))
}

/**
 * Auto-populate a freshly created tournament from the waitlist.
 *
 * For every pending entry we insert a PENDING player into the tournament (so
 * the operator's existing approve/decline step still gates every entry), then
 * stamp the waitlist row converted so it drops off the list. Wallet + handle
 * are carried onto the player row so results roll up to the player's wallet.
 *
 * Best-effort and defensive: it never throws (a waitlist hiccup must not block
 * tournament creation), skips handles already enrolled in this event, and
 * respects the tournament's player cap. Returns the number converted.
 */
export async function convertWaitlistToTournament(
  tournamentId: string,
  opts?: { maxPlayers?: number | null },
): Promise<number> {
  let sb: ReturnType<typeof getServiceClient>
  try {
    sb = getServiceClient()
  } catch {
    return 0
  }

  try {
    const { data: pending, error } = await sb
      .from('tournament_waitlist')
      .select('id, wallet_address, x_handle')
      .is('converted_at', null)
      .order('created_at', { ascending: true })
    if (error || !pending || pending.length === 0) return 0

    // Respect the cap and skip any handle somehow already in this event.
    const { data: existingPlayers } = await sb
      .from('players')
      .select('x_handle')
      .eq('tournament_id', tournamentId)
    const taken = new Set(
      (existingPlayers ?? [])
        .map((p) => (p.x_handle as string | null)?.toLowerCase())
        .filter(Boolean) as string[],
    )
    const cap = opts?.maxPlayers ?? null
    let slotsLeft = cap != null ? Math.max(0, cap - taken.size) : Infinity

    let converted = 0
    for (const entry of pending) {
      if (slotsLeft <= 0) break
      const handle = (entry.x_handle as string).toLowerCase()
      const nowIso = new Date().toISOString()

      if (taken.has(handle)) {
        // Already in this event - just retire the waitlist row.
        await sb
          .from('tournament_waitlist')
          .update({ converted_at: nowIso, converted_tournament_id: tournamentId })
          .eq('id', entry.id)
        continue
      }

      const playerToken = generateToken()
      const { error: insertErr } = await sb.from('players').insert({
        tournament_id: tournamentId,
        display_name: formatXLabel(handle),
        x_handle: handle,
        approval_status: 'pending',
        discord_handle: null,
        wallet_address: (entry.wallet_address as string) ?? null,
        player_token_hash: hashToken(playerToken),
      })
      if (insertErr) {
        // Skip this entry but keep going; leave it pending so it can retry.
        continue
      }

      await sb
        .from('tournament_waitlist')
        .update({ converted_at: nowIso, converted_tournament_id: tournamentId })
        .eq('id', entry.id)
      taken.add(handle)
      converted++
      slotsLeft--
    }
    return converted
  } catch {
    return 0
  }
}
