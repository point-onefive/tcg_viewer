import { handle, ok, readJson } from '@/lib/tournament/http'
import { dropSelf, hostDropPlayer } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  // Self-drop with a player token, OR host-drop a specific player.
  playerToken?: string
  hostToken?: string
  playerId?: string
}

// POST /api/tournaments/:code/drop — a player drops themselves, or the host
// drops a player. Dropped players are skipped by pairing and stop giving wins.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const body = await readJson<Body>(request)
    if (body.hostToken && body.playerId) {
      await hostDropPlayer(code, body.hostToken, body.playerId)
    } else if (body.playerToken) {
      await dropSelf(code, body.playerToken)
    }
    return ok({ ok: true })
  })
}
