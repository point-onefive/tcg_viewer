import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/wallet/session'
import {
  updateProfile,
  validateUsername,
  validateXHandle,
  normalizeXHandle,
  linkPlayersByXHandle,
} from '@/lib/wallet/db'

// PUT /api/auth/profile
// Update the current user's editable profile fields.
// Requires an active wallet session cookie.
//
// Body (all fields optional - only provided fields are updated):
//   { username?: string | null, xHandle?: string | null, avatarUrl?: string | null }
export async function PUT(req: NextRequest): Promise<NextResponse> {
  const session = await getSession()
  if (!session) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })
  }

  let body: { username?: string | null; xHandle?: string | null; avatarUrl?: string | null }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  // Validate username if provided.
  if (body.username !== undefined && body.username !== null) {
    const err = validateUsername(body.username)
    if (err) return NextResponse.json({ error: err }, { status: 422 })
  }

  // Validate X handle if provided.
  if (body.xHandle !== undefined && body.xHandle !== null) {
    const err = validateXHandle(body.xHandle)
    if (err) return NextResponse.json({ error: err }, { status: 422 })
    body.xHandle = normalizeXHandle(body.xHandle)
  }

  // Validate avatar URL if provided.
  if (body.avatarUrl !== undefined && body.avatarUrl !== null) {
    if (!body.avatarUrl.startsWith('https://')) {
      return NextResponse.json(
        { error: 'avatarUrl must be an HTTPS URL' },
        { status: 422 },
      )
    }
  }

  let profile
  try {
    profile = await updateProfile(session.address, body)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to update profile'
    const status = msg.includes('already taken') ? 409 : 503
    return NextResponse.json({ error: msg }, { status })
  }

  // Backfill: if the profile now has an X handle, claim any existing tournament
  // player rows with that handle (signed up before connecting a wallet) so the
  // player's record rolls up to their wallet. Best-effort - never blocks save.
  if (profile.xHandle) {
    try {
      await linkPlayersByXHandle(session.address, profile.xHandle)
    } catch (err) {
      console.error('auth/profile: player backfill failed', err)
    }
  }

  return NextResponse.json({ profile })
}
