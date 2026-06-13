import 'server-only'
import { createHash, randomBytes } from 'node:crypto'

// ─────────────────────────────────────────────────────────────────────────
// Token + code helpers for the tokenless identity model.
//
// Host and player identity is carried by an opaque random token embedded in a
// bookmarkable URL. The server stores only sha256(token); the plaintext is
// returned to the creator exactly once and thereafter lives only in that
// person's browser. Comparison is done by hashing the presented token and
// matching the stored hash, so a database leak never exposes a usable token.
// ─────────────────────────────────────────────────────────────────────────

/** Generate a URL-safe 256-bit secret token (base64url, ~43 chars). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Stable SHA-256 hash (hex) of a token, for storage + comparison. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

/** Constant-ish equality on hex strings (length-checked, then char compare). */
export function tokenMatchesHash(token: string, hash: string): boolean {
  if (!token || !hash) return false
  const computed = hashToken(token)
  if (computed.length !== hash.length) return false
  let diff = 0
  for (let i = 0; i < computed.length; i++) {
    diff |= computed.charCodeAt(i) ^ hash.charCodeAt(i)
  }
  return diff === 0
}

// Human-friendly tournament code. Avoids ambiguous chars (0/O, 1/I/L).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/**
 * Short shareable tournament code like "OP-7QK2P". The 2-letter prefix is a
 * hint from the game; uniqueness is enforced by the DB (caller retries on
 * collision).
 */
export function generateCode(prefix = 'TC'): string {
  let body = ''
  const bytes = randomBytes(5)
  for (let i = 0; i < 5; i++) {
    body += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length]
  }
  return `${prefix}-${body}`
}

/** 2-letter URL prefix per game for nicer codes. */
export function gamePrefix(game: string): string {
  switch (game) {
    case 'one-piece':
      return 'OP'
    case 'pokemon':
      return 'PK'
    case 'gundam':
      return 'GU'
    case 'dragon-ball':
      return 'DB'
    case 'digimon':
      return 'DG'
    case 'lorcana':
      return 'LC'
    default:
      return 'TC'
  }
}
