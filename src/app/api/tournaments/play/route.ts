import { handle, ok } from '@/lib/tournament/http'
import { isTournamentBackendConfigured } from '@/lib/tournament/supabase'
import { isEscrowConfigured } from '@/lib/tournament/escrow'
import { listOpenPaidGames } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/play - the always-on paid tournaments lobby feed.
//
// Public and read-only. Lists open paid games (escrow-linked, not the featured
// live event). Degrades gracefully: if the backend or escrow isn't configured
// it returns flags + an empty list so the lobby can show a "coming soon" state
// rather than an error. This is a distinct surface from /tournaments (featured
// events), which is untouched.
export async function GET() {
  if (!isTournamentBackendConfigured()) {
    return ok({ configured: false, escrowConfigured: false, games: [] })
  }
  return handle(async () => {
    const games = await listOpenPaidGames()
    return ok({ configured: true, escrowConfigured: isEscrowConfigured(), games })
  })
}
