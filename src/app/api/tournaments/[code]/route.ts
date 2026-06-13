import { handle, ok } from '@/lib/tournament/http'
import { getSnapshotByCode } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/:code — public snapshot (bracket, players, standings,
// schedule). No tokens are ever included in the response.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const snapshot = await getSnapshotByCode(code)
    return ok(snapshot)
  })
}
