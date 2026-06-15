import { handle, ok, readJson } from '@/lib/tournament/http'
import { assertAdmin } from '@/lib/tournament/admin-auth'
import {
  adminApproveAllPending,
  adminApprovePlayer,
  adminCloseSignup,
  adminExtendSignup,
  adminRejectPlayer,
  adminSetPollOpen,
  adminSetPrizes,
  adminSetResult,
  adminStartBracket,
  adminStartFresh,
  TournamentError,
} from '@/lib/tournament/service'
import type { TournamentPrize } from '@/lib/tournament/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body =
  | { action: 'ping' }
  | { action: 'start-fresh'; name: string; signupMinutes: number; roundMinutes: number; format?: 'swiss' | 'single-elim'; maxPlayers?: number; rules?: string; contactUrl?: string }
  | { action: 'extend-signup'; code: string; extraMinutes: number }
  | { action: 'close-signup'; code: string }
  | { action: 'approve'; code: string; playerId: string }
  | { action: 'reject'; code: string; playerId: string }
  | { action: 'approve-all'; code: string }
  | { action: 'set-prizes'; code: string; prizes: TournamentPrize[] }
  | { action: 'start-bracket'; code: string }
  | { action: 'set-result'; code: string; matchId: string; result: 'p1' | 'p2' | 'draw' }
  | { action: 'set-poll'; code: string; open: boolean }

// POST /api/tournaments/admin - admin-only tournament control
export async function POST(request: Request) {
  return handle(async () => {
    assertAdmin(request)
    const body = await readJson<Body>(request)
    switch (body.action) {
      case 'ping':
        return ok({ ok: true })
      case 'start-fresh': {
        const result = await adminStartFresh(body)
        return ok(result, 201)
      }
      case 'extend-signup':
        await adminExtendSignup(body.code, body.extraMinutes)
        return ok({ ok: true })
      case 'close-signup':
        await adminCloseSignup(body.code)
        return ok({ ok: true })
      case 'approve':
        await adminApprovePlayer(body.code, body.playerId)
        return ok({ ok: true })
      case 'reject':
        await adminRejectPlayer(body.code, body.playerId)
        return ok({ ok: true })
      case 'approve-all': {
        const count = await adminApproveAllPending(body.code)
        return ok({ ok: true, approved: count })
      }
      case 'set-prizes': {
        const res = await adminSetPrizes(body.code, body.prizes)
        return ok({ ok: true, ...res })
      }
      case 'start-bracket':
        await adminStartBracket(body.code)
        return ok({ ok: true })
      case 'set-result':
        await adminSetResult(body.code, body.matchId, body.result)
        return ok({ ok: true })
      case 'set-poll':
        await adminSetPollOpen(body.code, body.open)
        return ok({ ok: true })
      default:
        throw new TournamentError('Unknown action.', 400)
    }
  })
}
