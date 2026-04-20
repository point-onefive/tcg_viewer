'use client'

import { getCards, getSets } from '@/lib/data'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'

export default function Home() {
  const cards = getCards()
  const sets = getSets()

  return (
    <main className="relative min-h-screen">
      <Header sets={sets} />
      <CardGrid cards={cards} sets={sets} />
      <LightboxViewer cards={cards} />
      <BoardPanel cards={cards} />
    </main>
  )
}
