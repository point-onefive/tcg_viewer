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

const isJpOnly = (regions?: string[]) =>
  Array.isArray(regions) && regions.length === 1 && regions[0] === 'JP'

/**
 * Does this card surface any Japan-exclusive content? True when the
 * base card itself is JP-only (e.g. ST-30, JP P-XXX promos) OR when
 * at least one of its variants is JP-only (e.g. the Family Deck Set
 * Nami ST01-007_r1). Used both to decide eligibility for the "JP"
 * narrowing filter and to compute the count shown on the pill.
 */
export function hasJpContent(card: Card): boolean {
  if (isJpOnly(card.regions)) return true
  return card.variants?.some((v) => isJpOnly(v.regions)) ?? false
}

/**
 * Apply the user's region preference to the raw card list.
 *
 * The Phase 3 ingestion put both EN cards and JP-only alt-art variants
 * into the same JSON bundle. Two modes:
 *
 *   - jpOnly: false (DEFAULT)
 *       Regular EN-focused catalogue. Strip JP-only base cards from
 *       the wall and JP-only variants from each card's carousel, so
 *       the gallery looks identical to before the JP merge landed.
 *       This is the "no noise" mode.
 *
 *   - jpOnly: true
 *       Narrow the wall to ONLY cards that have JP-exclusive content
 *       (JP-only base cards + cards with at least one JP-only variant).
 *       Inside each surfaced card, leave every variant intact so the
 *       JP Family Deck Set, Storage Box, magazine promos, etc. are
 *       visible alongside the EN art for comparison.
 *
 * Mirrors how `onlyAltArt` works: clicking it narrows the wall to the
 * subset the user is currently interested in, rather than silently
 * adding/removing content they may never scroll to.
 *
 * Runs BEFORE filterCards so the alt-art toggle counts only visible
 * variants (otherwise a card whose only "alt art" is a hidden JP
 * variant would falsely appear in "Alt art" results with an empty
 * carousel).
 */
export function applyRegionFilter(cards: Card[], jpOnly: boolean): Card[] {
  if (jpOnly) {
    // JP-only mode: keep cards with JP content, leave variants intact.
    return cards.filter(hasJpContent)
  }
  // Default mode: strip JP-only base cards + JP-only variants.
  const out: Card[] = []
  for (const c of cards) {
    if (isJpOnly(c.regions)) continue
    const variants = c.variants?.filter((v) => !isJpOnly(v.regions))
    if (variants === c.variants) {
      out.push(c)
    } else {
      // New variants array (possibly empty -> store `undefined` so
      // downstream `c.variants?.length` checks behave the same as a
      // card that never had variants in the first place).
      out.push({ ...c, variants: variants && variants.length > 0 ? variants : undefined })
    }
  }
  return out
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
