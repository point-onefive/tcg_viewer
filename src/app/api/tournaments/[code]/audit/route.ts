import { handle, ok } from '@/lib/tournament/http'
import { getPaidDeckAudit } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/:code/audit - public, unauthenticated deck-audit feed
// for a PAID game. The service enforces both guarantees: it throws 404 for a
// free/featured tournament (decks never leak here), and it only attaches deck
// contents once the event is complete (the reveal gate). No tokens ever.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const audit = await getPaidDeckAudit(code)
    return ok(audit)
  })
}
