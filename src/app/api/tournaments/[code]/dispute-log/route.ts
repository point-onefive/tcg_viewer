import { handle, ok, readJson } from '@/lib/tournament/http'
import { attachDisputeLog, TournamentError } from '@/lib/tournament/service'
import { getSession } from '@/lib/wallet/session'
import { getProfile } from '@/lib/wallet/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  matchId: string
  url?: string | null
  text?: string | null
}

// POST /api/tournaments/:code/dispute-log - a participant of a DISPUTED match
// (any tournament, paid or free/featured) attaches an OPTCG Sim battle log
// (link and/or pasted text) as evidence for the organizer. Wallet-backed: the
// signed-in wallet identifies the player. The service gates this to disputed
// matches the caller is a participant of, so it can only ever touch a match
// that is actually under review.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to attach evidence.', 401)
    }
    const profile = await getProfile(session.address)
    const body = await readJson<Body>(request)
    if (!body?.matchId) {
      throw new TournamentError('Missing match id.', 422)
    }
    await attachDisputeLog(code, body.matchId, session.address, profile?.xHandle ?? null, {
      url: body.url ?? null,
      text: body.text ?? null,
    })
    return ok({ ok: true })
  })
}
