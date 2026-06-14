import { handle, ok, readJson } from '@/lib/tournament/http'
import { reportResult } from '@/lib/tournament/service'
import type { ReportedResult } from '@/lib/tournament/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  matchId: string
  playerToken: string
  result: ReportedResult
}

// POST /api/tournaments/:code/report - a player reports their match outcome.
// Both-agree → confirmed; conflict → disputed; one-sided → provisional.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const { matchId, playerToken, result } = await readJson<Body>(request)
    await reportResult(code, matchId, playerToken, result)
    return ok({ ok: true })
  })
}
