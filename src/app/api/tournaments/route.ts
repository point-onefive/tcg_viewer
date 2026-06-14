import { handle, ok, readJson } from '@/lib/tournament/http'
import { assertAdmin } from '@/lib/tournament/admin-auth'
import { createTournament } from '@/lib/tournament/service'
import type { CreateTournamentInput } from '@/lib/tournament/types'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/tournaments - admin-only legacy create (prefer /admin start-fresh)
export async function POST(request: Request) {
  return handle(async () => {
    assertAdmin(request)
    const body = await readJson<CreateTournamentInput>(request)
    const result = await createTournament(body)
    return ok(result, 201)
  })
}
