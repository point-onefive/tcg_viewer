import { handle, ok, readJson } from '@/lib/tournament/http'
import { createTournament } from '@/lib/tournament/service'
import type { CreateTournamentInput } from '@/lib/tournament/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/tournaments — create a tournament. Returns the public record plus
// the secret host token (shown to the creator exactly once).
export async function POST(request: Request) {
  return handle(async () => {
    const body = await readJson<CreateTournamentInput>(request)
    const result = await createTournament(body)
    return ok(result, 201)
  })
}
