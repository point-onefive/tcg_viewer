import type { Metadata } from 'next'
import { DeckCheckTool } from '@/components/tools/deck-check-tool'

export const metadata: Metadata = {
  title: 'Deck-integrity checker · The Card Wall',
  description:
    'Paste an OPTCG Sim battle log and a registered decklist to check whether the deck a player registered matches the deck they actually played. Read-only and never penalizes anyone.',
}

// Public, always-on tool. Runs entirely client-side (no secrets), so it is a
// plain client component under a static route.
export default function DeckCheckPage() {
  return <DeckCheckTool />
}
