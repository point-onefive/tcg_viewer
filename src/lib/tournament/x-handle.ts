// X (Twitter) handle normalization + profile URLs. Safe on client and server.

/** Strip @, pasted URLs, query strings; lowercase for dedupe. */
export function normalizeXHandle(raw: string): string {
  let s = raw.trim()
  if (!s) return ''
  // Full profile URL pasted
  s = s.replace(/^https?:\/\/(www\.)?(twitter\.com|x\.com)\//i, '')
  s = s.replace(/^@+/, '')
  s = s.split('/')[0]?.split('?')[0]?.trim() ?? ''
  // Handles are case-insensitive on X; store lowercase for uniqueness checks.
  return s.toLowerCase()
}

export function xProfileUrl(handle: string): string {
  const h = normalizeXHandle(handle)
  if (!h) return ''
  return `https://x.com/${encodeURIComponent(h)}`
}

export function formatXLabel(handle: string): string {
  const h = normalizeXHandle(handle)
  return h ? `@${h}` : ''
}

/** Basic sanity - letters, numbers, underscore; 1–15 chars (X limits). */
export function isValidXHandle(raw: string): boolean {
  const h = normalizeXHandle(raw)
  return /^[a-z0-9_]{1,15}$/i.test(h)
}
