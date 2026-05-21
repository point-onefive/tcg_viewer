'use client'

import { useMemo } from 'react'
import { getCards, getSets, hasData } from '@/lib/data'
import { useStore } from '@/lib/store'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'
import { Footer } from '@/components/gallery/footer'
import { applyLanguageFilter, hasExclusiveTo, exclusiveBucketOf } from '@/lib/card-filter'

export default function Home() {
  const activeCollection = useStore((s) => s.activeCollection)
  const language = useStore((s) => s.language)
  const rawCards = getCards(activeCollection)
  // applyLanguageFilter is the single chokepoint for the language
  // picker. Every surface that lists cards (grid, lightbox, board,
  // alt-art counts) gets the same filtered view because they all
  // receive these `cards` -- there's no second-pass filter that
  // could disagree with itself.
  const cards = useMemo(
    () => applyLanguageFilter(rawCards, language),
    [rawCards, language],
  )
  const rawSets = getSets(activeCollection)
  // Filter the set list to hide any set that is empty under the current
  // filter (when CN is selected, sets that aren't published in TC/TW
  // shouldn't appear; same for JP/EN narrowing). Without this filter the
  // set dropdown would still list "empty" sets and the page would feel
  // unresponsive to the language picker.
  const sets = useMemo(() => {
    const codesWithCards = new Set(cards.map((c) => c.setCode))
    return rawSets.filter((s) => codesWithCards.has(s.setCode))
  }, [rawSets, cards])
  // How many distinct cards live in each bucket / surface in the
  // EXCLUSIVES pivot. Drives the small count badge on the Exclusives
  // pill so the user sees the magnitude before clicking. The
  // EXCLUSIVES total uses `exclusiveBucketOf` (same predicate as the
  // EXCLUSIVES filter mode) so the badge always equals the wall's
  // tile count -- no off-by-N illusions when a card carries an
  // exclusive print in multiple buckets.
  const exclusiveCounts = useMemo(() => {
    let EN = 0, JP = 0, CN = 0, EXCLUSIVES = 0
    for (const c of rawCards) {
      if (hasExclusiveTo(c, 'EN')) EN++
      if (hasExclusiveTo(c, 'JP')) JP++
      if (hasExclusiveTo(c, 'CN')) CN++
      if (exclusiveBucketOf(c)) EXCLUSIVES++
    }
    return { EN, JP, CN, EXCLUSIVES }
  }, [rawCards])
  const ready = hasData(activeCollection)

  // The old first-visit OnboardingTour was removed in favour of a
  // standalone /help page reachable from the HelpCircle icon in the
  // header. Rationale: the tour was perma-stale (UI features kept
  // outpacing the 7-step script) and only ever ran on the user's
  // first paint; a document at /help serves first-timers and the
  // returning user who forgot how the tier-list maker works.
  return (
    <main className="relative min-h-screen">
      <Header sets={sets} exclusiveCounts={exclusiveCounts} />
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
