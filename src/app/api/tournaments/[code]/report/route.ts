import { handle, ok, readJson } from '@/lib/tournament/http'
import { reportResult, reportResultByWallet, TournamentError } from '@/lib/tournament/service'
import type { ReportedResult } from '@/lib/tournament/types'
import { getSession } from '@/lib/wallet/session'
import { getProfile } from '@/lib/wallet/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  matchId: string
  result: ReportedResult
  /** Legacy token path (dev tooling). Wallet session is preferred. */
  playerToken?: string
}

// POST /api/tournaments/:code/report - a player reports their match outcome.
// Both-agree -> confirmed; conflict -> disputed; one-sided -> provisional.
//
// Wallet-backed: the signed-in wallet identifies the player (matched by wallet
// address, then X handle). A legacy playerToken in the body is still honored so
// dev tooling and any older client keep working.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const { matchId, result, playerToken } = await readJson<Body>(request)

    if (playerToken) {
      await reportResult(code, matchId, playerToken, result)
      return ok({ ok: true })
    }

    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to report a result.', 401)
    }
    const profile = await getProfile(session.address)
    await reportResultByWallet(code, matchId, session.address, profile?.xHandle ?? null, result)
    return ok({ ok: true })
  })
}
