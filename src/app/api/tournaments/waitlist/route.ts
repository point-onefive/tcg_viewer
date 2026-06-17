import { handle, ok, readJson } from '@/lib/tournament/http'
import { joinWaitlist, waitlistStatus } from '@/lib/tournament/waitlist'
import { getSession } from '@/lib/wallet/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  xHandle: string
}

// GET /api/tournaments/waitlist - public status: is the waitlist live, and how
// many are in line. Returns available:false (not an error) when the backing
// table is not created yet, so the UI hides the card cleanly.
export async function GET() {
  return handle(async () => {
    const status = await waitlistStatus()
    return ok(status)
  })
}

// POST /api/tournaments/waitlist - frictionless "notify me next time" sign-up.
// Just an X handle. If the visitor happens to be signed in, we attach their
// wallet address too, but it is never required.
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson<Body>(request)
    const session = await getSession().catch(() => null)
    const result = await joinWaitlist(body.xHandle, session?.address ?? null)
    return ok(result, 201)
  })
}
