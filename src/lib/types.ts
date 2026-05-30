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
               // - Mainland China Simplified Chinese, added in Phase 8.
               // Tracks the bulk paginated /cardlist/ endpoint plus the
               // Premium-Bandai-style product pages where the SC-exclusive
               // anniversary / serialized prints live.

/**
 * Two mutually-exclusive view modes for the gallery, picked from the
 * header pill group:
 *
 *   - 'EN' - show only the EN catalogue (en + asia-en), EN art
 *   - 'JP' - show only the JP catalogue, JP art
 *
 * Why CN was removed (the deprecation is documented in
 * `samples/jp-cn-compare/README.md` with side-by-side screenshots):
 * Bandai's TC / TW CDNs hot-link the JP file for the vast majority
 * of cards - `curl`-confirmed byte-identical, same SHA-256. The CN
 * picker therefore promised "view Chinese scans" but delivered "view
 * the JP file under a different URL." That's the worst kind of
 * affordance - it implies a difference that doesn't exist, burns
 * render cycles re-decoding identical bytes on every flip, and
 * confuses users (the canonical "JP and CN look the same" bug
 * report). The SC source (`source.windoent.com`) has its own scans
 * for a tiny long tail of Mainland-exclusive prints, but the bulk
 * mirrors JP too, so the cost/benefit didn't justify keeping the
 * picker option.
 *
 * SC-exclusive prints stay in the bundle (e.g. OP01-016 `_p9_sc`,
 * the 1st Anniversary serialized Nami) - they just aren't reachable
 * via a top-level "show me Chinese cards" affordance. Re-enabling
 * CN later is reverting this file + the LANGUAGE_GROUPS table + the
 * header pill list (a one-commit change).
 *
 * Legacy 'CN', 'ALL', and 'EXCLUSIVES' values in persisted Zustand
 * state are migrated to 'EN' on rehydrate (see store.ts).
 */
export type LanguagePickerValue = 'EN' | 'JP'

/**
 * Map a picker value to the ordered list of source languages it covers.
 * `applyLanguageFilter` uses this both to decide which prints to
 * surface AND to pick which localized image URL to render - the
 * iteration order IS the preference order.
 *
 * EN is strict: only `en.onepiece-cardgame.com` (and the R2 mirror
 * populated from it). EN_ASIA was previously included here under the
 * assumption that "asia-en.onepiece-cardgame.com" served English-text
 * scans for Asian-region English speakers. In practice Bandai uses
 * that catalogue to LIST Japanese-region promos (Promotion Pack EX
 * Vol.N, Premium Card Collection, Standard Battle prizes, etc.) for
 * Asian collectors who play the JP format - and the files behind the
 * URLs are the Japanese scans, sometimes byte-identical to the JP
 * CDN (verified for OP07-015_p3.png: r2-mirror SHA-256 ===
 * jp-CDN SHA-256). That meant EN mode was leaking JP-text cards
 * like the OP07-015 Monkey.D.Dragon Promotion Pack EX Vol.3 print
 * (the user's bug report screenshot).
 *
 * Resolution:
 *
 *   - EN bucket: drop EN_ASIA. EN now means "Bandai's main English
 *     site (en.onepiece-cardgame.com) listed this card" with no
 *     exceptions. Cards/variants tagged ONLY as EN_ASIA fall out of
 *     EN mode entirely; this is the desired behaviour per user
 *     feedback ("EN button = EN only, JP button = JP only, never
 *     mixed").
 *
 *   - JP bucket: add EN_ASIA as a fallback after JP. Because
 *     asia-en's actual content is Japanese-text artwork, the right
 *     home for those prints IS the JP picker. Cards that have BOTH
 *     a jp URL and an en_asia URL (e.g. ST-30 base cards) render
 *     the JP URL because it comes first in the order. Cards that
 *     only have the en_asia URL (e.g. OP01-021_p1_aen "Winner
 *     prize for September 2022 Standard Battle") still surface
 *     under JP, rendered from asia-en - which is, again, the JP
 *     scan with a different hostname. dedupeVariants collapses any
 *     near-duplicates via filename key so we don't show the same
 *     artwork twice in the fan.
 *
 * Long-term, the data layer should be re-run with stricter EN_ASIA
 * detection (don't tag a print as EN_ASIA unless the URL actually
 * serves English-text glyphs) - until that happens the runtime
 * bucket mapping below is the source of truth.
 */
export const LANGUAGE_GROUPS: Record<LanguagePickerValue, CardLanguage[]> = {
  EN: ['EN'],
  JP: ['JP', 'EN_ASIA'],
}

/** Stable iteration order for the active region buckets. */
export const LANGUAGE_BUCKETS: ReadonlyArray<LanguagePickerValue> = ['EN', 'JP']

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
  // Rarity of this specific variant print. In most TCGs the variant
  // rarity differs from the base card (e.g. Gundam LR base → LR+
  // Parallel → LR++ Double Parallel). Undefined when the rarity
  // equals the base card's rarity or is unknown.
  rarity?: string
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
