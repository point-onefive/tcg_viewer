'use client'

import type {
  CreateTournamentInput,
  CreateTournamentResult,
  EnrollResult,
  ReportedResult,
  TournamentSnapshot,
} from './types'

// ─────────────────────────────────────────────────────────────────────────
// Browser-side API client + local identity store. The host/player tokens are
// the only proof of identity, so we persist them in localStorage keyed by the
// tournament code. Losing localStorage = losing access (by design — it keeps
// the tool account-free). Tokens are also surfaced as copyable links so a
// user can re-bookmark them.
// ─────────────────────────────────────────────────────────────────────────

export interface StoredIdentity {
  hostToken?: string
  playerToken?: string
  playerId?: string
  playerName?: string
}

const KEY = (code: string) => `tcw_tournament_${code.toUpperCase()}`

export function loadIdentity(code: string): StoredIdentity {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(KEY(code))
    return raw ? (JSON.parse(raw) as StoredIdentity) : {}
  } catch {
    return {}
  }
}

export function saveIdentity(code: string, patch: Partial<StoredIdentity>): StoredIdentity {
  const next = { ...loadIdentity(code), ...patch }
  try {
    localStorage.setItem(KEY(code), JSON.stringify(next))
  } catch {
    /* private mode / quota — non-fatal */
  }
  return next
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Request failed')
  return data as T
}

export async function apiCreate(input: CreateTournamentInput): Promise<CreateTournamentResult> {
  return post('/api/tournaments', input)
}

export async function apiSnapshot(code: string): Promise<TournamentSnapshot> {
  const res = await fetch(`/api/tournaments/${encodeURIComponent(code)}`, {
    cache: 'no-store',
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Not found')
  return data as TournamentSnapshot
}

export async function apiEnroll(
  code: string,
  displayName: string,
  discordHandle?: string,
): Promise<EnrollResult> {
  return post(`/api/tournaments/${encodeURIComponent(code)}/enroll`, {
    displayName,
    discordHandle,
  })
}

export async function apiClose(code: string, hostToken: string): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/close`, { hostToken })
}

export async function apiReport(
  code: string,
  matchId: string,
  playerToken: string,
  result: ReportedResult,
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/report`, {
    matchId,
    playerToken,
    result,
  })
}

export async function apiOverride(
  code: string,
  hostToken: string,
  matchId: string,
  winnerId: string | null,
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/override`, {
    hostToken,
    matchId,
    winnerId,
  })
}

export async function apiProposeSchedule(
  code: string,
  matchId: string,
  playerToken: string,
  slots: string[],
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/schedule`, {
    action: 'propose',
    matchId,
    playerToken,
    slots,
  })
}

export async function apiAcceptSchedule(
  code: string,
  matchId: string,
  playerToken: string,
  proposalId: string,
  slot: string,
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/schedule`, {
    action: 'accept',
    matchId,
    playerToken,
    proposalId,
    slot,
  })
}

export async function apiDropSelf(code: string, playerToken: string): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/drop`, { playerToken })
}

export async function apiHostDrop(
  code: string,
  hostToken: string,
  playerId: string,
): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/drop`, { hostToken, playerId })
}
