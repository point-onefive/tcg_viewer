import type { Card, CardLanguage, CardVariant, LanguagePickerValue } from './types'
import { LANGUAGE_GROUPS } from './types'

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
 * at least one of its variants is JP-only.
 *
 * Kept around for callers that haven't migrated to the new
 * `hasExclusiveTo` helper yet; under the hood it just delegates to it.
 */
export function hasJpContent(card: Card): boolean {
  return hasExclusiveTo(card, 'JP')
}

/**
 * Does the card carry at least one print exclusive to the given picker
 * bucket? "Exclusive" here means "ships only on the regions the picker
 * groups together" -- so for `picker === 'CN'` we look for prints
 * tagged `exclusiveTo: ['TC']`, `['TW']`, or `['TC','TW']` and nothing
 * else.
 *
 * Backstops on the legacy `regions` array for cards generated before
 * Phase 7 so the helper works against stale bundles too.
 */
export function hasExclusiveTo(card: Card, picker: Exclude<LanguagePickerValue, 'ALL'>): boolean {
  const bucket = LANGUAGE_GROUPS[picker]
  const inBucket = (set?: string[] | CardLanguage[]) =>
    Array.isArray(set) && set.length > 0 && (set as string[]).every((s) => bucket.includes(s as CardLanguage))
  if (inBucket(card.exclusiveTo)) return true
  // Legacy fallback: JP-only via 2-region regions tag.
  if (picker === 'JP' && isJpOnly(card.regions as string[])) return true
  if (card.variants?.some((v) => inBucket(v.exclusiveTo)) ?? false) return true
  if (picker === 'JP' && (card.variants?.some((v) => isJpOnly(v.regions as string[])) ?? false)) return true
  return false
}

/**
 * Apply the user's language preference to the raw card list.
 *
 * Behaviour matrix:
 *
 *   - language === 'ALL', onlyExclusives === false (default):
 *       Show every card. No URL swapping. Carousel shows every
 *       variant Bandai or Limitless tracks. Identical to the
 *       pre-Phase-7 default catalogue (plus the new regional alts
 *       picked up from asia-en / asia-tc / asia-tw).
 *
 *   - language === 'EN' | 'JP' | 'CN', onlyExclusives === false:
 *       Filter the wall to cards that ship in at least one matching
 *       region. Each surviving card has its `imageSmall` / `imageLarge`
 *       swapped to the matching localized scan (falling back to the
 *       canonical EN render when the localized image is missing). Each
 *       variant carousel is filtered to prints that also ship in the
 *       selected region.
 *
 *   - language === 'EN' | 'JP' | 'CN', onlyExclusives === true:
 *       Same as above, but additionally narrows the wall to cards
 *       whose BASE print is exclusive to that region. Wires up the
 *       header pill "EN-only N / JP-only N / CN-only N".
 *
 *   - onlyExclusives without a language is a no-op (defensive default).
 *
 * Always runs BEFORE filterCards so the alt-art toggle / search /
 * facet pickers all see the same post-language view.
 */
export function applyLanguageFilter(
  cards: Card[],
  language: LanguagePickerValue,
  onlyExclusives: boolean,
): Card[] {
  if (language === 'ALL') {
    if (!onlyExclusives) return cards
    // "Exclusives" without a chosen language is meaningless; treat as no-op.
    return cards
  }

  const bucket = LANGUAGE_GROUPS[language]
  const inBucket = (langs?: string[] | CardLanguage[]) =>
    Array.isArray(langs) && (langs as string[]).some((l) => bucket.includes(l as CardLanguage))

  const out: Card[] = []
  for (const c of cards) {
    // Skip the card entirely if NEITHER the base print nor any variant
    // is published in the chosen region. (A purely-Limitless card with
    // no Bandai-region tag will fall through here; that's fine -- they
    // still appear under 'ALL'.)
    const baseInRegion = inBucket(c.languages) || inBucket(c.variants?.flatMap((v) => v.languages ?? []))
    if (!baseInRegion) continue

    if (onlyExclusives && !hasExclusiveTo(c, language)) continue

    // Swap base image to the matching localized scan (first available
    // language in the picker's bucket). Falls back to the existing
    // imageSmall when no per-language map is present (older bundles).
    const baseImg = pickLocalizedImage(c.imagesByLanguage, bucket) ?? c.imageSmall

    // Trim variants to those that ship in the chosen region, swap their
    // imageUrl, and forget regional images that don't apply.
    const variants = c.variants
      ?.filter((v) => inBucket(v.languages))
      .map((v) => ({
        ...v,
        imageUrl: pickLocalizedImage(v.imagesByLanguage, bucket) ?? v.imageUrl,
      }))

    out.push({
      ...c,
      imageSmall: baseImg,
      imageLarge: baseImg,
      variants: variants && variants.length > 0 ? variants : undefined,
    })
  }
  return out
}

/**
 * Backwards-compat shim that mirrors the old jpOnly behaviour:
 *   - jpOnly === true  -> narrow to JP-content cards (no image swap).
 *   - jpOnly === false -> strip JP-only base cards + JP-only variants.
 *
 * Kept so any caller that hasn't migrated to `applyLanguageFilter`
 * doesn't break in the meantime.
 */
export function applyRegionFilter(cards: Card[], jpOnly: boolean): Card[] {
  if (jpOnly) {
    return cards.filter(hasJpContent)
  }
  const out: Card[] = []
  for (const c of cards) {
    if (isJpOnly(c.regions as string[])) continue
    const variants = c.variants?.filter((v) => !isJpOnly(v.regions as string[]))
    if (variants === c.variants) {
      out.push(c)
    } else {
      out.push({ ...c, variants: variants && variants.length > 0 ? variants : undefined })
    }
  }
  return out
}

function pickLocalizedImage(
  imagesByLanguage: Partial<Record<string, string>> | undefined,
  bucket: CardLanguage[],
): string | null {
  if (!imagesByLanguage) return null
  for (const lang of bucket) {
    const key = lang.toLowerCase()
    if (imagesByLanguage[key]) return imagesByLanguage[key]!
  }
  return null
}

/**
 * Apply every active filter to a card list, returning a new array.
 *
 * Single source of truth for "what's currently visible on the wall."
 * Both CardGrid (renders the wall) and LightboxViewer (navigates the
 * wall via arrow keys / next-prev) call this with the same inputs so
 * their definitions of "the next card" stay in sync.
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
    // Search covers card rules text (effect / trigger), tag-like
    // metadata (types, attributes), AND per-language localized names
    // (so a query in Chinese matches the TC name of a card whose EN
    // name doesn't contain the term). Matching is a single literal
    // substring against the lowercased haystack -- "when attacking"
    // works as a phrase, and a single-substring path matches what
    // every other "search a card pile" UI does.
    const q = f.searchQuery.toLowerCase().trim()
    result = result.filter((c) => {
      if (c.name.toLowerCase().includes(q)) return true
      if (c.code.toLowerCase().includes(q)) return true
      if (c.setName.toLowerCase().includes(q)) return true
      if ((c.effect || '').toLowerCase().includes(q)) return true
      if ((c.trigger || '').toLowerCase().includes(q)) return true
      if (c.types?.some((t) => t.toLowerCase().includes(q))) return true
      if (c.attributes?.some((a) => a.toLowerCase().includes(q))) return true
      if (c.namesByLanguage) {
        for (const v of Object.values(c.namesByLanguage)) {
          if (v && v.toLowerCase().includes(q)) return true
        }
      }
      return false
    })
  }
  return result
}
