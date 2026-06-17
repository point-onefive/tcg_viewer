import { NextRequest, NextResponse } from 'next/server'
import { getBadges, getStandingByUsername } from '@/lib/wallet/db'

// GET /api/auth/badges?address=0x... | ?username=foo
// Returns a wallet's podium finishes (gold/silver/bronze) across completed
// tournaments. Public endpoint - placements are not secret. Accepts either a
// wallet address or a username (resolved to an address) so the profile views
// can ask by whichever identifier they hold.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const address = req.nextUrl.searchParams.get('address')
  const username = req.nextUrl.searchParams.get('username')

  try {
    let wallet = address?.trim().toLowerCase() ?? null
    if (!wallet && username) {
      const standing = await getStandingByUsername(username.trim())
      wallet = standing?.walletAddress ?? null
    }
    if (!wallet) return NextResponse.json({ badges: [] })

    const badges = await getBadges(wallet)
    return NextResponse.json({ badges })
  } catch (err) {
    console.error('auth/badges failed', err)
    // Soft-fail: a profile should still render without its badges.
    return NextResponse.json({ badges: [] })
  }
}
