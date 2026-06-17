import { NextResponse } from 'next/server'
import { getSession } from '@/lib/wallet/session'
import { getStanding } from '@/lib/wallet/db'

// GET /api/auth/me
// Returns the current session's wallet address + full profile + standings.
// Returns 401 if no valid session cookie exists.
export async function GET(): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let standing
  try {
    standing = await getStanding(session.address)
  } catch (err) {
    console.error('auth/me: getStanding failed', err)
    return NextResponse.json({ error: 'Failed to load profile' }, { status: 503 })
  }

  if (!standing) {
    // Session exists but profile was deleted - clear it.
    return NextResponse.json({ error: 'Profile not found' }, { status: 404 })
  }

  return NextResponse.json({ standing })
}
