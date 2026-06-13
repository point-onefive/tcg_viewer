import { handle, ok, readJson } from '@/lib/tournament/http'
import { acceptSchedule, proposeSchedule } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface ProposeBody {
  action: 'propose'
  matchId: string
  playerToken: string
  slots: string[]
}
interface AcceptBody {
  action: 'accept'
  matchId: string
  playerToken: string
  proposalId: string
  slot: string
}
type Body = ProposeBody | AcceptBody

// POST /api/tournaments/:code/schedule — propose UTC slots, or accept one of
// the opponent's proposed slots. All times stored UTC, rendered local client-side.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const body = await readJson<Body>(request)
    if (body.action === 'propose') {
      await proposeSchedule(code, body.matchId, body.playerToken, body.slots)
    } else if (body.action === 'accept') {
      await acceptSchedule(code, body.matchId, body.playerToken, body.proposalId, body.slot)
    }
    return ok({ ok: true })
  })
}
