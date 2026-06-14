'use client'

import type { TournamentSnapshot } from './types'

const ADMIN_KEY = 'tcw_tournament_admin_key'

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

export async function apiEnrollX(code: string, xHandle: string): Promise<void> {
  await post(`/api/tournaments/${encodeURIComponent(code)}/enroll`, { xHandle })
}

export async function adminApi(
  adminKey: string,
  body: Record<string, unknown>,
): Promise<{ code?: string; approved?: number; count?: number; ok?: boolean }> {
  return post('/api/tournaments/admin', body, adminKey)
}
