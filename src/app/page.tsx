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
  const rawSets = getSets(activeCollection)
  // Filter the set list to hide any set that is empty under the current
  // JP setting (e.g. ST-30, which is 100% JP-exclusive, vanishes from the
  // Set dropdown when JP is off). Without this filter the dropdown was
  // the loudest "nothing changed" signal in the page: a user would flip
  // JP off, see ST-30 still listed, scroll to it, find it empty, and
  // conclude the toggle was broken. Mixed-region sets like PROMO stay
  // listed; their count just shrinks.
  const sets = useMemo(() => {
    const codesWithCards = new Set(cards.map((c) => c.setCode))
    return rawSets.filter((s) => codesWithCards.has(s.setCode))
  }, [rawSets, cards])
  // Count of JP-exclusive entries in the raw data (does NOT change when
  // the toggle flips, so we read it off `rawCards` rather than `cards`).
  // Surfaced on the JP pill as "JP · 432" so the user always knows how
  // much content the toggle controls, even when they're scrolled to a
  // part of the wall (OP01, OP02...) where flipping the toggle has no
  // visible effect because no card in that region is JP-exclusive.
  const jpExclusiveCount = useMemo(
    () =>
      rawCards.reduce((n, c) => {
        if (c.regions?.length === 1 && c.regions[0] === 'JP') return n + 1
        const jpVariants = (c.variants ?? []).filter(
          (v) => v.regions?.length === 1 && v.regions[0] === 'JP',
        ).length
        return n + jpVariants
      }, 0),
    [rawCards],
  )
  const ready = hasData(activeCollection)

  // The old first-visit OnboardingTour was removed in favour of a
  // standalone /help page reachable from the HelpCircle icon in the
  // header. Rationale: the tour was perma-stale (UI features kept
  // outpacing the 7-step script) and only ever ran on the user's
  // first paint; a document at /help serves first-timers and the
  // returning user who forgot how the tier-list maker works.
  return (
    <main className="relative min-h-screen">
      <Header sets={sets} jpExclusiveCount={jpExclusiveCount} />
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
