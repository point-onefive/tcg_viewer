import type { Metadata } from 'next'
import { TournamentLive } from '@/components/tournament/tournament-live'

export const metadata: Metadata = {
  title: 'Tournament · The Card Wall',
  description: 'Sign in with your wallet and link your X handle for the current Card Wall tournament.',
}

export default function TournamentsPage() {
  return <TournamentLive />
}
