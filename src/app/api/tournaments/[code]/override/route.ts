import { handle, ok, readJson } from '@/lib/tournament/http'
import { hostOverrideMatch } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  hostToken: string
  matchId: string
  // winnerId for a decisive result, or null to force a draw.
  winnerId: string | null
}

// POST /api/tournaments/:code/override — host force-resolves a match
// (disputes, no-shows, manual corrections).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const { hostToken, matchId, winnerId } = await readJson<Body>(request)
    await hostOverrideMatch(code, hostToken, matchId, winnerId)
    return ok({ ok: true })
  })
}
