import type { Metadata } from 'next'
import { PastTournamentView } from '@/components/tournament/past-tournament-view'

export const metadata: Metadata = {
  title: 'Tournament results · The Card Wall',
  description: 'Final standings, champion, and published deck lists for a completed Card Wall tournament.',
}

// Read-only permalink for any tournament by code. The live event also lives at
// /tournaments; this route is the shareable archive page for past events.
export default async function TournamentByCodePage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return <PastTournamentView code={code} />
}
