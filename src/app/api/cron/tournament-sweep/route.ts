import { handle, ok, fail } from '@/lib/tournament/http'
import { isTournamentBackendConfigured } from '@/lib/tournament/supabase'
import { sweep } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/cron/tournament-sweep - hands-off maintenance, run by Vercel Cron
// (see vercel.json). Auto-closes enrollment timers, confirms ghosted
// single-sided reports past the window, and advances rounds.
//
// Protected by CRON_SECRET: Vercel Cron sends `Authorization: Bearer <secret>`.
// If CRON_SECRET is unset (local/dev) the route is open so you can curl it.
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (secret) {
    const auth = request.headers.get('authorization')
    if (auth !== `Bearer ${secret}`) return fail('Unauthorized', 401)
  }
  if (!isTournamentBackendConfigured()) {
    return ok({ skipped: 'backend not configured' })
  }
  return handle(async () => {
    const summary = await sweep()
    return ok({ ok: true, ...summary })
  })
}
