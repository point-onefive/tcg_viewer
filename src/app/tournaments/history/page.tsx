import type { Metadata } from 'next'
import { TournamentHistory } from '@/components/tournament/tournament-history'

export const metadata: Metadata = {
  title: 'Past tournaments · The Card Wall',
  description: 'Browse completed Card Wall tournaments: final standings, champions, and published deck lists.',
}

export default function TournamentHistoryPage() {
  return <TournamentHistory />
}
