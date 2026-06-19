import { handle, ok } from '@/lib/tournament/http'
import { listCompletedTournaments } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/history - public archive of completed events, newest
// first. Summary cards only (name, date, headcount, champion); no tokens.
export async function GET() {
  return handle(async () => ok({ tournaments: await listCompletedTournaments() }))
}
