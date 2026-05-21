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

/**
 * High-level language buckets exposed in the UI's language picker.
 *
 * "CN" is a single user-facing bucket that pulls from both Traditional
 * Chinese catalogues (TC + TW). They publish virtually the same content
 * but on different release cadences -- treating them as one bucket means
 * a user picking "CN" sees the union of HK/TW prints. "Simplified
 * Chinese" (mainland) is not on Bandai's official site and is not in
 * scope for this phase.
 */
/**
 * Four mutually-exclusive view modes for the gallery, each picked from
 * the header pill group:
 *
 *   - 'EN'         — show only the EN catalogue (en + asia-en), EN art
 *   - 'JP'         — show only the JP catalogue, JP art
 *   - 'CN'         — show only the CN bucket (tc + tw), CN art
 *   - 'EXCLUSIVES' — pivot to a cross-region "what's only available in
 *                    one place" view: every print that ships in exactly
 *                    one of {EN, JP, CN} buckets, all three pooled
 *                    together. Each card stays on its native region's
 *                    artwork.
 *
 * The legacy 'ALL' value is migrated to 'EN' in the Zustand persistence
 * layer (see store.ts version-10 migration). Rationale: user feedback
 * was that 'All' surfaced visual duplicates across regions (same
 * Luffy art three times in EN/JP/TC); EN is the app's surface language
 * so an English-speaking first-time visitor lands on a wall they can
 * read. JP / CN are one click away.
 */
export type LanguagePickerValue = 'EN' | 'JP' | 'CN' | 'EXCLUSIVES'

/**
 * Map a picker value to the set of source languages it covers. Used by
 * `applyLanguageFilter` to decide which prints to surface and which
 * image URL to render.
 */
/**
 * Region buckets used by the three "single-language" picker values.
 * `EXCLUSIVES` is a pivot mode, not a region, so it has no entry here;
 * the filter walks `LANGUAGE_BUCKETS` itself to figure out which prints
 * are exclusive to each bucket.
 */
export const LANGUAGE_GROUPS: Record<Exclude<LanguagePickerValue, 'EXCLUSIVES'>, CardLanguage[]> = {
  EN: ['EN', 'EN_ASIA'],
  JP: ['JP'],
  CN: ['TC', 'TW'],
}

/** Stable iteration order for the three region buckets. */
export const LANGUAGE_BUCKETS: ReadonlyArray<Exclude<LanguagePickerValue, 'EXCLUSIVES'>> = ['EN', 'JP', 'CN']

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
  variants?: CardVariant[]
}

export type CardSet = {
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder: number
  cardCount?: number
}
