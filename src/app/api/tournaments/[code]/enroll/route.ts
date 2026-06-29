import { handle, ok, readJson } from '@/lib/tournament/http'
import { enroll, TournamentError } from '@/lib/tournament/service'
import { getSession } from '@/lib/wallet/session'
import { getProfile } from '@/lib/wallet/db'
import { sanitizeRegion } from '@/lib/tournament/region'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/tournaments/:code/enroll - sign up for a tournament.
//
// Wallet-backed: requires an active session. The X handle is pulled from the
// signed-in wallet's profile (never the request body), so the handle is owned,
// verified, and impossible to spoof. A profile with no X handle is rejected
// with guidance. This mirrors the next-event waitlist so sign-in is consistent
// across every tournament action.
//
// A deck list is required at public sign-up (the operator add-player path stays
// optional for walk-ins, who submit theirs before the bracket locks).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to sign up.', 401)
    }
    const profile = await getProfile(session.address)
    if (!profile?.xHandle) {
      throw new TournamentError(
        'Add your X handle to your profile first, then sign up.',
        422,
      )
    }
    const body = await readJson<{ deckList?: string; region?: string | null }>(request)
    if (!body?.deckList || String(body.deckList).trim() === '') {
      throw new TournamentError('Paste your deck list to sign up.', 422)
    }
    // Region is required at public sign-up; fall back to the profile's saved
    // region so a returning player who set it once doesn't have to re-pick.
    const region = sanitizeRegion(body.region) ?? profile.region
    if (!region) {
      throw new TournamentError('Pick the region you\u2019ll be playing from.', 422)
    }
    const result = await enroll(code, profile.xHandle, body.deckList, session.address, region)
    return ok(result, 201)
  })
}
