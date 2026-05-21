'use client'

import { useMemo } from 'react'
import { getCards, getSets, hasData } from '@/lib/data'
import { useStore } from '@/lib/store'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'
import { Footer } from '@/components/gallery/footer'
import { applyRegionFilter, hasJpContent } from '@/lib/card-filter'

export default function Home() {
  const activeCollection = useStore((s) => s.activeCollection)
  const jpOnly = useStore((s) => s.jpOnly)
  const rawCards = getCards(activeCollection)
  // applyRegionFilter is the single chokepoint for the JP toggle. Every
  // surface that lists cards (grid, lightbox, board, alt-art counts)
  // gets the same filtered view because they all receive these `cards`
  // -- there's no second-pass filter that could disagree with itself.
  //
  // Default (jpOnly=false): strips JP-only base cards + JP-only variants
  // for a noise-free EN-focused catalogue. JP on: narrows the wall to
  // only the ~350 cards with JP-exclusive content, with variants intact.
  const cards = useMemo(() => applyRegionFilter(rawCards, jpOnly), [rawCards, jpOnly])
  const rawSets = getSets(activeCollection)
  // Filter the set list to hide any set that is empty under the current
  // filter (e.g. when JP is on, EN-only sets like OP-12 may have very
  // few or no cards left; when JP is off, the all-JP ST-30 vanishes).
  // Without this filter the set dropdown would still list "empty" sets
  // and the page would feel unresponsive to the toggle.
  const sets = useMemo(() => {
    const codesWithCards = new Set(cards.map((c) => c.setCode))
    return rawSets.filter((s) => codesWithCards.has(s.setCode))
  }, [rawSets, cards])
  // How many cards the JP-only filter would surface if the user clicks
  // it right now (i.e. the future wall size after the narrow). Shown on
  // the pill as "JP 353" so the user sees the magnitude of the change
  // before clicking - same idea as showing "1.2k results" next to a
  // search query. Read off `rawCards` because the count is a property
  // of the bundle, not the current filter state.
  const jpEligibleCount = useMemo(
    () => rawCards.filter(hasJpContent).length,
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
      <Header sets={sets} jpEligibleCount={jpEligibleCount} />
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
