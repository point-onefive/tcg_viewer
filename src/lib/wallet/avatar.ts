// Avatar resolution. Safe on client and server (no server-only imports).
//
// Priority:
//   1. An explicit avatar URL the player saved.
//   2. The player's X (Twitter) avatar, derived from their handle via
//      unavatar.io - a stable, free image proxy that resolves social avatars.
//      This means most players get a real profile picture just by linking X,
//      with no upload step.
//   3. null - callers fall back to initials.

import { normalizeXHandle } from '@/lib/tournament/x-handle'

interface AvatarSource {
  avatarUrl?: string | null
  xHandle?: string | null
}

/** Resolve the best avatar image URL for a profile, or null if none. */
export function resolveAvatarUrl(source: AvatarSource): string | null {
  const explicit = source.avatarUrl?.trim()
  if (explicit && /^https:\/\//i.test(explicit)) return explicit

  const handle = source.xHandle ? normalizeXHandle(source.xHandle) : ''
  if (handle) return `https://unavatar.io/x/${encodeURIComponent(handle)}`

  return null
}

/**
 * True when a URL points at one of our own R2-hosted avatar snapshots
 * (mirrored on save by snapshotAvatarToR2). Client-safe: matches the
 * `/avatars/<wallet>` key shape rather than reading server-only env.
 */
export function isManagedAvatarUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /^https:\/\/[^/]+\/avatars\//i.test(url)
}

/**
 * True when a URL is an X/Twitter PROFILE PAGE (e.g. https://x.com/handle), not
 * an image. People naturally paste their profile link into the avatar field;
 * storing it as the avatar yields a broken <img> (it's an HTML page). We detect
 * and ignore these so the avatar falls back to the handle-derived image. Note:
 * the real image host (pbs.twimg.com) is intentionally NOT matched here.
 */
export function isSocialProfileUrl(url: string | null | undefined): boolean {
  if (!url) return false
  return /^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i.test(url.trim())
}

/** Initials shown when no avatar image is available. */
export function avatarInitials(source: { username?: string | null; walletAddress?: string }): string {
  const name = source.username?.trim()
  if (name) return name.slice(0, 2).toUpperCase()
  const addr = source.walletAddress ?? ''
  return addr.startsWith('0x') ? addr.slice(2, 4).toUpperCase() : '??'
}
