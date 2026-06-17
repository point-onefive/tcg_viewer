import { NextResponse } from 'next/server'
import { clearSessionCookie } from '@/lib/wallet/session'

// POST /api/auth/logout
// Clears the session cookie. Safe to call even when not authenticated.
export async function POST(): Promise<NextResponse> {
  await clearSessionCookie()
  return NextResponse.json({ ok: true })
}
