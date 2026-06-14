import { handle, ok } from '@/lib/tournament/http'
import { getActiveStatus } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/active/status - cheap live/enrolling probe for the
// global header badge. Avoids pulling the full snapshot on every page load.
export async function GET() {
  return handle(async () => ok(await getActiveStatus()))
}
