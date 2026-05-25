import type { Card, CardLanguage, CardVariant, LanguagePickerValue } from './types'
import { LANGUAGE_GROUPS, LANGUAGE_BUCKETS } from './types'

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
 * Does this card surface any region-exclusive content in the given
 * picker bucket? Returns true when EITHER:
 *
 *   - the BASE print is exclusive to this bucket (the entire card is
 *     only published on this region's cardlist), OR
 *   - at least one VARIANT is exclusive to this bucket (the base is
 *     a global card but it has an alt art only published here, e.g.
 *     a Japan-only Premium Card Collection reprint).
 *
 * The looser-than-strict semantics matter: the bundle only has 4
 * strictly-base-exclusive cards across every region, but ~240 cards
 * carry at least one region-exclusive alt art. The user's mental
 * model of "language-exclusive content" includes both.
 *
 * Backstops on the legacy `regions` array for pre-Phase-7 bundles.
 */
export function hasExclusiveTo(card: Card, bucketKey: LanguagePickerValue): boolean {
  const bucket = LANGUAGE_GROUPS[bucketKey]
  const inBucket = (set?: string[] | CardLanguage[]) =>
    Array.isArray(set) && set.length > 0 && (set as string[]).every((s) => bucket.includes(s as CardLanguage))
  if (inBucket(card.exclusiveTo)) return true
  if (bucketKey === 'JP' && isJpOnly(card.regions as string[])) return true
  if (card.variants?.some((v) => inBucket(v.exclusiveTo)) ?? false) return true
  if (bucketKey === 'JP' && (card.variants?.some((v) => isJpOnly(v.regions as string[])) ?? false)) return true
  return false
}

/**
 * Which single bucket is this card exclusive to, if any?
 *
 * Returns `null` when the card has exclusive content in more than one
 * bucket (rare -- e.g. one EN-only alt + one JP-only alt) or in zero
 * buckets. The dedicated EXCLUSIVES picker mode that consumed this
 * was removed; kept exported because card-data scripts and downstream
 * analytics still want a quick "is this card region-locked?" probe.
 */
export function exclusiveBucketOf(card: Card): LanguagePickerValue | null {
  let hit: LanguagePickerValue | null = null
  for (const bucketKey of LANGUAGE_BUCKETS) {
    if (hasExclusiveTo(card, bucketKey)) {
      if (hit) return null
      hit = bucketKey
    }
  }
  return hit
}

/**
 * Apply the user's language picker selection to the raw card list.
 *
 * Behaviour matrix (the picker is a single-select, two-option group):
 *
 *   - language === 'EN' | 'JP':
 *       Filter the wall to cards that ship in at least one region in
 *       that bucket. Each surviving card has its `imageSmall` /
 *       `imageLarge` swapped to the matching localized scan (falling
 *       back to the canonical render when the localized image is
 *       missing). Each variant carousel is filtered to prints that
 *       also ship in the selected bucket, and same-art duplicates are
 *       collapsed (see `dedupeVariants`).
 *
 * Always runs BEFORE filterCards so the alt-art toggle / search /
 * facet pickers all see the same post-language view.
 */
export function applyLanguageFilter(
  cards: Card[],
  language: LanguagePickerValue,
): Card[] {
  // Defensive fallback: any value not in LANGUAGE_GROUPS (e.g. a
  // stale 'CN' persisted in localStorage from a previous deploy that
  // missed its migration window, or a stale value still cached in
  // memory during HMR) lands on the default EN bucket instead of
  // crashing the page. The Zustand v13 migration rewrites 'CN' to
  // 'EN' on rehydrate, but this guard means we never depend on the
  // migration having run already.
  const bucket = LANGUAGE_GROUPS[language] ?? LANGUAGE_GROUPS.EN

  // Bundles without any per-language metadata (Pokémon, Digimon, DBS,
  // Gundam — single-region pipelines) are language-agnostic. The
  // picker only acts on One Piece (the multi-language bundle); for
  // every other collection we pass the list through unchanged so the
  // wall isn't empty just because the cards have no `languages` key.
  const anyTagged = cards.some(
    (c) => Array.isArray(c.languages) || c.variants?.some((v) => Array.isArray(v.languages)),
  )
  if (!anyTagged) return cards

  const out: Card[] = []
  for (const c of cards) {
    // Skip the card entirely if NEITHER the base print nor any variant
    // is published in the chosen bucket. (A purely-Limitless card with
    // no Bandai-region tag will fall through here.)
    const baseInRegion = isInBucket(c.languages, bucket) || isInBucket(c.variants?.flatMap((v) => v.languages ?? []), bucket)
    if (!baseInRegion) continue

    // Swap base image to the matching localized scan (first available
    // language in the picker's bucket). Falls back to the existing
    // imageSmall when no per-language map is present (older bundles).
    const baseImg =
      pickLocalizedImage(c.imagesByLanguage, bucket, c.regionalIds) ?? c.imageSmall

    // Trim variants to those that ship in the chosen bucket, swap their
    // imageUrl, and forget regional images that don't apply.
    const localizedVariants = c.variants
      ?.filter((v) => isInBucket(v.languages, bucket))
      .map((v) => ({
        ...v,
        imageUrl:
          pickLocalizedImage(v.imagesByLanguage, bucket, v.regionalIds) ?? v.imageUrl,
      }))

    // Collapse near-duplicate prints inside this card. Same Bandai
    // print is sometimes catalogued under multiple internal IDs
    // (region-local `_pN` collisions, SC mislabeling, etc.); if two
    // surviving variants end up pointing at the same underlying image
    // for THIS language, we keep one and merge the other's
    // distinguishing metadata into it.
    const variants = dedupeVariants(baseImg, localizedVariants)

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
 * Within a single card's variant carousel, collapse prints that would
 * render the same image in the active language.
 *
 * Two prints are considered the same render if any of:
 *
 *   - their resolved `imageUrl`s are byte-equal (e.g. our dedupe
 *     already merged them but emitted two variant entries), OR
 *   - their image URL **filenames** match after stripping the host
 *     and any CDN-side timestamp prefix (e.g. SC URL
 *     `…1669722042406OP01-057.png` and TC URL
 *     `…/OP01-057.png` both reduce to `OP01-057.png`, even though
 *     the full URLs differ).
 *
 * We ALSO drop variants whose image collapses to the base card's
 * image — there's no value in offering "base" and "p1" as separate
 * fan slots when they render the same art.
 *
 * Metadata of dropped duplicates is folded into the kept variant: the
 * survivor's `distribution` becomes the union ("Promo · Premium Card
 * Collection") and `stamp` is set if either had one. That way the
 * lightbox can label near-dupes correctly when an extra print only
 * differed by a Winner stamp / holo treatment / regional packaging.
 */
function dedupeVariants(
  baseImg: string,
  variants: CardVariant[] | undefined,
): CardVariant[] | undefined {
  if (!variants || variants.length === 0) return variants
  const baseKey = filenameKey(baseImg)
  const seen = new Map<string, CardVariant>()
  for (const v of variants) {
    const key = filenameKey(v.imageUrl)
    if (!key) {
      // Defensive: if the URL didn't parse to a basename, keep the
      // variant as-is rather than collapse-all-mystery-prints.
      seen.set(v.id, v)
      continue
    }
    // Variant that would render identically to the base card art is
    // pure noise in the fan; skip it entirely. (E.g. an SC-served
    // "base" file that's actually the alt art our base already shows.)
    if (key === baseKey) continue
    const existing = seen.get(key)
    if (!existing) {
      seen.set(key, v)
      continue
    }
    // Merge distinguishing metadata onto the print we already kept.
    const mergedDistribution = mergeDistribution(existing.distribution, v.distribution)
    seen.set(key, {
      ...existing,
      distribution: mergedDistribution,
      stamp: existing.stamp ?? v.stamp ?? null,
    })
  }
  return Array.from(seen.values())
}

/**
 * Reduce an image URL to a comparable key — the bare filename without
 * any host prefix or CDN-side timestamp. Returns `null` for URLs we
 * can't parse (kept as a signal so callers can decide whether to drop
 * or keep the entry).
 */
function filenameKey(url: string | null | undefined): string | null {
  if (!url) return null
  const last = url.split('/').pop()
  if (!last) return null
  const fn = last.split('?')[0]
  // SC server prefixes filenames with a 10-13 digit upload timestamp
  // (e.g. `1669722042406OP01-057.png`). Strip it so the key matches
  // the same logical print served from TC / EN.
  return fn.replace(/^\d{10,}/, '')
}

/**
 * Combine two `distribution` strings into a single comma-separated
 * label, deduplicating identical fragments. Used when collapsing
 * near-duplicate variants so the surviving print remembers every
 * release context the merged-away prints came from.
 */
function mergeDistribution(a?: string, b?: string): string | undefined {
  const parts = new Set<string>()
  for (const x of [a, b]) {
    if (!x) continue
    const trimmed = x.trim()
    if (trimmed) parts.add(trimmed)
  }
  if (parts.size === 0) return undefined
  return Array.from(parts).join(' · ')
}

function isInBucket(langs: string[] | CardLanguage[] | undefined, bucket: CardLanguage[]): boolean {
  if (!Array.isArray(langs)) return false
  return (langs as string[]).some((l) => bucket.includes(l as CardLanguage))
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

const BANDAI_EN_CARD = 'https://en.onepiece-cardgame.com/images/cardlist/card'
const BANDAI_ASIA_EN_CARD = 'https://asia-en.onepiece-cardgame.com/images/cardlist/card'

/**
 * Ordered image URL candidates for the active language bucket.
 *
 * Bandai's EN CDN often hosts promos under `_rN` basenames while our
 * bundle's `regionalIds.EN` and R2 mirror use `_pN`; R2 also 404s for
 * ~70 variant prints. A second class of recent promos (P-136 → P-149
 * "Live Action Edition" set) lives ONLY on the asia-en CDN — neither
 * R2 nor en.onepiece-cardgame.com has them — and the bundle for these
 * has no `en_asia` key, so we synthesise the asia-en URL from
 * `regionalIds.EN` as a tail fallback.
 *
 * The wall tries each candidate in order (see CardTile onError) until
 * one loads.
 */
export function resolveImageCandidates(
  imagesByLanguage: Partial<Record<string, string>> | undefined,
  bucket: CardLanguage[],
  regionalIds?: Partial<Record<CardLanguage, string>>,
  fallback?: string,
): string[] {
  const out: string[] = []
  const add = (u?: string | null) => {
    if (u && !out.includes(u)) out.push(u)
  }

  for (const lang of bucket) {
    const key = lang.toLowerCase()
    if (key === 'en') {
      const rid = regionalIds?.EN
      const rSwap = rid?.replace(/_p(\d+)$/, '_r$1')
      if (rid) {
        add(`${BANDAI_EN_CARD}/${rid}.png`)
        if (rSwap && rSwap !== rid) add(`${BANDAI_EN_CARD}/${rSwap}.png`)
      }
      const enAsia = imagesByLanguage?.en_asia
      if (enAsia) {
        add(enAsia.replace(/^https:\/\/asia-en\.onepiece-cardgame\.com/, BANDAI_EN_CARD))
        add(enAsia)
      }
      add(imagesByLanguage?.en)
      // Tail fallback: try the asia-en CDN directly with the
      // regional id (covers P-136 → P-149 and similar asia-en-only
      // promos that ship without an `en_asia` key in the bundle).
      if (rid) {
        add(`${BANDAI_ASIA_EN_CARD}/${rid}.png`)
        if (rSwap && rSwap !== rid) add(`${BANDAI_ASIA_EN_CARD}/${rSwap}.png`)
      }
    } else {
      add(imagesByLanguage?.[key])
    }
  }

  add(fallback)
  return out
}

function pickLocalizedImage(
  imagesByLanguage: Partial<Record<string, string>> | undefined,
  bucket: CardLanguage[],
  regionalIds?: Partial<Record<CardLanguage, string>>,
): string | null {
  return resolveImageCandidates(imagesByLanguage, bucket, regionalIds)[0] ?? null
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

/**
 * One tile on the gallery wall. In the default (stacked) view each
 * card becomes a single `base` entry. With flatten enabled, every
 * variant becomes its own entry alongside (or instead of) the base.
 */
export interface WallEntry {
  /** Stable React key + lightbox wall-navigation id. */
  wallKey: string
  kind: 'base' | 'variant'
  card: Card
  /** Base uses `card.id`; variants use `variant.id`. */
  printId: string
  imageSmall: string
  /** Alternate URLs when the primary CDN 404s (Bandai `_pN`/`_rN` drift). */
  imageFallbacks?: string[]
  /** Short label for badges / aria (e.g. "Base", "p1"). */
  printLabel: string
}

/**
 * Expand filtered cards into the flat list of wall tiles.
 *
 *   stacked + !onlyAltArt  → one base tile per card (variants in lightbox)
 *   stacked + onlyAltArt   → one stacked tile per card that has variants
 *   flatten + !onlyAltArt  → base tile + one tile per variant
 *   flatten + onlyAltArt   → variant tiles only (no base prints)
 */
function wallImageSources(
  card: Card,
  variant: CardVariant | null,
  bucket: CardLanguage[],
): { primary: string; fallbacks: string[] } {
  const ibl = variant?.imagesByLanguage ?? card.imagesByLanguage
  const regionalIds = variant?.regionalIds ?? card.regionalIds
  const fallback = variant?.imageUrl ?? card.imageSmall
  const cands = resolveImageCandidates(ibl, bucket, regionalIds, fallback)
  const primary = variant?.imageUrl ?? card.imageSmall
  const idx = cands.indexOf(primary)
  const rest = idx >= 0 ? cands.filter((_, i) => i !== idx) : cands.slice(1)
  return { primary, fallbacks: rest }
}

export function buildWallEntries(
  cards: Card[],
  opts: { flatten: boolean; onlyAltArt: boolean; language: LanguagePickerValue },
): WallEntry[] {
  const bucket = LANGUAGE_GROUPS[opts.language] ?? LANGUAGE_GROUPS.EN
  const out: WallEntry[] = []
  for (const card of cards) {
    const variants = card.variants ?? []
    if (opts.flatten) {
      if (opts.onlyAltArt && variants.length === 0) continue
      if (!opts.onlyAltArt) {
        const { primary, fallbacks } = wallImageSources(card, null, bucket)
        out.push({
          wallKey: card.id,
          kind: 'base',
          card,
          printId: card.id,
          imageSmall: primary,
          imageFallbacks: fallbacks.length > 0 ? fallbacks : undefined,
          printLabel: 'Base',
        })
      }
      for (const v of variants) {
        const { primary, fallbacks } = wallImageSources(card, v, bucket)
        out.push({
          wallKey: v.id,
          kind: 'variant',
          card,
          printId: v.id,
          imageSmall: primary,
          imageFallbacks: fallbacks.length > 0 ? fallbacks : undefined,
          printLabel: v.label || v.id,
        })
      }
      continue
    }
    if (opts.onlyAltArt && variants.length === 0) continue
    const { primary, fallbacks } = wallImageSources(card, null, bucket)
    out.push({
      wallKey: card.id,
      kind: 'base',
      card,
      printId: card.id,
      imageSmall: primary,
      imageFallbacks: fallbacks.length > 0 ? fallbacks : undefined,
      printLabel: card.name,
    })
  }
  return out
}

/** Filter cards then expand into wall tiles (shared by grid + lightbox). */
export function filterAndBuildWall(
  cards: Card[],
  f: CardFilterState & { flatten: boolean; language: LanguagePickerValue },
): { filtered: Card[]; entries: WallEntry[] } {
  const filtered = filterCards(cards, f)
  const entries = buildWallEntries(filtered, {
    flatten: f.flatten,
    onlyAltArt: f.onlyAltArt,
    language: f.language,
  })
  return { filtered, entries }
}
