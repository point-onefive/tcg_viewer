import 'server-only'

// Avatar snapshotting.
//
// Why this exists: avatars are resolved from a free third-party proxy
// (unavatar.io) derived from a player's X handle. Hot-linking that proxy at
// render time does NOT scale - every leaderboard / profile view by every
// visitor is a fresh request, and unavatar rate-limits aggressively (HTTP 429),
// which makes avatars flicker out to initials. To fix that we fetch the image
// exactly ONCE, when the player saves their profile, mirror the bytes into our
// own Cloudflare R2 bucket, and store the permanent R2 URL. After that the
// avatar serves from our CDN with zero runtime dependency on unavatar.

const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN
const BUCKET = process.env.R2_BUCKET

const AVATAR_PREFIX = 'avatars'
const MAX_BYTES = 5 * 1024 * 1024 // 5MB ceiling - avatars are tiny; reject anything absurd.

/** True when every credential needed to write to R2 is present. */
export function r2CredentialsConfigured(): boolean {
  return Boolean(R2_PUBLIC_URL && ACCOUNT_ID && API_TOKEN && BUCKET)
}

function backoff(attempt: number): Promise<void> {
  return new Promise((r) => setTimeout(r, Math.min(500 * 2 ** attempt, 4000)))
}

/** Fetch an image, retrying past transient rate-limit / 5xx responses. */
async function fetchImage(
  url: string,
  attempts = 4,
): Promise<{ body: Uint8Array; contentType: string } | null> {
  for (let i = 0; i < attempts; i++) {
    if (i > 0) await backoff(i)
    let res: Response
    try {
      res = await fetch(url, { headers: { 'User-Agent': 'thecardwall-avatar-fetch/1.0' } })
    } catch {
      continue // network blip - retry
    }
    if (res.status === 429 || res.status >= 500) continue // throttled / transient - retry
    if (!res.ok) return null // 4xx (e.g. handle has no avatar) - give up cleanly
    const contentType = res.headers.get('content-type') ?? ''
    if (!contentType.startsWith('image/')) return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength === 0 || buf.byteLength > MAX_BYTES) return null
    return { body: buf, contentType }
  }
  return null
}

/** PUT bytes to an R2 object via the Cloudflare REST API. */
async function putToR2(key: string, body: Uint8Array, contentType: string): Promise<boolean> {
  const base = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`
  for (let i = 0; i < 4; i++) {
    if (i > 0) await backoff(i)
    let res: Response
    try {
      res = await fetch(`${base}/${encodeURI(key)}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${API_TOKEN}`, 'Content-Type': contentType },
        body: body as BodyInit,
      })
    } catch {
      continue
    }
    if (res.ok) return true
    if (res.status === 429 || res.status >= 500) continue
    return false
  }
  return false
}

/**
 * Fetch an avatar image from `sourceUrl` once and mirror it to R2 so the app
 * never depends on the third-party image host at render time.
 *
 * The object is keyed by wallet address (one object per player), so re-saving
 * overwrites in place - no orphans. A cache-busting `?v=` suffix is appended to
 * the returned URL so a changed image is picked up immediately past any CDN
 * cache.
 *
 * Returns the public R2 URL on success, or null if R2 credentials are missing
 * or any step fails. Callers fall back to the live source / initials on null.
 */
export async function snapshotAvatarToR2(
  walletAddress: string,
  sourceUrl: string,
): Promise<string | null> {
  if (!r2CredentialsConfigured()) return null
  const img = await fetchImage(sourceUrl)
  if (!img) return null
  const key = `${AVATAR_PREFIX}/${walletAddress.toLowerCase()}`
  const ok = await putToR2(key, img.body, img.contentType)
  if (!ok) return null
  return `${R2_PUBLIC_URL}/${key}?v=${Date.now()}`
}
