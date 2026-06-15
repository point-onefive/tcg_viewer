import { handle, ok, readJson } from '@/lib/tournament/http'
import { castPollVote } from '@/lib/tournament/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface Body {
  voterId: string
  choice: string
}

// POST /api/tournaments/poll - cast one prize-split vote for the live event
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson<Body>(request)
    const poll = await castPollVote(body.voterId, body.choice)
    return ok({ poll })
  })
}
