import type { Card } from './types'

/**
 * The active filter state read off the Zustand store. Kept as a plain
 * value object (not a hook) so server-side scripts, tests, or future
 * non-React surfaces (e.g. URL-encoded share links) can call
 * filterCards() with arbitrary inputs.
 */
export interface CardFilterState {
  activeSet: string | null
  activeRarity: string | null
  activeColor: string | null
  activeCardType: string | null
  onlyAltArt: boolean
  searchQuery: string
}

/**
 * Apply every active filter to a card list, returning a new array.
 *
 * Single source of truth for "what's currently visible on the wall."
 * Both CardGrid (renders the wall) and LightboxViewer (navigates the
 * wall via arrow keys / next-prev) call this with the same inputs so
 * their definitions of "the next card" stay in sync.
 *
 * Without this shared helper, the lightbox used to navigate through
 * the *unfiltered* population - if you filtered to "Leader" cards and
 * opened the first leader, pressing ArrowRight would jump to whatever
 * non-leader card happened to be next in the JSON bundle. That was
 * confusing because the visible wall behind the lightbox showed only
 * leaders, but navigation silently ignored the filter.
 *
 * Filter order matches the previous inline implementation in
 * card-grid.tsx (set -> rarity -> color -> card type -> alt-art ->
 * search) so behaviour and result counts are identical to before.
 * Each predicate is cheap and short-circuiting; at ~2.5k cards x
 * a handful of fields the whole pass runs sub-millisecond.
 */
export function filterCards(cards: Card[], f: CardFilterState): Card[] {
  let result = cards
  if (f.activeSet) result = result.filter((c) => c.setCode === f.activeSet)
  if (f.activeRarity) result = result.filter((c) => c.rarity === f.activeRarity)
  if (f.activeColor) {
    const target = f.activeColor
    result = result.filter((c) => c.colors?.includes(target))
  }
  if (f.activeCardType) result = result.filter((c) => c.cardType === f.activeCardType)
  if (f.onlyAltArt) result = result.filter((c) => (c.variants?.length ?? 0) > 0)
  if (f.searchQuery.trim()) {
    // Search covers card rules text (effect / trigger) and tag-like
    // metadata (types, attributes), not just the name / code / set.
    // Matching is a single literal substring against the lowercased
    // haystack - so "when attacking" works as a phrase, and "reduce"
    // surfaces the cards that mention damage reduction even if
    // "reduce" isn't in their name. No whitespace-split + AND yet:
    // that would be more powerful but breaks naive phrase searches,
    // and the single-substring path matches what every other "search
    // a card pile" UI does.
    const q = f.searchQuery.toLowerCase().trim()
    result = result.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true
      if (c.code.toLowerCase().includes(q)) return true
      if (c.setName.toLowerCase().includes(q)) return true
      if ((c.effect || '').toLowerCase().includes(q)) return true
      if ((c.trigger || '').toLowerCase().includes(q)) return true
      if (c.types?.some((t) => t.toLowerCase().includes(q))) return true
      if (c.attributes?.some((a) => a.toLowerCase().includes(q))) return true
      return false
    })
  }
  return result
}
