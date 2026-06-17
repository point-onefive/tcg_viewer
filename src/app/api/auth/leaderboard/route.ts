import { NextRequest, NextResponse } from 'next/server'
import { getLeaderboard } from '@/lib/wallet/db'

// GET /api/auth/leaderboard?limit=50
// Returns top players by win count across all tournaments.
// Public endpoint - no auth required.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const limitParam = req.nextUrl.searchParams.get('limit')
  const limit = Math.min(parseInt(limitParam ?? '50', 10) || 50, 200)

  let standings
  try {
    standings = await getLeaderboard(limit)
  } catch (err) {
    console.error('auth/leaderboard failed', err)
    return NextResponse.json({ error: 'Failed to load leaderboard' }, { status: 503 })
  }

  return NextResponse.json({ standings })
}
