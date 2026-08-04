'use client'

import type {
  CompletedTournamentSummary,
  PaidDeckAudit,
  PaidGameSummary,
  PaidNeedsAttention,
  Player,
  TournamentSnapshot,
} from './types'
import type { PollResults } from './poll'
import type { Region } from './region'

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

/**
 * Always-on paid tournaments lobby feed. Never throws; returns configuration
 * flags plus the open games so the lobby can render a "coming soon" empty state
 * when the backend/escrow isn't set up yet.
 */
export async function apiPaidGames(): Promise<{
  configured: boolean
  escrowConfigured: boolean
  games: PaidGameSummary[]
}> {
  try {
    const res = await fetch('/api/tournaments/play', { cache: 'no-store' })
    if (!res.ok) return { configured: false, escrowConfigured: false, games: [] }
    const data = (await res.json()) as {
      configured?: boolean
      escrowConfigured?: boolean
      games?: PaidGameSummary[]
    }
    return {
      configured: data.configured ?? false,
      escrowConfigured: data.escrowConfigured ?? false,
      games: data.games ?? [],
    }
  } catch {
    return { configured: false, escrowConfigured: false, games: [] }
  }
}

/**
 * Wallet-scoped "needs your action" feed for the paid lobby: paid games where
 * the connected wallet has a funded, un-refunded seat that is now refundable
 * (the game was cancelled). The server resolves the wallet from the session, so
 * there is no payload. Never throws; returns an empty list on any error or when
 * no wallet is connected.
 */
export async function apiRefundableStakes(): Promise<{ code: string; name: string }[]> {
  try {
    const res = await fetch('/api/tournaments/play/mine', { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { stakes?: { code: string; name: string }[] }
    return data.stakes ?? []
  } catch {
    return []
  }
}

/**
 * Confirm your on-chain USDC deposit for a paid game. Wallet-backed: the server
 * uses your signed-in wallet, so only the tx hash is sent. Returns the updated
 * player row (funded=true) once the deposit is verified on-chain.
 */
export async function apiVerifyDeposit(code: string, txHash: string): Promise<Player> {
  const data = await post<{ player: Player }>(
    `/api/tournaments/${encodeURIComponent(code)}/deposit-verify`,
    { txHash },
  )
  return data.player
}

/**
 * Public, unauthenticated deck-audit feed for a PAID game. Returns each
 * competitor's identity, final result, and (only once the event is complete)
 * their registered decklist. Throws for a free/featured tournament (the server
 * refuses to serve one), so callers should scope this to paid games.
 */
export async function apiPaidDeckAudit(code: string): Promise<PaidDeckAudit> {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(code)}/audit`, {
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Not found')
  return data as PaidDeckAudit
}

/**
 * Attach an OPTCG Sim battle log to a disputed paid match as evidence for the
 * organizer. Wallet-backed: the server identifies you from the signed-in wallet
 * session, so only the match id + the link/text are sent. Gated server-side to
 * participants of a disputed paid match.
 */
export async function apiAttachDisputeLog(
  code: string,
  matchId: string,
  evidence: { url?: string | null; text?: string | null },
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/dispute-log`, {
    matchId,
    url: evidence.url ?? null,
    text: evidence.text ?? null,
  })
}

/** Public archive of completed events, newest first. Never throws. */
export async function apiTournamentHistory(): Promise<CompletedTournamentSummary[]> {
  try {
    const res = await fetch('/api/tournaments/history', { cache: 'no-store' })
    if (!res.ok) return []
    const data = (await res.json()) as { tournaments?: CompletedTournamentSummary[] }
    return data.tournaments ?? []
  } catch {
    return []
  }
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
 * wallet's X handle from its profile. The deck list is the one required
 * payload - the player commits to it for the whole event.
 */
export async function apiEnroll(
  code: string,
  deckList: string,
  region?: string | null,
  joinPassword?: string,
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/enroll`, {
    deckList,
    region,
    // Only send when the player entered a code; harmless (ignored) when the
    // tournament has no join code set.
    ...(joinPassword ? { joinPassword } : {}),
  })
}

/**
 * Submit the signed-in player's deck list after entry (waitlist conversions).
 * Set-once on the server - it refuses to overwrite an existing list.
 */
export async function apiSubmitDeckList(code: string, deckList: string): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/deck`, { deckList })
}

/** Fetch the signed-in player's own deck list for this tournament. */
export async function apiOwnDeck(
  code: string,
): Promise<{ enrolled: boolean; deckList: string | null }> {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(code)}/deck`, {
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed')
  return data as { enrolled: boolean; deckList: string | null }
}

export interface DeckCheckResult {
  ok: boolean
  leaderCount: number
  deckCount: number
  unknownIds: string[]
  issues: string[]
}

/**
 * Advisory validation of a pasted deck list (resolves every code + checks the
 * 1-leader/50-card format). Read-only; used for the live pass/fail on the
 * sign-up form. Throws on the size-cap guard so the caller can surface it.
 */
export async function apiDeckCheck(deckList: string): Promise<DeckCheckResult> {
  return post('/api/tournaments/deck-check', { deckList })
}

// ── Next-event waitlist ─────────────────────────────────────────────────────

/**
 * Join the next-event waitlist. Wallet-backed: the server reads the signed-in
 * wallet's X handle from its profile, so there is no payload to send.
 */
export async function apiJoinWaitlist(region?: string | null): Promise<{ alreadyOnList: boolean }> {
  return post('/api/tournaments/waitlist', { region })
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
  awarded?: number
  ok?: boolean
  deckList?: string | null
  /** Raw shared join code, returned only by the admin `get-join-password` action. */
  joinPassword?: string | null
  /** Whether a join code is set, returned by `set-join-password`. */
  joinProtected?: boolean
  check?: { ok: boolean; leaderCount: number; deckCount: number; unknownIds: string[]; issues: string[] } | null
  results?: { playerId: string; hasDeck: boolean; ok: boolean; issues: string[] }[]
  matches?: { playerId: string; matchedLines: string[] }[]
  entries?: { id: string; xHandle: string; walletAddress: string; region: Region | null; createdAt: string }[]
  promoted?: boolean
  alreadyIn?: boolean
  removed?: boolean
  xHandle?: string
  recipients?: {
    walletAddress: string
    username: string | null
    xHandle: string | null
    avatarUrl: string | null
  }[]
  award?: ManualBadgeAward
  awards?: ManualBadgeAward[]
  /** Tx hash from an escrow write (cancel / refund / settle / pause). */
  txHash?: string | null
  /** Paid-mode "needs attention" payload. */
  attention?: PaidNeedsAttention
}> {
  return post('/api/tournaments/admin', body, adminKey)
}

/** A standalone (tournament-agnostic) badge award, as returned by the admin API. */
export interface ManualBadgeAward {
  id: string
  walletAddress: string
  username: string | null
  xHandle: string | null
  displayName: string | null
  title: string
  description: string
  image: string | null
  awardedAt: string
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

/**
 * Report your own match result. Wallet-backed: the server identifies you from
 * the signed-in wallet session, so only the match id and result are sent. When
 * both players agree the match auto-confirms; a conflict flags it for admin
 * review.
 */
export async function apiReportResult(
  code: string,
  matchId: string,
  result: 'win' | 'loss' | 'draw',
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/report`, { matchId, result })
}

/**
 * Drop yourself from a tournament. Wallet-backed: the server identifies you from
 * the signed-in wallet session. If the event is live, your current match is
 * forfeited so the round can still advance.
 */
export async function apiDropSelf(code: string): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/drop`, {})
}
