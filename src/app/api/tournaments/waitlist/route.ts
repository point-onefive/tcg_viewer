import { handle, ok } from '@/lib/tournament/http'
import { joinWaitlist, waitlistStatus } from '@/lib/tournament/waitlist'
import { getSession } from '@/lib/wallet/session'
import { getProfile } from '@/lib/wallet/db'
import { TournamentError } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/tournaments/waitlist - public status: is the waitlist live, how many
// are in line, and (when signed in) whether this wallet is already on it.
// Returns available:false (not an error) when the backing table is not created
// yet, so the UI hides the card cleanly.
export async function GET() {
  return handle(async () => {
    const session = await getSession().catch(() => null)
    const status = await waitlistStatus(session?.address ?? null)
    return ok(status)
  })
}

// POST /api/tournaments/waitlist - join the next-event waitlist.
//
// Wallet-backed: requires an active session. The X handle is pulled from the
// signed-in wallet's profile (never the request body), so there is nothing to
// retype or spoof. A profile with no X handle is rejected with guidance.
export async function POST() {
  return handle(async () => {
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to join the waitlist.', 401)
    }
    const profile = await getProfile(session.address)
    if (!profile?.xHandle) {
      throw new TournamentError(
        'Add your X handle to your profile first, then join the waitlist.',
        422,
      )
    }
    const result = await joinWaitlist(session.address, profile.xHandle)
    return ok(result, 201)
  })
}
