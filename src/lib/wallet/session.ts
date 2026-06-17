import 'server-only'
import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

// ── Constants ─────────────────────────────────────────────────────────────

export const SESSION_COOKIE = 'tcw_wallet_session'
export const NONCE_COOKIE = 'tcw_siwe_nonce'

const SESSION_MAX_AGE = 30 * 24 * 60 * 60 // 30 days in seconds
const NONCE_MAX_AGE = 5 * 60 // 5 minutes in seconds

// ── Session secret ─────────────────────────────────────────────────────────
// Set WALLET_SESSION_SECRET in .env.local - must be >= 32 chars.
// Generate with: openssl rand -base64 32
function getSessionSecret(): Uint8Array {
  const secret = process.env.WALLET_SESSION_SECRET
  if (!secret || secret.length < 32) {
    throw new Error(
      'WALLET_SESSION_SECRET env var is required and must be at least 32 characters. ' +
        'Generate one with: openssl rand -base64 32',
    )
  }
  return new TextEncoder().encode(secret)
}

// ── Session JWT (wallet address) ───────────────────────────────────────────

export interface WalletSession {
  address: string // lowercase 0x-prefixed EVM address
}

export async function signSession(payload: WalletSession): Promise<string> {
  return new SignJWT({ address: payload.address })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(getSessionSecret())
}

export async function verifySession(token: string): Promise<WalletSession | null> {
  try {
    const { payload } = await jwtVerify(token, getSessionSecret())
    if (typeof payload.address !== 'string') return null
    return { address: payload.address }
  } catch {
    return null
  }
}

// ── Cookie helpers ─────────────────────────────────────────────────────────

const isProduction = process.env.NODE_ENV === 'production'

/** Set the session cookie on a response. Use inside Route Handlers. */
export async function setSessionCookie(token: string): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: SESSION_MAX_AGE,
    path: '/',
  })
}

/** Clear the session cookie. */
export async function clearSessionCookie(): Promise<void> {
  const store = await cookies()
  store.set(SESSION_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: 0,
    path: '/',
  })
}

/** Read and verify the session from the incoming request cookies. */
export async function getSession(): Promise<WalletSession | null> {
  const store = await cookies()
  const token = store.get(SESSION_COOKIE)?.value
  if (!token) return null
  return verifySession(token)
}

// ── SIWE nonce cookie ──────────────────────────────────────────────────────
// Short-lived HttpOnly cookie that stores the server-minted nonce.
// This ensures the nonce was issued by our server and prevents replay attacks.

/** Set the nonce cookie (5-minute TTL). */
export async function setNonceCookie(nonce: string): Promise<void> {
  const store = await cookies()
  store.set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProduction,
    maxAge: NONCE_MAX_AGE,
    path: '/',
  })
}

/** Read and clear the nonce cookie. Returns null if absent. */
export async function consumeNonceCookie(): Promise<string | null> {
  const store = await cookies()
  const nonce = store.get(NONCE_COOKIE)?.value ?? null
  if (nonce) {
    store.set(NONCE_COOKIE, '', { httpOnly: true, maxAge: 0, path: '/' })
  }
  return nonce
}
