'use client'

import { getCards, getSets, hasData } from '@/lib/data'
import { useStore } from '@/lib/store'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'
import { Footer } from '@/components/gallery/footer'

export default function Home() {
  const activeCollection = useStore((s) => s.activeCollection)
  const cards = getCards(activeCollection)
  const sets = getSets(activeCollection)
  const ready = hasData(activeCollection)

  return (
    <main className="relative min-h-screen">
      <Header sets={sets} />
      {ready ? (
        <>
          <CardGrid cards={cards} sets={sets} />
          <LightboxViewer cards={cards} />
        </>
      ) : (
        <div className="pt-24 px-6 text-center" style={{ color: 'var(--text-muted)' }}>
          <p className="text-sm">This collection is coming soon.</p>
        </div>
      )}
      <BoardPanel cards={cards} />
      <Footer />
    </main>
  )
}
