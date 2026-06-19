import { handle, ok, readJson } from '@/lib/tournament/http'
import { getOwnDeck, submitDeckList, TournamentError } from '@/lib/tournament/service'
import { getSession } from '@/lib/wallet/session'
import { getProfile } from '@/lib/wallet/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/:code/deck - the signed-in player's own deck list.
//
// Wallet-backed: returns only the caller's own committed list (resolved from
// their wallet / profile handle), so deck contents stay private to the owner
// and the host. Use this to let a player pull up the list they are locked into
// during the event, and to know whether they still owe one.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to view your deck list.', 401)
    }
    const profile = await getProfile(session.address)
    const result = await getOwnDeck(code, session.address, profile?.xHandle ?? '')
    return ok(result)
  })
}

// POST /api/tournaments/:code/deck - submit the caller's deck list (set-once).
//
// For players who entered without a list (waitlist conversions). Locked once
// set: the service refuses to overwrite an existing list, so a player can never
// swap decks mid-event. Operator typo fixes go through the admin set-deck path.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to submit your deck list.', 401)
    }
    const profile = await getProfile(session.address)
    const body = await readJson<{ deckList?: string }>(request)
    if (!body?.deckList || String(body.deckList).trim() === '') {
      throw new TournamentError('Paste your deck list to submit.', 422)
    }
    const result = await submitDeckList(
      code,
      session.address,
      profile?.xHandle ?? '',
      body.deckList,
    )
    return ok(result, 201)
  })
}
