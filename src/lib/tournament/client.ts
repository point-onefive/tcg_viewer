'use client'

import type { TournamentSnapshot } from './types'
import type { PollResults } from './poll'

const ADMIN_KEY = 'tcw_tournament_admin_key'
const VOTER_ID_KEY = 'tcw_tournament_voter_id'
const VOTED_PREFIX = 'tcw_tournament_voted_'

export function loadAdminKey(): string {
  if (typeof window === 'undefined') return ''
  try {
    return localStorage.getItem(ADMIN_KEY) ?? ''
  } catch {
    return ''
  }
}

export function saveAdminKey(key: string): void {
  try {
    localStorage.setItem(ADMIN_KEY, key)
  } catch {
    /* ignore */
  }
}

export function clearAdminKey(): void {
  try {
    localStorage.removeItem(ADMIN_KEY)
  } catch {
    /* ignore */
  }
}

async function post<T>(url: string, body: unknown, adminKey?: string): Promise<T> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (adminKey) headers.authorization = `Bearer ${adminKey}`
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed')
  return data as T
}

export async function apiActiveSnapshot(): Promise<TournamentSnapshot> {
  const res = await fetch('/api/tournaments/active', { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Not found')
  return data as TournamentSnapshot
}

/** Public snapshot for any tournament by code (used by finalist badges). */
export async function apiSnapshotByCode(code: string): Promise<TournamentSnapshot> {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(code)}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Not found')
  return data as TournamentSnapshot
}

/** Live/enrolling probe for the global header badge. Never throws. */
export async function apiActiveStatus(): Promise<{ live: boolean; status?: string }> {
  try {
    const res = await fetch('/api/tournaments/active/status', { cache: 'no-store' })
    if (!res.ok) return { live: false }
    return (await res.json()) as { live: boolean; status?: string }
  } catch {
    return { live: false }
  }
}

/**
 * Sign up for a tournament. Wallet-backed: the server reads the signed-in
 * wallet's X handle from its profile, so there is no payload to send.
 */
export async function apiEnroll(code: string): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/enroll`, {})
}

// ── Next-event waitlist ─────────────────────────────────────────────────────

/**
 * Join the next-event waitlist. Wallet-backed: the server reads the signed-in
 * wallet's X handle from its profile, so there is no payload to send.
 */
export async function apiJoinWaitlist(): Promise<{ alreadyOnList: boolean }> {
  return post('/api/tournaments/waitlist', {})
}

/**
 * Public waitlist status: whether the backend is live, how many are waiting,
 * and whether the signed-in wallet is already on the list. Never throws.
 */
export async function apiWaitlistStatus(): Promise<{
  available: boolean
  count: number
  joined: boolean
}> {
  try {
    const res = await fetch('/api/tournaments/waitlist', { cache: 'no-store' })
    if (!res.ok) return { available: false, count: 0, joined: false }
    const data = (await res.json()) as {
      available?: boolean
      count?: number
      joined?: boolean
    }
    return {
      available: data.available ?? false,
      count: data.count ?? 0,
      joined: data.joined ?? false,
    }
  } catch {
    return { available: false, count: 0, joined: false }
  }
}

export async function adminApi(
  adminKey: string,
  body: Record<string, unknown>,
): Promise<{
  code?: string
  approved?: number
  count?: number
  ok?: boolean
  entries?: { id: string; xHandle: string; walletAddress: string; createdAt: string }[]
}> {
  return post('/api/tournaments/admin', body, adminKey)
}

// ── Prize-distribution poll ────────────────────────────────────────────────

/**
 * Stable, per-browser anonymous id used to dedupe poll votes (phase C). Minted
 * once and reused across tournaments - dedupe is per (tournament, voter), so
 * the same browser can vote again on the next event.
 */
export function loadVoterId(): string {
  if (typeof window === 'undefined') return ''
  try {
    let id = localStorage.getItem(VOTER_ID_KEY)
    if (!id) {
      id =
        typeof crypto !== 'undefined' && 'randomUUID' in crypto
          ? crypto.randomUUID()
          : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
      localStorage.setItem(VOTER_ID_KEY, id)
    }
    return id
  } catch {
    return ''
  }
}

/** Which option this browser already voted for in a given tournament, if any. */
export function loadVotedChoice(code: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem(VOTED_PREFIX + code)
  } catch {
    return null
  }
}

export function saveVotedChoice(code: string, choice: string): void {
  try {
    localStorage.setItem(VOTED_PREFIX + code, choice)
  } catch {
    /* ignore */
  }
}

export async function apiCastVote(voterId: string, choice: string): Promise<PollResults> {
  const data = await post<{ poll: PollResults }>('/api/tournaments/poll', { voterId, choice })
  return data.poll
}
