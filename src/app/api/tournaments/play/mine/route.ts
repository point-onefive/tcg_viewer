import { handle, ok } from '@/lib/tournament/http'
import { isTournamentBackendConfigured } from '@/lib/tournament/supabase'
import { listRefundableStakesForWallet } from '@/lib/tournament/service'
import { getSession } from '@/lib/wallet/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/play/mine - wallet-scoped "needs your action" feed for
// the paid lobby. Returns the paid games where the CONNECTED wallet has a
// funded, un-refunded seat that is now refundable (game cancelled), so a player
// can always find the withdraw button after a cancel.
//
// The wallet is resolved from the SIWE session (same as deposit-verify), never
// from the request - a caller can only see their own refundable stakes.
// Degrades to an empty list when the backend or session is absent.
export async function GET() {
  if (!isTournamentBackendConfigured()) {
    return ok({ stakes: [] })
  }
  return handle(async () => {
    const session = await getSession()
    if (!session) return ok({ stakes: [] })
    const stakes = await listRefundableStakesForWallet(session.address)
    return ok({ stakes })
  })
}
