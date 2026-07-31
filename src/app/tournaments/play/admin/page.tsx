import type { Metadata } from 'next'
import { TournamentAdmin } from '@/components/tournament/tournament-admin'

export const metadata: Metadata = {
  title: 'Paid tournament admin · The Card Wall',
  robots: { index: false, follow: false },
}

// Separate admin surface for the always-on paid lobbies (/tournaments/play).
// Static `admin` segment takes precedence over the sibling `[code]` route, and
// paid codes are PG-prefixed so there is no collision. See the featured console
// at /tournaments/admin.
export default function PaidTournamentAdminPage() {
  return <TournamentAdmin mode="paid" />
}
