'use client'

import { useMemo } from 'react'
import { getCards, getSets, hasData } from '@/lib/data'
import { useStore } from '@/lib/store'
import { Header } from '@/components/gallery/header'
import { CardGrid } from '@/components/gallery/card-grid'
import { LightboxViewer } from '@/components/gallery/lightbox-viewer'
import { BoardPanel } from '@/components/gallery/board-panel'
import { Footer } from '@/components/gallery/footer'
import { applyLanguageFilter } from '@/lib/card-filter'
import { COLLECTION_FACETS } from '@/lib/collection-facets'

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
  // Sorted unique artist list - only collections where cards carry the
  // artist field (currently Pokémon). Empty array for all others so
  // the Header can conditionally render the typeahead without importing
  // collection-specific logic.
  const artists = useMemo(() => {
    const seen = new Set<string>()
    for (const c of cards) {
      if (c.artist) seen.add(c.artist)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [cards])
  // Sorted unique character/leader names for the multi-select picker.
  // Only collections whose facet config declares `characterTypes` (One
  // Piece today) produce a non-empty list; the Header hides the picker
  // otherwise. Derived from the live, language-filtered card view so the
  // roster always matches what's actually on the wall.
  const characters = useMemo(() => {
    const types = COLLECTION_FACETS[activeCollection].characterTypes
    if (!types || types.length === 0) return []
    const typeSet = new Set(types)
    const seen = new Set<string>()
    for (const c of cards) {
      if (c.cardType && typeSet.has(c.cardType) && c.name) seen.add(c.name)
    }
    return [...seen].sort((a, b) => a.localeCompare(b))
  }, [cards, activeCollection])
  const ready = hasData(activeCollection)

  // The old first-visit OnboardingTour was removed in favour of a
  // standalone /help page reachable from the HelpCircle icon in the
  // header. Rationale: the tour was perma-stale (UI features kept
  // outpacing the 7-step script) and only ever ran on the user's
  // first paint; a document at /help serves first-timers and the
  // returning user who forgot how the tier-list maker works.
  return (
    <main className="relative min-h-screen">
      <Header sets={sets} artists={artists} characters={characters} />
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
