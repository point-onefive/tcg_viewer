import { NextRequest, NextResponse } from 'next/server'
import { getEarnedBadges, getEarnedTournamentBadges, getManualBadges, getStandingByUsername } from '@/lib/wallet/db'
import { badgeOrder, getBadgeDef, tierByRank, type DisplayBadge } from '@/lib/wallet/badge-catalog'

// GET /api/auth/profile-badges?address=0x... | ?username=foo
// Returns a wallet's earned badges as ready-to-render display objects, merged
// from two sources:
//   1. static catalog grants (profile_badges) - participation + historical
//      placements, art in /public/badges
//   2. dynamic per-tournament awards (tournament_awarded_badges) - admin-made
//      badges assigned by placement, art is a snapshot data URL
// Dynamic (newest events) lead; catalog badges follow in catalog order. Public
// endpoint - badges are not secret. Soft-fails to [] so profiles always render.
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

    const [catalogGrants, tournamentBadges, manualBadges] = await Promise.all([
      getEarnedBadges(wallet),
      getEarnedTournamentBadges(wallet),
      getManualBadges(wallet),
    ])

    // Dynamic per-tournament badges first (newest event first, already sorted).
    const dynamic: DisplayBadge[] = tournamentBadges
      .filter((b) => b.image)
      .map((b) => ({
        key: `t:${b.id}`,
        image: b.image as string,
        name: b.title,
        description: b.description,
        link: b.tournamentCode ? `/tournaments/${encodeURIComponent(b.tournamentCode)}` : undefined,
        tier: tierByRank(b.rank),
      }))

    // Standalone hand-granted badges (not tied to any event, so no link).
    const manual: DisplayBadge[] = manualBadges
      .filter((b) => b.image)
      .map((b) => ({
        key: `m:${b.id}`,
        image: b.image as string,
        name: b.title,
        description: b.description,
        tier: 'special' as const,
      }))

    // Static catalog badges, in catalog display order.
    const catalog: DisplayBadge[] = catalogGrants
      .map((g) => ({ def: getBadgeDef(g.badgeId), id: g.badgeId }))
      .filter((x): x is { def: NonNullable<ReturnType<typeof getBadgeDef>>; id: string } => Boolean(x.def))
      .sort((a, b) => badgeOrder(a.id) - badgeOrder(b.id))
      .map(({ def }) => ({
        key: `c:${def.id}`,
        image: def.image,
        name: def.name,
        description: def.description,
        link: def.link,
        tier: def.tier,
      }))

    return NextResponse.json({ badges: [...dynamic, ...manual, ...catalog] })
  } catch (err) {
    console.error('auth/profile-badges failed', err)
    // Soft-fail: a profile should still render without its badges.
    return NextResponse.json({ badges: [] })
  }
}
