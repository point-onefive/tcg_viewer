'use client'

import { useMemo } from 'react'
import { getCards, getSets, hasData } from '@/lib/data'
import { useStore } from '@/lib/store'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'
import { Footer } from '@/components/gallery/footer'
import { applyLanguageFilter, hasExclusiveTo } from '@/lib/card-filter'

export default function Home() {
  const activeCollection = useStore((s) => s.activeCollection)
  const language = useStore((s) => s.language)
  const onlyExclusives = useStore((s) => s.onlyExclusives)
  const rawCards = getCards(activeCollection)
  // applyLanguageFilter is the single chokepoint for the language
  // picker. Every surface that lists cards (grid, lightbox, board,
  // alt-art counts) gets the same filtered view because they all
  // receive these `cards` -- there's no second-pass filter that
  // could disagree with itself.
  const cards = useMemo(
    () => applyLanguageFilter(rawCards, language, onlyExclusives),
    [rawCards, language, onlyExclusives],
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
  // How many cards the "Exclusives" toggle would surface if the user
  // clicks it right now -- the count is per-language, so the header can
  // render "EN-only 253 / JP-only 39 / CN-only 0" depending on what's
  // picked. Read off `rawCards` because the count is a property of the
  // bundle, not the current filter state.
  const exclusiveCounts = useMemo(() => ({
    EN: rawCards.filter((c) => hasExclusiveTo(c, 'EN')).length,
    JP: rawCards.filter((c) => hasExclusiveTo(c, 'JP')).length,
    CN: rawCards.filter((c) => hasExclusiveTo(c, 'CN')).length,
  }), [rawCards])
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
