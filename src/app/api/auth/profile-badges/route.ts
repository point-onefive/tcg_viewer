import { NextRequest, NextResponse } from 'next/server'
import { getEarnedBadges, getStandingByUsername } from '@/lib/wallet/db'

// GET /api/auth/profile-badges?address=0x... | ?username=foo
// Returns a wallet's earned cosmetic badges (ids from the code-side catalog).
// Public endpoint - badges are not secret. Accepts either a wallet address or a
// username so the profile views can ask by whichever identifier they hold.
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

    const badges = await getEarnedBadges(wallet)
    return NextResponse.json({ badges })
  } catch (err) {
    console.error('auth/profile-badges failed', err)
    // Soft-fail: a profile should still render without its badges.
    return NextResponse.json({ badges: [] })
  }
}
