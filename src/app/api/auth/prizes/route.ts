import { NextRequest, NextResponse } from 'next/server'
import { getPrizesWon, getStandingByUsername } from '@/lib/wallet/db'

// GET /api/auth/prizes?address=0x... | ?username=foo
// Returns the prizes a wallet has actually won across completed tournaments
// (the frozen award snapshot, never the live pool). Public endpoint - winners
// are not secret. Accepts a wallet address or a username (resolved to an
// address) so the profile views can ask by whichever identifier they hold.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const address = req.nextUrl.searchParams.get('address')
  const username = req.nextUrl.searchParams.get('username')

  try {
    let wallet = address?.trim().toLowerCase() ?? null
    if (!wallet && username) {
      const standing = await getStandingByUsername(username.trim())
      wallet = standing?.walletAddress ?? null
    }
    if (!wallet) return NextResponse.json({ prizes: [] })

    const prizes = await getPrizesWon(wallet)
    return NextResponse.json({ prizes })
  } catch (err) {
    console.error('auth/prizes failed', err)
    // Soft-fail: a profile should still render without its prizes.
    return NextResponse.json({ prizes: [] })
  }
}
