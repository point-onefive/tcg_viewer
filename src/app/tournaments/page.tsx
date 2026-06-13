import type { Metadata } from 'next'
import { TournamentHome } from '@/components/tournament/tournament-home'

export const metadata: Metadata = {
  title: 'Tournaments · The Card Wall',
  description:
    'Host or join a TCG tournament. Open enrollment, automatic Swiss / single-elim brackets, async scheduling across time zones, and self-reported results. Free, no account needed.',
}

export default function TournamentsPage() {
  return <TournamentHome />
}
