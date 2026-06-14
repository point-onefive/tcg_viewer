import type { Metadata } from 'next'
import { TournamentAdmin } from '@/components/tournament/tournament-admin'

export const metadata: Metadata = {
  title: 'Tournament admin · The Card Wall',
  robots: { index: false, follow: false },
}

export default function TournamentAdminPage() {
  return <TournamentAdmin />
}
