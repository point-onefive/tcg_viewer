import { handle, ok, readJson } from '@/lib/tournament/http'
import { dropSelf, dropSelfByWallet, hostDropPlayer, TournamentError } from '@/lib/tournament/service'
import { getSession } from '@/lib/wallet/session'
import { getProfile } from '@/lib/wallet/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  // Self-drop with a player token, OR host-drop a specific player. The default
  // self-drop path is wallet-backed (no token needed in the body).
  playerToken?: string
  hostToken?: string
  playerId?: string
}

// POST /api/tournaments/:code/drop - a player drops themselves, or the host
// drops a player. Dropped players are skipped by pairing and stop giving wins;
// if the event is live, the player's open match is forfeited so the round can
// still advance.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const body = await readJson<Body>(request)
    if (body.hostToken && body.playerId) {
      await hostDropPlayer(code, body.hostToken, body.playerId)
      return ok({ ok: true })
    }
    if (body.playerToken) {
      await dropSelf(code, body.playerToken)
      return ok({ ok: true })
    }
    // Wallet-backed self-drop: identify the caller from their signed-in session.
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to drop from the tournament.', 401)
    }
    const profile = await getProfile(session.address)
    await dropSelfByWallet(code, session.address, profile?.xHandle ?? null)
    return ok({ ok: true })
  })
}
