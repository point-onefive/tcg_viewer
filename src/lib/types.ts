// -----------------------------------------------------------------------------
// Region / language model
// -----------------------------------------------------------------------------
//
// Phase 7 expanded the pipeline from EN+JP to every official Bandai region.
// The two type aliases below intentionally overlap: `CardRegion` predates the
// language picker and is still used by older code paths that only care about
// "is this card from Japan?" (`regions: ['JP']`); `CardLanguage` is the
// richer enum that backs the multi-language ingestion and the language
// picker in the header.
//
// Once every reader has migrated to `languages` we'll drop `CardRegion`
// and the per-card `regions` field. Until then, both are populated by
// generate-card-data.mjs so neither old nor new readers break.

/** Legacy 2-region enum (EN + JP). Read by `applyRegionFilter`. */
export type CardRegion = 'EN' | 'JP'

/** Every Bandai-published language we ingest. */
export type CardLanguage =
  | 'EN'       // en.onepiece-cardgame.com           (NA / EU canonical English)
  | 'EN_ASIA'  // asia-en.onepiece-cardgame.com      (Asia-English, separate catalogue)
  | 'JP'       // www.onepiece-cardgame.com          (Japan, primary master catalogue)
  | 'TC'       // asia-tc.onepiece-cardgame.com      (Hong Kong / Macau, Traditional Chinese)
  | 'TW'       // asia-tw.onepiece-cardgame.com      (Taiwan, Traditional Chinese)
  | 'SC'       // onepiece-cardgame.cn (via onepieceserve.windoent.com JSON API)
               // — Mainland China Simplified Chinese, added in Phase 8.
               // Tracks the bulk paginated /cardlist/ endpoint plus the
               // Premium-Bandai-style product pages where the SC-exclusive
               // anniversary / serialized prints live.

/**
 * Three mutually-exclusive view modes for the gallery, picked from the
 * header pill group:
 *
 *   - 'EN' — show only the EN catalogue (en + asia-en), EN art
 *   - 'JP' — show only the JP catalogue, JP art
 *   - 'CN' — show only the CN bucket (TC + TW + SC), CN art
 *
 * Why no "ALL" or "EXCLUSIVES" mode anymore: user feedback was that
 * any mode that mixed buckets surfaced visual duplicates (the same
 * Luffy art three times in EN/JP/TC), and "EXCLUSIVES" was confusing
 * because most cards have one exclusive variant but otherwise ship
 * globally — so EXCLUSIVES still surfaced familiar-looking cards.
 * The simpler "one language per click" mental model wins by a
 * landslide on signal-to-noise. Users who want to find a region-
 * exclusive can drill in via the variant fan once they pick a
 * language. Legacy 'ALL' and 'EXCLUSIVES' values are migrated to
 * 'EN' in the Zustand persistence layer (see store.ts).
 */
export type LanguagePickerValue = 'EN' | 'JP' | 'CN'

/**
 * Map a picker value to the ordered list of source languages it covers.
 * `applyLanguageFilter` uses this both to decide which prints to
 * surface AND to pick which localized image URL to render — the
 * iteration order IS the preference order.
 *
 * The CN order — `TC > TW > SC` — is deliberate. SC (Mainland China,
 * `source.windoent.com`) is the official Bandai feed but has known
 * filename mislabeling: e.g. the "base" image for OP01-006 is served
 * at `…1726626190407OP01-006_05.png` (the `_05` suffix suggests an
 * alt art) and the "base" image for OP01-057 collides with what TC
 * serves as the alt-art-1. If we resolved SC first, those mislabels
 * would surface as visible duplicates ("two of the same Paradise
 * Waterfall in CN mode") in the wall + lightbox. TC (`asia-tc`) has
 * reliable URL labeling — `OP01-057.png` is the base, `_p1.png` is
 * the first alt, etc. — so we resolve TC first and only fall back to
 * SC for SC-exclusive prints (1st Anniversary box cards, mainland-only
 * promos) where TC simply doesn't have an entry.
 */
export const LANGUAGE_GROUPS: Record<LanguagePickerValue, CardLanguage[]> = {
  EN: ['EN', 'EN_ASIA'],
  JP: ['JP'],
  CN: ['TC', 'TW', 'SC'],
}

/** Stable iteration order for the three region buckets. */
export const LANGUAGE_BUCKETS: ReadonlyArray<LanguagePickerValue> = ['EN', 'JP', 'CN']

/**
 * Where each variant's image was ultimately scraped from. `bandai` is
 * the official cardlist (any language). `limitless` is the community
 * Limitless TCG supplement, used to backfill off-catalog prints (alt
 * arts and stamped tournament prizes Bandai doesn't catalogue).
 */
export type CardSource = 'bandai' | 'limitless'

/**
 * Stamp / overlay applied to a print. Distinct from artwork variant:
 * a single artwork can ship in a "clean" base print, a Winner-stamped
 * tournament prize print, a Champion-stamped Top-Player Pack print,
 * etc., each with its own image. Set by the Limitless category
 * classifier; absent for plain Bandai prints.
 */
export type PrintStamp = 'winner' | 'event' | 'champion' | 'pre-release' | 'pack'

export type CardVariant = {
  id: string
  label: string        // e.g. "p1", "p2", "r1"
  imageUrl: string     // PRIMARY language image (resolution order EN → JP → first available)
  // Per-language image URLs for this print. A `_p1` print might appear
  // on EN, JP, and TC with three distinct image files; this map lets
  // the language picker swap the rendered URL without rebuilding the
  // card object. Always populated by generate-card-data.mjs starting
  // in Phase 7; older bundles may omit it (callers should fall back
  // to `imageUrl`).
  imagesByLanguage?: Partial<Record<CardLanguage, string>>
  // Which Bandai-region catalogues ship this exact print. Union of
  // EN / EN_ASIA / JP / TC / TW. Limitless-only prints set this to
  // the languages whose CDN image we successfully harvested (usually
  // ['EN']).
  languages?: CardLanguage[]
  // Subset of `languages` indicating the print exists in ONLY those
  // languages -- the data behind the "EN-only / JP-only / CN-only"
  // exclusives narrowing filter. Equal to `languages` for true
  // single-region prints; empty / undefined for prints shared across
  // every region in the picker's bucket.
  exclusiveTo?: CardLanguage[]
  // Raw "Card Set(s)" string from Bandai's getInfo div, e.g.
  // "Premium Card Collection -FILM RED Edition-", "2025 NEW YEAR EVENT",
  // "Tournament Pack Vol.3", "Super Pre-Release". Use for human-readable
  // labels and substring-based filtering. Undefined for cards Bandai ships
  // with no distribution metadata (rare).
  distribution?: string
  // LEGACY (pre-Phase 7). Equivalent to `languages` but with the older
  // 2-region enum (EN / JP). Still emitted by the generator so the
  // existing `applyRegionFilter` path keeps working until every
  // consumer is migrated to `languages` / `applyLanguageFilter`.
  regions?: CardRegion[]
  // Where the print was harvested from. Defaults to 'bandai' when omitted.
  source?: CardSource
  // Stamped tournament / event / prize overlay, if any.
  stamp?: PrintStamp | null
  // Limitless provenance fields (populated only when source === 'limitless').
  limitless_product?: string | null
  limitless_artist?: string | null
  limitless_subtitle?: string | null
  limitless_url?: string | null
  // Per-language Bandai print id. The canonical `id` is the single
  // identifier downstream code uses, but each region's cardlist often
  // catalogues the same print under a DIFFERENT `_pN` slot (e.g. the
  // OP01 booster alt is `_p1` on EN, `_p2` on JP). The deduper records
  // every region's actual id here so the lightbox / debug panel can
  // show the user "this print = EN OP01-016_p1 = JP OP01-016_p2 = ...".
  // Added in Phase 8 when we stopped collapsing collisions silently.
  regionalIds?: Partial<Record<CardLanguage, string>>
}

export type Card = {
  id: string           // base card ID e.g. "OP01-006"
  code: string
  name: string         // EN canonical name (or first available if no EN)
  // Localized display name per language. The card grid + lightbox keep
  // showing `name` (EN canonical) for stable UI labels; the search
  // index in card-filter.ts also walks this map so a query in JP/TC
  // matches the corresponding card.
  namesByLanguage?: Partial<Record<CardLanguage, string>>
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder?: number
  cardType?: string    // Character | Leader | Event | Stage
  rarity?: string      // C | UC | R | SR | SEC | L | P | TR
  colors?: string[]
  cost?: number | null
  power?: number | null
  counter?: number | null
  attributes?: string[]
  types?: string[]
  effect?: string | null
  trigger?: string | null
  // Where the base card came from -- same shape as CardVariant.distribution.
  // For starter-set cards this typically echoes the set name, e.g.
  // "-Straw Hat Crew-[ST-01]".
  distribution?: string
  // LEGACY: 2-region tag. See note on CardVariant.regions.
  regions?: CardRegion[]
  // Every language that lists this base card on its cardlist. Union of
  // EN_ASIA / EN / JP / TC / TW. JP-only base cards (e.g. ST-30) have
  // `['JP']`; common cards have most or all entries.
  languages?: CardLanguage[]
  // Languages this base card is exclusive to (i.e. it does NOT appear
  // on any other region's cardlist). Powers the "language exclusives"
  // narrowing filter.
  exclusiveTo?: CardLanguage[]
  imageSmall: string
  imageLarge?: string
  // Per-language image URLs for the base (non-variant) card. Same
  // shape as CardVariant.imagesByLanguage.
  imagesByLanguage?: Partial<Record<CardLanguage, string>>
  // Per-language Bandai print id. Same semantics as CardVariant.regionalIds
  // but for the base print. See CardVariant for the full rationale.
  regionalIds?: Partial<Record<CardLanguage, string>>
  variants?: CardVariant[]
}

export type CardSet = {
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder: number
  cardCount?: number
}
