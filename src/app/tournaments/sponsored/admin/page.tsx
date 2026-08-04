import type { Metadata } from 'next'
import { TournamentAdmin } from '@/components/tournament/tournament-admin'

export const metadata: Metadata = {
  title: 'Tournament admin · The Card Wall',
  robots: { index: false, follow: false },
}

// Admin console for the free featured event. Mode defaults to "featured".
export default function SponsoredTournamentAdminPage() {
  return <TournamentAdmin />
}
