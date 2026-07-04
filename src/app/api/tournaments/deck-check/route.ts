import { handle, ok, readJson } from '@/lib/tournament/http'
import { TournamentError } from '@/lib/tournament/service'
import { checkDeckList } from '@/lib/tournament/deck-check'
import { normalizeDeckList, validateDeckList } from '@/lib/tournament/deck-list'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/tournaments/deck-check - advisory deck-list validation.
//
// Public + read-only: resolves every card code against the One Piece bundle and
// checks the format (1 leader + 50 cards) so the sign-up form can show a live
// pass/fail before a player commits their (final) list. It never stores or
// mutates anything. The card catalog is already public, so exposing "does this
// code resolve" leaks nothing. Kept server-side so the ~2.6k-card bundle never
// ships to the browser.
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson<{ deckList?: string }>(request)
    const raw = String(body?.deckList ?? '')
    // Reuse the light gate for the size caps so a paste bomb can't reach the
    // resolver; an empty list just returns a "no codes" fail.
    const capped = validateDeckList(raw)
    if (!capped.ok) throw new TournamentError(capped.error, 422)
    const check = checkDeckList(normalizeDeckList(raw))
    return ok({ ...check })
  })
}
