import type { Metadata } from 'next'
import { PastTournamentView } from '@/components/tournament/past-tournament-view'

export const metadata: Metadata = {
  title: 'Paid game · The Card Wall',
  description: 'A paid Card Wall tournament: entry, bracket, standings, and payouts.',
}

// Paid game page, under the always-on /tournaments/play surface. For now this
// reuses the themed by-code view so the paid surface has its own URL space; the
// interactive deposit step + live paid-game controls land here in the next
// Phase 3 pass once the escrow is deployed.
export default async function PaidGameByCodePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return <PastTournamentView code={code} />
}
