'use client'

import { useMemo } from 'react'
import { getCards, getSets, hasData } from '@/lib/data'
import { useStore } from '@/lib/store'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'
import { Footer } from '@/components/gallery/footer'
import { applyRegionFilter } from '@/lib/card-filter'

export default function Home() {
  const activeCollection = useStore((s) => s.activeCollection)
  const showJpVariants = useStore((s) => s.showJpVariants)
  const rawCards = getCards(activeCollection)
  // applyRegionFilter is the single chokepoint for the JP toggle. Every
  // surface that lists cards (grid, lightbox, board, alt-art counts)
  // gets the same filtered view because they all receive these `cards`
  // -- there's no second-pass filter that could disagree with itself.
  const cards = useMemo(() => applyRegionFilter(rawCards, showJpVariants), [rawCards, showJpVariants])
  const sets = getSets(activeCollection)
  const ready = hasData(activeCollection)

  // The old first-visit OnboardingTour was removed in favour of a
  // standalone /help page reachable from the HelpCircle icon in the
  // header. Rationale: the tour was perma-stale (UI features kept
  // outpacing the 7-step script) and only ever ran on the user's
  // first paint; a document at /help serves first-timers and the
  // returning user who forgot how the tier-list maker works.
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
