import 'server-only'
import { getServiceClient } from './supabase'
import { TournamentError } from './service'
import { formatXLabel, isValidXHandle, normalizeXHandle } from './x-handle'

// ─────────────────────────────────────────────────────────────────────────
// Waitlist: frictionless "notify me for the next event" sign-ups.
//
// Separate from the live tournament `players` table on purpose - a waitlist
// entry is just an X handle with no tournament attached, collected while one
// event runs (or between events). The operator pulls the list when opening the
// next tournament. All access is server-only via the service-role client.
// ─────────────────────────────────────────────────────────────────────────

export interface WaitlistEntry {
  id: string
  xHandle: string
  walletAddress: string | null
  createdAt: string
}

/** Add a handle to the next-event waitlist. Idempotent for a pending handle. */
export async function joinWaitlist(
  xHandleRaw: string,
  walletAddress?: string | null,
): Promise<{ alreadyOnList: boolean }> {
  const xHandle = normalizeXHandle(xHandleRaw)
  if (!isValidXHandle(xHandle)) {
    throw new TournamentError(
      'Enter a valid X handle (letters, numbers, underscore - no @ needed).',
    )
  }

  const sb = getServiceClient()

  // Already waiting? Treat as success so the button never errors on a repeat.
  const { data: existing, error: lookupError } = await sb
    .from('tournament_waitlist')
    .select('id')
    .ilike('x_handle', xHandle)
    .is('converted_at', null)
    .maybeSingle()
  if (lookupError) throw new TournamentError(lookupError.message, 500)
  if (existing) return { alreadyOnList: true }

  const { error } = await sb.from('tournament_waitlist').insert({
    x_handle: xHandle,
    wallet_address: walletAddress ? walletAddress.toLowerCase() : null,
  })
  if (error) {
    // Unique-index race: someone inserted the same handle a beat earlier.
    if (error.code === '23505') return { alreadyOnList: true }
    throw new TournamentError(`Could not join the waitlist: ${error.message}`, 500)
  }
  return { alreadyOnList: false }
}

/**
 * Public status probe: whether the waitlist backend is ready and how many are
 * waiting. `available` is false (rather than a 500) when the table has not been
 * created yet (migration 005 not applied) or Supabase is unconfigured, so the
 * UI can hide the card cleanly until the backend is ready. Never throws.
 */
export async function waitlistStatus(): Promise<{ available: boolean; count: number }> {
  let sb: ReturnType<typeof getServiceClient>
  try {
    sb = getServiceClient()
  } catch {
    return { available: false, count: 0 }
  }
  const { count, error } = await sb
    .from('tournament_waitlist')
    .select('id', { count: 'exact', head: true })
    .is('converted_at', null)
  if (error) {
    // 42P01 = undefined_table (migration not applied yet).
    return { available: false, count: 0 }
  }
  return { available: true, count: count ?? 0 }
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
    walletAddress: (r.wallet_address as string | null) ?? null,
    createdAt: r.created_at as string,
  }))
}
