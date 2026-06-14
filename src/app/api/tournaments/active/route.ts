import { handle, ok } from '@/lib/tournament/http'
import { getActiveSnapshot } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/active - the one live tournament for /tournaments
export async function GET() {
  return handle(async () => ok(await getActiveSnapshot()))
}
