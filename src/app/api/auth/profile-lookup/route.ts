import { NextRequest, NextResponse } from 'next/server'
import { getStandingByXHandle, getStandingByUsername } from '@/lib/wallet/db'

// GET /api/auth/profile-lookup?handle=<xHandle>  (or ?username=<name>)
// Resolves a public player profile + standings from an X handle or username.
// Used by the tournament bracket so clicking a name opens the in-app profile
// (which contains the X link + availability) instead of jumping straight to X.
// Public endpoint - no auth required. Returns { standing: null } when the name
// has no linked wallet profile (e.g. a walk-in entered by handle only).
export async function GET(req: NextRequest): Promise<NextResponse> {
  const handle = req.nextUrl.searchParams.get('handle')
  const username = req.nextUrl.searchParams.get('username')
  if (!handle && !username) {
    return NextResponse.json({ error: 'Provide handle or username' }, { status: 400 })
  }

  try {
    const standing = handle
      ? await getStandingByXHandle(handle)
      : await getStandingByUsername(username as string)
    return NextResponse.json({ standing })
  } catch (err) {
    console.error('auth/profile-lookup failed', err)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 503 })
  }
}
