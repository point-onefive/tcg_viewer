import { handle, ok, readJson } from '@/lib/tournament/http'
import { closeEnrollmentAndGenerate } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  hostToken: string
}

// POST /api/tournaments/:code/close — host closes enrollment and generates
// round 1 (assigns seeds, builds pairings + byes).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const { hostToken } = await readJson<Body>(request)
    await closeEnrollmentAndGenerate(code, hostToken)
    return ok({ ok: true })
  })
}
