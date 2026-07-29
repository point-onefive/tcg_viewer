import type { Metadata } from 'next'
import { TournamentLive } from '@/components/tournament/tournament-live'

export const metadata: Metadata = {
  title: 'Paid game · The Card Wall',
  description: 'A paid Card Wall tournament: entry, bracket, standings, and payouts.',
}

// Paid game page (always-on /tournaments/play surface). Renders the exact same
// interactive experience as the featured event - register, deposit the entry,
// report results, standings, payouts - just scoped to one game by code. The
// deposit step + winnings claim come from the PaidDepositPanel that
// TournamentLive shows for paid games.
export default async function PaidGameByCodePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return <TournamentLive code={code} />
}
