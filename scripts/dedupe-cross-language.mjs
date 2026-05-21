/**
 * Cross-language deduplication: merge every per-language raw scrape into a
 * single `data/cards.json` whose entries carry an `imagesByLanguage` map
 * and a `languages[]` tag identifying every region that lists each print.
 *
 * Inputs (any combination, all optional):
 *   data/by-language/en.json
 *   data/by-language/jp.json
 *   data/by-language/asia-en.json
 *   data/by-language/asia-tc.json
 *   data/by-language/asia-tw.json
 *   data/limitless/missing-variants-detailed.json   (Limitless-sourced prints)
 *
 * Legacy fallback: if no by-language files exist yet, the script falls back
 * to reading the existing `data/cards.json` (which is the EN+JP merged file
 * the pre-Phase-7 pipeline produced) and treats every entry whose `regions`
 * tag includes 'EN'/'JP' as belonging to the matching by-language bucket.
 * This lets us migrate without re-scraping while the per-language scrapers
 * are catching up.
 *
 * Output: data/cards.json (atomic write, .bak rotation).
 *   Each row is a single print (e.g. OP05-062 is one row, OP05-062_p1 is a
 *   sibling row). The downstream `generate-card-data.mjs` groups them by
 *   base ID and emits the `Card.variants[]` shape the UI consumes.
 *
 * Schema additions per row:
 *   language          string | undefined   (single source language tag, kept for back-compat)
 *   languages         string[]              (every language that ships this exact print)
 *   exclusiveTo       string[]              (subset of languages this print is exclusive to;
 *                                            same as `languages` when only one region prints it)
 *   regions           ['EN'|'JP', ...]      (legacy 2-region tag; derived from `languages`
 *                                            via LANGUAGE_TO_REGION; preserved so the existing
 *                                            applyRegionFilter UI path keeps working)
 *   imagesByLanguage  { en, jp, ... }       (per-language image URL; the value Bandai serves
 *                                            from that region's CDN)
 *   namesByLanguage   { en, jp, ... }       (per-language localized card name; useful for
 *                                            multi-language search and lightbox subtitles)
 *
 * The EN/JP/Bandai source files retain the "canonical" gameplay metadata
 * (rarity / cost / power / effect / trigger / etc). When a print is missing
 * from EN but present in JP+TC we keep JP's gameplay strings and pull
 * imagesByLanguage from all available sources.
 *
 * Usage:
 *   node scripts/dedupe-cross-language.mjs
 *   node scripts/dedupe-cross-language.mjs --dry-run
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const BY_LANG_DIR = join(DATA_DIR, 'by-language')
const OUT_PATH = join(DATA_DIR, 'cards.json')
const OUT_BAK = join(DATA_DIR, 'cards.json.bak')
const OUT_TMP = join(DATA_DIR, 'cards.json.tmp')
const LEGACY_PATH = OUT_PATH // legacy data/cards.json fallback for the EN+JP rows
const LIMITLESS_PATH = join(DATA_DIR, 'limitless/missing-variants-detailed.json')

const DRY_RUN = process.argv.includes('--dry-run')

// Languages we recognise (CardLanguage enum). Order matters for the
// "primary image" resolution: the first language in this list that ships
// a print becomes the canonical img_full_url / imageSmall. EN before
// EN_ASIA so the long-running EN catalogue wins when both have the print.
const LANGUAGE_PRIORITY = ['EN', 'EN_ASIA', 'JP', 'TC', 'TW']

// Convert a CardLanguage tag to the legacy 2-region tag (EN | JP) so
// existing readers that filter on `regions` keep working. Asia-EN counts
// as EN; TC and TW have no legacy mapping (they were never on the old
// `regions` enum), so they don't contribute anything to the legacy tag.
const LANGUAGE_TO_REGION = {
  EN: 'EN',
  EN_ASIA: 'EN',
  JP: 'JP',
  TC: null,
  TW: null,
}

// Map per-language file id (the `--language=` CLI value, also the
// `data/by-language/<id>.json` filename) to the CardLanguage tag we use
// in the bundle.
const FILE_TO_LANGUAGE = {
  'en': 'EN',
  'jp': 'JP',
  'asia-en': 'EN_ASIA',
  'asia-tc': 'TC',
  'asia-tw': 'TW',
}

// Cross-region ID aliasing. Bandai sometimes ships the same artwork
// under both `_p1` and `_r1` suffixes (the EN side prints as `_p1`, the
// JP side as `_r1`, etc.). Build an alias for each ID so the dedup
// across languages collapses the matching prints into a single row.
function aliasIds(id) {
  const aliases = new Set([id])
  const m = id.match(/^(.+)_([pr])(\d+)$/)
  if (m) {
    const [, base, , n] = m
    aliases.add(`${base}_p${n}`)
    aliases.add(`${base}_r${n}`)
  }
  return aliases
}

function canonicalId(id) {
  // Convert "_rN" → "_pN" so two equivalent prints (EN's _p1, JP's _r1)
  // dedupe to the same key. Prints that are NOT artwork-aliases of each
  // other still get unique keys.
  return id.replace(/_r(\d+)$/, '_p$1')
}

function loadJsonOrEmpty(path) {
  if (!existsSync(path)) return []
  return JSON.parse(readFileSync(path, 'utf8'))
}

function loadLanguageFiles() {
  const all = []
  for (const [file, lang] of Object.entries(FILE_TO_LANGUAGE)) {
    const path = join(BY_LANG_DIR, `${file}.json`)
    if (!existsSync(path)) continue
    const rows = JSON.parse(readFileSync(path, 'utf8'))
    for (const row of rows) {
      all.push({ ...row, language: lang })
    }
    console.log(`  loaded ${rows.length} rows from ${file}.json  (tagged ${lang})`)
  }
  return all
}

/**
 * Legacy fallback: if no per-language files exist yet, derive EN and JP
 * rows from the existing `data/cards.json` (which is the pre-Phase-7
 * EN+JP merge) so we can still rebuild the unified file before the new
 * scrapers have run.
 */
function loadLegacyCards() {
  if (!existsSync(LEGACY_PATH)) return []
  const rows = JSON.parse(readFileSync(LEGACY_PATH, 'utf8'))
  const expanded = []
  for (const row of rows) {
    if (row.source === 'limitless') {
      expanded.push({ ...row, language: 'EN' })
      continue
    }
    const regions = Array.isArray(row.regions) ? row.regions : ['EN']
    for (const r of regions) {
      const lang = r === 'JP' ? 'JP' : 'EN'
      expanded.push({ ...row, language: lang })
    }
  }
  console.log(`  legacy fallback: loaded ${rows.length} rows -> ${expanded.length} per-language rows`)
  return expanded
}

/**
 * Load the Limitless-sourced print details produced by
 * `scripts/scrape-limitless-missing.mjs`. These are off-catalog alt-arts
 * Bandai never published (e.g. Illustration Box Vol.1 Peach Momoko O-Nami
 * OP05-062_p1) plus tournament prize / stamped reprints from Limitless's
 * category buckets.
 *
 * They come pre-shaped with an `imageUrl` pointing at the Limitless CDN
 * and metadata fields (artist, productName, subtitle). We synthesise a
 * row matching the per-language shape so they merge cleanly with the
 * Bandai-sourced rows.
 */
function loadLimitlessRows(byCardLookup) {
  if (!existsSync(LIMITLESS_PATH)) return []
  const detailed = JSON.parse(readFileSync(LIMITLESS_PATH, 'utf8'))
  const rows = []
  for (const [printId, d] of Object.entries(detailed)) {
    const baseId = d.cardId
    const base = byCardLookup.get(baseId)
    if (!base) {
      // Base card not in our Bandai dataset -- skip (this would be a
      // genuinely new card, which the alt-art-focused supplement
      // pipeline isn't designed to add. The standard scraper handles
      // new base cards.)
      continue
    }
    rows.push({
      // Inherit core gameplay metadata from the base card.
      ...base,
      id: printId,
      language: 'EN', // Limitless images are all EN-language scans
      distribution: distributionLine(d) ?? base.distribution,
      img_full_url: d.imageUrl,
      img_path: `cards/${printId}.png`,
      source_pack_id: `limitless:${d.firstSeenIn}`,
      source_pack_prefix: 'LIMITLESS',
      source_pack_label: d.firstSeenIn,
      source: 'limitless',
      stamp: classifyStamp(d),
      limitless_product: d.productName ?? null,
      limitless_artist: d.artist ?? null,
      limitless_subtitle: d.subtitle ?? null,
      limitless_url: `https://onepiece.limitlesstcg.com/cards/${baseId}?v=${d.variant}`,
    })
  }
  console.log(`  loaded ${rows.length} Limitless-sourced prints (alt arts + stamped)`)
  return rows
}

function distributionLine(d) {
  if (!d) return null
  const parts = []
  if (d.subtitle) parts.push(d.subtitle)
  if (d.productName) parts.push(`(${d.productName})`)
  else if (d.category) parts.push(`(${String(d.category).replace(/\s+/g, ' ').trim()})`)
  return parts.length ? parts.join(' ') : null
}

/**
 * Classify a Limitless print into a stamp bucket based on its category
 * and/or subtitle. Bandai doesn't expose stamp metadata, but Limitless
 * groups prints into categories like "prize-cards", "tournament-pack-12",
 * "championship-25-26-event-pack", etc. The classifier returns one of
 * the PrintStamp enum values or null for "regular" alt arts.
 */
function classifyStamp(d) {
  const cat = (d.firstSeenIn || '').toLowerCase()
  const sub = (d.subtitle || '').toLowerCase()
  const prod = (d.productName || '').toLowerCase()
  const blob = `${cat} ${sub} ${prod}`
  if (/winner/.test(blob)) return 'winner'
  if (/champion(ship)?/.test(blob)) return 'champion'
  if (/pre-release|prerelease|pre release/.test(blob)) return 'pre-release'
  if (/prize-cards|prize cards|top \d+|top player/.test(blob)) return 'event'
  if (/tournament|regional|event-pack|treasure[- ]cup/.test(blob)) return 'event'
  if (/dash[- ]pack|illustration[- ]box|family[- ]deck|storage[- ]box/.test(blob)) return 'pack'
  return null
}

function main() {
  console.log(`Loading per-language scrapes from ${BY_LANG_DIR}...`)
  let rows = loadLanguageFiles()

  if (rows.length === 0) {
    console.log(`  no per-language files found; falling back to legacy data/cards.json.`)
    rows = loadLegacyCards()
  }

  if (rows.length === 0) {
    console.error('No source data found. Run scripts/fetch-card-data.mjs --language=<lang> first.')
    process.exit(1)
  }

  // Build a quick lookup of base cards (by base id, picking the EN row
  // when available) so Limitless rows can inherit gameplay metadata.
  const byCardLookup = new Map()
  for (const r of rows) {
    if (!byCardLookup.has(r.id) || r.language === 'EN') byCardLookup.set(r.id, r)
  }
  const limitlessRows = loadLimitlessRows(byCardLookup)
  rows.push(...limitlessRows)

  // Group by canonical print id (collapsing _pN <-> _rN aliases) so each
  // print appears as a single row with merged per-language fields.
  const byPrint = new Map()
  for (const row of rows) {
    const key = canonicalId(row.id)
    if (!byPrint.has(key)) byPrint.set(key, [])
    byPrint.get(key).push(row)
  }

  const merged = []
  for (const [key, group] of byPrint) {
    // Sort by language priority so the "winning" row (which provides
    // canonical gameplay metadata) is the earliest available region.
    const sorted = [...group].sort(
      (a, b) => LANGUAGE_PRIORITY.indexOf(a.language) - LANGUAGE_PRIORITY.indexOf(b.language)
    )

    // Split Bandai rows vs. Limitless rows. Bandai is authoritative for
    // anything it lists; Limitless ONLY contributes when no Bandai
    // region carries the print (catches Bandai-uncatalogued alt arts
    // like the Peach Momoko OP05-062_p1 from JP Illustration Box and
    // any tournament prize prints).
    const bandaiRows = sorted.filter((r) => r.source !== 'limitless')
    const limitlessRows = sorted.filter((r) => r.source === 'limitless')
    const bandaiOnly = bandaiRows.length > 0

    const imagesByLanguage = {}
    const namesByLanguage = {}
    const languages = []

    // Bandai rows go in first. Each contributes its language tag, its
    // image URL, and its localized name.
    for (const r of bandaiRows) {
      const code = r.language.toLowerCase()
      if (r.img_full_url) imagesByLanguage[code] = r.img_full_url
      if (r.name) namesByLanguage[code] = r.name
      if (!languages.includes(r.language)) languages.push(r.language)
    }

    // Limitless rows ONLY contribute when this print isn't on any
    // Bandai region. In that case we synthesise an image entry under
    // the lowercase 'limitless' key (NOT a real CardLanguage) so
    // downstream code can still find a renderable URL, and we leave
    // `languages` empty (the print has no official region tag --
    // exclusivity is captured via the source 'limitless' tag).
    if (!bandaiOnly && limitlessRows.length > 0) {
      const ll = limitlessRows[0]
      if (ll.img_full_url) imagesByLanguage.limitless = ll.img_full_url
      if (ll.name) namesByLanguage.limitless = ll.name
    }

    // Legacy `regions` derived from the language set so the existing
    // applyRegionFilter UI keeps working through the migration. A
    // Limitless-only print gets ['EN'] for back-compat (it shows up in
    // the EN view today).
    const regions = []
    for (const lang of languages) {
      const r = LANGUAGE_TO_REGION[lang]
      if (r && !regions.includes(r)) regions.push(r)
    }
    if (regions.length === 0 && limitlessRows.length > 0) regions.push('EN')

    // Headline metadata source: prefer the highest-priority Bandai row;
    // fall back to Limitless for purely off-catalog prints.
    const headRow = bandaiRows[0] ?? limitlessRows[0]

    // Primary image URL preference: walk LANGUAGE_PRIORITY for a
    // Bandai image first; fall back to the Limitless image only when
    // no Bandai region has it.
    let primaryImg = null
    for (const lang of LANGUAGE_PRIORITY) {
      const url = imagesByLanguage[lang.toLowerCase()]
      if (url) { primaryImg = url; break }
    }
    if (!primaryImg) primaryImg = imagesByLanguage.limitless ?? headRow.img_full_url

    merged.push({
      ...headRow,
      id: key,
      img_full_url: primaryImg,
      img_path: `cards/${key}.png`,
      regions,
      languages,
      // Languages the print is exclusive to: equal to the full
      // `languages` set when it's a single-region print, otherwise
      // empty (the print is shared across regions). Limitless-only
      // prints have an empty `languages` but are flagged via source.
      exclusiveTo: languages.length === 1 ? [...languages] : [],
      imagesByLanguage,
      namesByLanguage,
      source: bandaiOnly ? 'bandai' : (limitlessRows.length > 0 ? 'limitless' : 'bandai'),
      stamp: headRow.stamp ?? null,
      limitless_product: headRow.limitless_product ?? null,
      limitless_artist: headRow.limitless_artist ?? null,
      limitless_subtitle: headRow.limitless_subtitle ?? null,
      limitless_url: headRow.limitless_url ?? null,
    })
  }

  // Stable sort by id for deterministic diffs.
  merged.sort((a, b) => a.id.localeCompare(b.id))

  // Stats for the operator.
  const byLang = {}
  for (const m of merged) {
    for (const l of m.languages ?? []) {
      byLang[l] = (byLang[l] ?? 0) + 1
    }
  }
  const exclusive = {}
  for (const m of merged) {
    if ((m.exclusiveTo ?? []).length === 1) {
      const l = m.exclusiveTo[0]
      exclusive[l] = (exclusive[l] ?? 0) + 1
    }
  }
  console.log(`\nMerged ${merged.length} unique prints.`)
  console.log(`  by language: ${JSON.stringify(byLang)}`)
  console.log(`  exclusives:  ${JSON.stringify(exclusive)}`)
  const stamped = merged.filter((m) => m.stamp).length
  console.log(`  stamped:     ${stamped}`)

  if (DRY_RUN) {
    console.log(`\n--dry-run set; not writing ${OUT_PATH}.`)
    return
  }

  mkdirSync(DATA_DIR, { recursive: true })
  writeFileSync(OUT_TMP, JSON.stringify(merged, null, 2))
  if (existsSync(OUT_PATH)) copyFileSync(OUT_PATH, OUT_BAK)
  renameSync(OUT_TMP, OUT_PATH)
  console.log(`\nWrote ${merged.length} rows to ${OUT_PATH}.  Backup at ${OUT_BAK}.`)
}

main()
