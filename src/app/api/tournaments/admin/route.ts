import { handle, ok, readJson } from '@/lib/tournament/http'
import { assertAdmin } from '@/lib/tournament/admin-auth'
import {
  adminApproveAllPending,
  adminApprovePlayer,
  adminAwardPrizes,
  adminCloseSignup,
  adminDropPlayer,
  adminExtendSignup,
  adminRejectPlayer,
  adminSetDeck,
  adminSetMaxPlayers,
  adminSetRoundMinutes,
  adminGetDeck,
  adminSetPollConfig,
  adminSetPollOpen,
  adminSetPrizes,
  adminSetResult,
  adminStartBracket,
  adminStartFresh,
  enroll,
  recomputeAllPlacements,
  TournamentError,
} from '@/lib/tournament/service'
import { listWaitlist } from '@/lib/tournament/waitlist'
import type { TournamentPrize } from '@/lib/tournament/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body =
  | { action: 'ping' }
  | { action: 'start-fresh'; name: string; signupMinutes: number; roundMinutes: number; format?: 'swiss' | 'single-elim'; maxPlayers?: number; rules?: string; contactUrl?: string }
  | { action: 'add-player'; code: string; xHandle: string; deckList?: string }
  | { action: 'extend-signup'; code: string; extraMinutes: number }
  | { action: 'close-signup'; code: string }
  | { action: 'set-max-players'; code: string; maxPlayers: number | null }
  | { action: 'set-round-minutes'; code: string; roundMinutes: number }
  | { action: 'approve'; code: string; playerId: string }
  | { action: 'reject'; code: string; playerId: string }
  | { action: 'drop-player'; code: string; playerId: string }
  | { action: 'set-deck'; code: string; playerId: string; deckList: string }
  | { action: 'get-deck'; code: string; playerId: string }
  | { action: 'approve-all'; code: string }
  | { action: 'set-prizes'; code: string; prizes: TournamentPrize[] }
  | { action: 'award-prizes'; code: string; assignments: { slotIndex: number; playerIds: string[] }[] }
  | { action: 'start-bracket'; code: string }
  | { action: 'set-result'; code: string; matchId: string; result: 'p1' | 'p2' | 'draw' }
  | { action: 'set-poll'; code: string; open: boolean }
  | { action: 'set-poll-config'; code: string; question: string; options: { id?: string; label: string; blurb: string }[] }
  | { action: 'list-waitlist' }
  | { action: 'recompute-placements' }

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
      case 'add-player': {
        // Operator path for seeding / walk-in entries (the public
        // /:code/enroll endpoint is wallet-gated). Routes through the
        // same enroll service so all window / cap / dup guards still apply.
        const result = await enroll(body.code, body.xHandle, body.deckList ?? null)
        return ok(result, 201)
      }
      case 'extend-signup':
        await adminExtendSignup(body.code, body.extraMinutes)
        return ok({ ok: true })
      case 'close-signup':
        await adminCloseSignup(body.code)
        return ok({ ok: true })
      case 'set-max-players':
        await adminSetMaxPlayers(body.code, body.maxPlayers)
        return ok({ ok: true })
      case 'set-round-minutes':
        await adminSetRoundMinutes(body.code, body.roundMinutes)
        return ok({ ok: true })
      case 'approve':
        await adminApprovePlayer(body.code, body.playerId)
        return ok({ ok: true })
      case 'reject':
        await adminRejectPlayer(body.code, body.playerId)
        return ok({ ok: true })
      case 'drop-player':
        await adminDropPlayer(body.code, body.playerId)
        return ok({ ok: true })
      case 'set-deck': {
        const res = await adminSetDeck(body.code, body.playerId, body.deckList)
        return ok({ ok: true, ...res })
      }
      case 'get-deck': {
        const res = await adminGetDeck(body.code, body.playerId)
        return ok({ ok: true, ...res })
      }
      case 'approve-all': {
        const count = await adminApproveAllPending(body.code)
        return ok({ ok: true, approved: count })
      }
      case 'set-prizes': {
        const res = await adminSetPrizes(body.code, body.prizes)
        return ok({ ok: true, ...res })
      }
      case 'award-prizes': {
        const res = await adminAwardPrizes(body.code, body.assignments)
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
      case 'set-poll-config': {
        const res = await adminSetPollConfig(body.code, body.question, body.options)
        return ok({ ok: true, ...res })
      }
      case 'list-waitlist': {
        const entries = await listWaitlist()
        return ok({ ok: true, entries, count: entries.length })
      }
      case 'recompute-placements': {
        const count = await recomputeAllPlacements()
        return ok({ ok: true, count })
      }
      default:
        throw new TournamentError('Unknown action.', 400)
    }
  })
}
