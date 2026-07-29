import { handle, ok, readJson } from '@/lib/tournament/http'
import { assertAdmin } from '@/lib/tournament/admin-auth'
import {
  adminApproveAllPending,
  adminApprovePlayer,
  adminAwardPrizes,
  adminCloseSignup,
  adminDropPlayer,
  adminExtendRound,
  adminExtendSignup,
  adminRejectPlayer,
  adminSetDeck,
  adminSetMaxPlayers,
  adminSetRoundMinutes,
  adminGetDeck,
  adminAuditDecks,
  adminSearchDecks,
  adminPromoteFromWaitlist,
  adminResetPoll,
  adminSetPollConfig,
  adminSetPollOpen,
  adminSetPrizes,
  adminSetBadges,
  adminSetParticipationBadge,
  listBadgeRecipients,
  grantManualBadge,
  listRecentManualBadges,
  revokeManualBadge,
  adminSetTheme,
  adminSetResult,
  adminStartBracket,
  adminStartFresh,
  adminCreatePaidGame,
  adminEndTournament,
  enroll,
  recomputeAllPlacements,
  TournamentError,
} from '@/lib/tournament/service'
import { listWaitlist, removeWaitlistEntry } from '@/lib/tournament/waitlist'
import type { TournamentPrize, TournamentBadgeSlot } from '@/lib/tournament/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Body =
  | { action: 'ping' }
  | { action: 'start-fresh'; name: string; signupMinutes: number; roundMinutes: number; format?: 'swiss' | 'single-elim'; maxPlayers?: number; rules?: string; contactUrl?: string; theme?: string }
  | { action: 'create-paid-game'; name: string; payoutPreset: string; maxPlayers: number; roundMinutes: number; entryFeeUsdc?: number; rakeBps?: number; game?: import('@/lib/tournament/types').TournamentGame; rules?: string; contactUrl?: string; theme?: string }
  | { action: 'add-player'; code: string; xHandle: string; deckList?: string }
  | { action: 'extend-signup'; code: string; extraMinutes: number }
  | { action: 'close-signup'; code: string }
  | { action: 'set-max-players'; code: string; maxPlayers: number | null }
  | { action: 'set-round-minutes'; code: string; roundMinutes: number }
  | { action: 'extend-round'; code: string; extraMinutes: number }
  | { action: 'approve'; code: string; playerId: string }
  | { action: 'reject'; code: string; playerId: string }
  | { action: 'drop-player'; code: string; playerId: string }
  | { action: 'set-deck'; code: string; playerId: string; deckList: string }
  | { action: 'get-deck'; code: string; playerId: string }
  | { action: 'deck-audit'; code: string }
  | { action: 'deck-search'; code: string; query: string }
  | { action: 'approve-all'; code: string }
  | { action: 'set-prizes'; code: string; prizes: TournamentPrize[] }
  | { action: 'set-badges'; code: string; badges: TournamentBadgeSlot[] }
  | { action: 'set-participation-badge'; code: string; badge: TournamentBadgeSlot | null }
  | { action: 'award-prizes'; code: string; assignments: { slotIndex: number; playerIds: string[] }[] }
  | { action: 'start-bracket'; code: string }
  | { action: 'end-tournament'; code: string }
  | { action: 'set-result'; code: string; matchId: string; result: 'p1' | 'p2' | 'draw' }
  | { action: 'set-theme'; code: string; theme: string }
  | { action: 'set-poll'; code: string; open: boolean }
  | { action: 'set-poll-config'; code: string; question: string; options: { id?: string; label: string; blurb: string }[] }
  | { action: 'new-poll'; code: string; question: string; options: { id?: string; label: string; blurb: string }[] }
  | { action: 'list-waitlist' }
  | { action: 'promote-waitlist'; code: string; entryId: string }
  | { action: 'remove-waitlist'; entryId: string }
  | { action: 'recompute-placements' }
  | { action: 'list-badge-recipients' }
  | { action: 'grant-badge'; walletAddress: string; badge: TournamentBadgeSlot }
  | { action: 'list-recent-badges' }
  | { action: 'revoke-badge'; id: string }

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
      case 'create-paid-game': {
        const result = await adminCreatePaidGame(body)
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
      case 'extend-round':
        await adminExtendRound(body.code, body.extraMinutes)
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
      case 'deck-audit': {
        const results = await adminAuditDecks(body.code)
        return ok({ ok: true, results })
      }
      case 'deck-search': {
        const matches = await adminSearchDecks(body.code, body.query)
        return ok({ ok: true, matches })
      }
      case 'approve-all': {
        const count = await adminApproveAllPending(body.code)
        return ok({ ok: true, approved: count })
      }
      case 'set-prizes': {
        const res = await adminSetPrizes(body.code, body.prizes)
        return ok({ ok: true, ...res })
      }
      case 'set-badges': {
        const res = await adminSetBadges(body.code, body.badges)
        return ok({ ok: true, ...res })
      }
      case 'set-participation-badge': {
        const res = await adminSetParticipationBadge(body.code, body.badge)
        return ok({ ok: true, ...res })
      }
      case 'award-prizes': {
        const res = await adminAwardPrizes(body.code, body.assignments)
        return ok({ ok: true, ...res })
      }
      case 'start-bracket':
        await adminStartBracket(body.code)
        return ok({ ok: true })
      case 'end-tournament':
        await adminEndTournament(body.code)
        return ok({ ok: true })
      case 'set-result':
        await adminSetResult(body.code, body.matchId, body.result)
        return ok({ ok: true })
      case 'set-theme': {
        const res = await adminSetTheme(body.code, body.theme)
        return ok({ ok: true, ...res })
      }
      case 'set-poll':
        await adminSetPollOpen(body.code, body.open)
        return ok({ ok: true })
      case 'set-poll-config': {
        const res = await adminSetPollConfig(body.code, body.question, body.options)
        return ok({ ok: true, ...res })
      }
      case 'new-poll': {
        const res = await adminResetPoll(body.code, body.question, body.options)
        return ok({ ok: true, ...res })
      }
      case 'list-waitlist': {
        const entries = await listWaitlist()
        return ok({ ok: true, entries, count: entries.length })
      }
      case 'promote-waitlist': {
        const res = await adminPromoteFromWaitlist(body.code, body.entryId)
        return ok({ ok: true, ...res })
      }
      case 'remove-waitlist': {
        const res = await removeWaitlistEntry(body.entryId)
        return ok({ ok: true, ...res })
      }
      case 'recompute-placements': {
        const count = await recomputeAllPlacements()
        return ok({ ok: true, count })
      }
      case 'list-badge-recipients': {
        const recipients = await listBadgeRecipients()
        return ok({ ok: true, recipients })
      }
      case 'grant-badge': {
        const award = await grantManualBadge(body.walletAddress, body.badge)
        return ok({ ok: true, award })
      }
      case 'list-recent-badges': {
        const awards = await listRecentManualBadges()
        return ok({ ok: true, awards })
      }
      case 'revoke-badge': {
        await revokeManualBadge(body.id)
        return ok({ ok: true })
      }
      default:
        throw new TournamentError('Unknown action.', 400)
    }
  })
}
