import { NextResponse } from 'next/server'
import { generateNonce } from 'siwe'
import { setNonceCookie } from '@/lib/wallet/session'

// GET /api/auth/nonce
// Returns a fresh one-time nonce for SIWE message construction.
// Also stores the nonce in a short-lived HttpOnly cookie so the verify
// endpoint can confirm it came from our server and hasn't expired.
export async function GET(): Promise<NextResponse> {
  const nonce = generateNonce()
  await setNonceCookie(nonce)
  return NextResponse.json({ nonce })
}
