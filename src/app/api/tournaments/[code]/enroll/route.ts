import { handle, ok, readJson } from '@/lib/tournament/http'
import { enroll } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  xHandle: string
}

// POST /api/tournaments/:code/enroll - sign up with your X handle
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const body = await readJson<Body>(request)
    const result = await enroll(code, body.xHandle)
    return ok(result, 201)
  })
}
