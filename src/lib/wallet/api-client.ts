'use client'

// Client-side API helpers for wallet auth endpoints.
// These are thin fetch wrappers - all actual logic lives in the API routes.

import type { WalletProfile, WalletStanding } from './db'
import type { Availability } from './availability'
import type { Region } from '@/lib/tournament/region'

export type { WalletProfile, WalletStanding }

// ── Auth flow ──────────────────────────────────────────────────────────────

/** Step 1: Fetch a server-issued nonce for the SIWE message. */
export async function fetchNonce(): Promise<string> {
  const res = await fetch('/api/auth/nonce', { cache: 'no-store' })
  const data = await res.json().catch(() => ({})) as { nonce?: string; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch nonce')
  return data.nonce!
}

/** Step 2: Send the signed SIWE message to the server for verification. */
export async function verifyWallet(message: string, signature: string): Promise<WalletProfile> {
  const res = await fetch('/api/auth/verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, signature }),
  })
  const data = await res.json().catch(() => ({})) as { profile?: WalletProfile; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Verification failed')
  return data.profile!
}

// ── Session ────────────────────────────────────────────────────────────────

/** Get the current session's profile + standings. Returns null if not logged in. */
export async function fetchMe(): Promise<WalletStanding | null> {
  try {
    const res = await fetch('/api/auth/me', { cache: 'no-store' })
    if (res.status === 401 || res.status === 404) return null
    const data = await res.json().catch(() => ({})) as { standing?: WalletStanding }
    return data.standing ?? null
  } catch {
    return null
  }
}

/** Sign out - clears the session cookie. */
export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
}

// ── Profile updates ────────────────────────────────────────────────────────

export interface UpdateProfileInput {
  username?: string | null
  xHandle?: string | null
  avatarUrl?: string | null
  availability?: Availability | null
  region?: Region | null
}

/** Update editable profile fields. Throws on error. */
export async function updateProfile(input: UpdateProfileInput): Promise<WalletProfile> {
  const res = await fetch('/api/auth/profile', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  const data = await res.json().catch(() => ({})) as { profile?: WalletProfile; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to update profile')
  return data.profile!
}

// ── Leaderboard ────────────────────────────────────────────────────────────

/** Fetch the global leaderboard. Public - no auth required. */
export async function fetchLeaderboard(limit = 50): Promise<WalletStanding[]> {
  const res = await fetch(`/api/auth/leaderboard?limit=${limit}`, { cache: 'no-store' })
  const data = await res.json().catch(() => ({})) as { standings?: WalletStanding[]; error?: string }
  if (!res.ok) throw new Error(data.error ?? 'Failed to fetch leaderboard')
  return data.standings ?? []
}

/**
 * Resolve a public profile from an X handle (used by the tournament bracket).
 * Returns null when the handle has no linked wallet profile.
 */
export async function fetchProfileByHandle(xHandle: string): Promise<WalletStanding | null> {
  try {
    const res = await fetch(`/api/auth/profile-lookup?handle=${encodeURIComponent(xHandle)}`, { cache: 'no-store' })
    if (!res.ok) return null
    const data = await res.json().catch(() => ({})) as { standing?: WalletStanding | null }
    return data.standing ?? null
  } catch {
    return null
  }
}
