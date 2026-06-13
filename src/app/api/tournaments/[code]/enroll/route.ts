import { handle, ok, readJson } from '@/lib/tournament/http'
import { enroll } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  displayName: string
  discordHandle?: string | null
}

// POST /api/tournaments/:code/enroll — join an open tournament. Returns the
// new player and their secret player token (shown once).
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const body = await readJson<Body>(request)
    const result = await enroll(code, body.displayName, body.discordHandle)
    return ok(result, 201)
  })
}
