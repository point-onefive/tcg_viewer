import type { Metadata } from 'next'
import { TournamentLive } from '@/components/tournament/tournament-live'
import { TournamentGate } from '@/components/tournament/tournament-gate'

export const metadata: Metadata = {
  title: 'Tournament · The Card Wall',
  description: 'Sign up with your X handle for the current Card Wall Swiss tournament.',
}

export default function TournamentsPage() {
  return (
    <TournamentGate>
      <TournamentLive />
    </TournamentGate>
  )
}
