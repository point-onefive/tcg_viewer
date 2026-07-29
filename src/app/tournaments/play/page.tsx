import type { Metadata } from 'next'
import { PaidLobby } from '@/components/tournament/paid-lobby'

export const metadata: Metadata = {
  title: 'Play for the pot · The Card Wall',
  description:
    'Always-on paid TCG tournaments. Fund your entry in USDC on Base; a smart-contract escrow holds the pot and pays the winners.',
}

// Always-on paid tournaments lobby. A separate surface from the featured-events
// page at /tournaments (which is unchanged).
export default function PlayLobbyPage() {
  return <PaidLobby />
}
