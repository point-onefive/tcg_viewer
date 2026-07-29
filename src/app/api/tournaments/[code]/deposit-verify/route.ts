import { handle, ok, readJson } from '@/lib/tournament/http'
import { confirmDeposit, TournamentError } from '@/lib/tournament/service'
import { getSession } from '@/lib/wallet/session'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/tournaments/:code/deposit-verify - confirm a paid-entry USDC
// deposit on Base and flip the player's `funded` flag.
//
// Wallet-backed: the depositing wallet is the signed-in wallet (same one used
// to enroll), never the request body, so a player can only fund their own
// entry. The server holds no signing key and moves no money - it only READS
// the chain to confirm the deposit tx (see lib/tournament/escrow). Approve-
// then-pay: the entry must already be approved.
export async function POST(
  request: Request,
  { params }: { params: Promise<{ code: string }> },
) {
  return handle(async () => {
    const { code } = await params
    const session = await getSession()
    if (!session) {
      throw new TournamentError('Connect your wallet to confirm your deposit.', 401)
    }
    const body = await readJson<{ txHash?: string }>(request)
    if (!body?.txHash || String(body.txHash).trim() === '') {
      throw new TournamentError('Provide the deposit transaction hash.', 422)
    }
    const player = await confirmDeposit(code, session.address, body.txHash)
    return ok({ player }, 200)
  })
}
