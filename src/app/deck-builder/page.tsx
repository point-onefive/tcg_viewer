import type { Metadata } from 'next'
import { DeckBuilder } from '@/components/deck-builder/deck-builder'

export const metadata: Metadata = {
  title: 'Deck builder · The Card Wall',
  description:
    'Build, visualize, and export trading-card decks. Add cards from the wall, tweak quantities and alt art, and copy a sim-ready list. Runs locally in your browser.',
}

export default function DeckBuilderPage() {
  return <DeckBuilder />
}
