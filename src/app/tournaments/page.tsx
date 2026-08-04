import type { Metadata } from 'next'
import { TournamentsHome } from '@/components/tournament/tournaments-home'

export const metadata: Metadata = {
  title: 'Tournaments · The Card Wall',
  description:
    'Two ways to play The Card Wall: free featured community events, or paid games with a USDC pot on Base paid out on-chain.',
}

// Chooser landing that splits the two tournament products: the free featured
// "Sponsored" side (/tournaments/sponsored) and the always-on "Paid" side
// (/tournaments/paid). The former live-event page now lives at
// /tournaments/sponsored.
export default function TournamentsPage() {
  return <TournamentsHome />
}
