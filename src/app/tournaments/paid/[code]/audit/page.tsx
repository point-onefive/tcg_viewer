import type { Metadata } from 'next'
import { PaidDeckAudit } from '@/components/tournament/paid-deck-audit'

export const metadata: Metadata = {
  title: 'Deck audit · The Card Wall',
  description:
    'Public deck audit for a paid Card Wall tournament. Compare each competitor\u2019s registered decklist against their match replay.',
}

// Public, unauthenticated deck-audit page for a paid game. Decklists are shown
// once the event concludes; before then the page explains they are revealed at
// the end. The underlying API refuses to serve free/featured tournaments.
export default async function PaidDeckAuditPage({
  params,
}: {
  params: Promise<{ code: string }>
}) {
  const { code } = await params
  return <PaidDeckAudit code={code} />
}
