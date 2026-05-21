/**
 * Cross-language deduplication (Phase 8 rewrite).
 *
 * MOTIVATION
 * ----------
 * Bandai's print suffixes (`_p7`, `_r2`, ...) are REGION-LOCAL, not
 * canonical. Across two regional cardlists the same `_pN` id can mean
 * two completely unrelated prints:
 *
 *     en  OP01-016_p7  ->  "English Version 1st Anniversary Set"
 *     jp  OP01-016_p7  ->  "ONE PIECE CARD THE BEST [PRB-01]"
 *     tc  OP01-016_p7  ->  "ONE PIECE CARD THE BEST [PRB-01]"
 *
 * The Phase 7 deduper merged all three into one row by canonical id,
 * silently fusing unrelated prints and over-tagging `languages`. It
 * also made it impossible to represent region-exclusive promo prints
 * that happen to land on the same `_pN` slot another region already
 * uses for something else (which is why the CN 1st Anniversary Nami
 * wouldn't appear even if we did scrape it).
 *
 * DESIGN
 * ------
 * Instead of grouping by canonical print id, we group by
 *   bucketKey = `${baseId}::${distKey}`
 * where `distKey` is a normalized form of the distribution string. The
 * normalizer extracts bracketed set codes (`[OP01]`, `[PRB-01]`, ...)
 * and matches the small set of cross-lingual product patterns we know
 * about (Premium Card Collection variants, anniversary sets, gift
 * collections, promotion sets), so a single bucket can pool prints
 * from multiple regions if they're the same product.
 *
 * The canonical print id is then assigned PER BUCKET, preferring the
 * highest-priority region's natural `_pN` suffix. When two buckets
 * end up wanting the same canonical id (e.g. EN's anniv-1 wants
 * `OP01-016_p7` and JP's prb01 also wants `OP01-016_p7`), the
 * highest-priority region wins the bare id and the loser gets
 * `OP01-016_p7_jp`-style disambiguation.
 *
 * OUTPUTS
 * -------
 *   data/cards.json                       — merged catalogue
 *   data/print-buckets.suggested.json     — auto-bucket report; rows
 *                                            that didn't cluster with
 *                                            any other region are
 *                                            grouped per-baseId so the
 *                                            operator can spot prints
 *                                            that *should* cross-match
 *                                            but didn't (and add an
 *                                            override to print-buckets.json)
 *
 * OPERATOR OVERRIDES
 * ------------------
 *   data/print-buckets.json (optional, hand-maintained):
 *   {
 *     "OP01-016::premium-25th": [
 *       "EN:OP01-016_p2", "JP:OP01-016_p1",
 *       "TC:OP01-016_p1", "TW:OP01-016_p1"
 *     ]
 *   }
 *
 *   Rows listed here are pinned to that bucket regardless of what the
 *   auto-normalizer decided. Use sparingly — auto-buckets usually
 *   handle the cases that matter.
 *
 * SUPPORTED INPUT FILES (any combination)
 * ---------------------------------------
 *   data/by-language/en.json              — Bandai NA / EU English cardlist
 *   data/by-language/jp.json              — Bandai Japan cardlist
 *   data/by-language/asia-en.json         — Bandai Asia English cardlist
 *   data/by-language/asia-tc.json         — Bandai HK/Macau Traditional Chinese
 *   data/by-language/asia-tw.json         — Bandai Taiwan Traditional Chinese
 *   data/by-language/cn.json              — Bandai Simplified Chinese (.cn) API
 *   data/by-language/<region>-products.json   — Bandai /products/other/*.php promos
 *   data/limitless/missing-variants-detailed.json
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
const LEGACY_PATH = OUT_PATH
const LIMITLESS_PATH = join(DATA_DIR, 'limitless/missing-variants-detailed.json')
const BUCKETS_PATH = join(DATA_DIR, 'print-buckets.json')
const BUCKETS_SUGGESTED_PATH = join(DATA_DIR, 'print-buckets.suggested.json')

const DRY_RUN = process.argv.includes('--dry-run')

// Priority order for resolving canonical metadata and the "winning"
// natural suffix when multiple regions share a bucket. EN first means
// EN print ids stay stable across the migration (downstream R2 paths,
// existing bookmarks, etc.). EN_ASIA before JP because Bandai treats
// Asia-English as a "secondary EN" catalogue with the same alt naming.
const LANGUAGE_PRIORITY = ['EN', 'EN_ASIA', 'JP', 'TC', 'TW', 'SC']

// Short suffix used when two buckets in the same baseId collide on the
// same natural `_pN` slot and we have to disambiguate the loser.
const LANG_COLLISION_SUFFIX = {
  EN: 'en',
  EN_ASIA: 'aen',
  JP: 'jp',
  TC: 'tc',
  TW: 'tw',
  SC: 'sc',
}

// Legacy 2-region tag derivation, kept so `applyRegionFilter` and other
// pre-Phase-7 readers keep working. SC / TC / TW have no legacy mapping
// (they post-date the EN/JP enum).
const LANGUAGE_TO_REGION = {
  EN: 'EN',
  EN_ASIA: 'EN',
  JP: 'JP',
  TC: null,
  TW: null,
  SC: null,
}

// CLI flag value -> CardLanguage tag. The cardlist + products files share
// the same language tag (a print on jp.json and a print on jp-products.json
// are both 'JP').
const FILE_TO_LANGUAGE = {
  'en':            'EN',
  'en-products':   'EN',
  'jp':            'JP',
  'jp-products':   'JP',
  'asia-en':       'EN_ASIA',
  'asia-en-products': 'EN_ASIA',
  'asia-tc':       'TC',
  'asia-tc-products': 'TC',
  'asia-tw':       'TW',
  'asia-tw-products': 'TW',
  'cn':            'SC',
  'cn-products':   'SC',
}

// Convert `_rN` -> `_pN` so regional naming variations (Bandai uses
// `_r` for some alt prints in JP) collapse to the same natural suffix
// for collision detection.
function canonicalSuffix(id) {
  return id.replace(/_r(\d+)$/, '_p$1')
}

// Strip the natural `_pN` (or `_lN` for Limitless) suffix to recover the
// base card id. Used for grouping prints under the same card.
function baseIdOf(id) {
  return canonicalSuffix(id).replace(/_[a-z]\d+$/, '')
}

// Extract the natural suffix, or null for base cards.
function naturalSuffix(id) {
  const m = canonicalSuffix(id).match(/_([a-z]\d+)$/)
  return m ? m[1] : null
}

/**
 * Normalize a distribution string into a cross-region "bucket key".
 *
 * The cardinal rule: two prints belong to the same bucket if and only
 * if they're the same physical product (booster pull, anniversary
 * box insert, magazine appendix, ...) regardless of language.
 *
 * Strategy is layered, returning the first hit:
 *   1. Bracket-extract a Bandai product code: [OP01], [PRB-01], 【ST-10】
 *      → `code-op01`. Most reliable signal (cross-lingual by design).
 *   2. Anniversary-number detection (English + Japanese):
 *      "1st Anniversary" / "1周年" → `anniv-1`. Catches the user's
 *      missing CN Nami: SC label "1週年" should land in the same
 *      bucket as EN "English Version 1st Anniversary Set".
 *   3. Premium Card Collection family — both English and Japanese
 *      use the same family name with a sub-edition discriminator
 *      ("25th Edition" / "25周年エディション", "FILM RED", "GIRLS",
 *      "Drama", "Memorial", "Selection").
 *   4. Magazine appendices (Jump GIGA, V-Jump, ...): bucket by year.
 *   5. Promotion Card Set (one product, multiple regional names):
 *      "Promotion Card Set" / "プロモーションカードセット" /
 *      "推廣卡套組" → `promo-set`.
 *   6. Slug fallback: a generic key from the cleaned ASCII text.
 *      Won't cross language boundaries but at least dedupes within
 *      a single region.
 *
 * Returns null only when distribution is missing entirely; callers
 * fall back to natural-suffix grouping in that case.
 */
function normalizedDistKey(dist) {
  if (!dist) return null
  const raw = dist.normalize('NFKC')
  const s = raw.toLowerCase()

  // 1. Bracket-extracted product code (most reliable cross-region match).
  // Matches "[OP01]", "[OP-01]", "【OP-01】", "[PRB-01]", "[GC-01]", etc.
  const bracket = raw.match(/[\[【]\s*([A-Za-z]+[-]?\d+[A-Za-z0-9-]*)\s*[\]】]/)
  if (bracket) {
    const code = bracket[1].toLowerCase().replace(/[-_\s]/g, '')
    if (/^[a-z]+\d+/.test(code)) return `code-${code}`
  }

  // 2. Premium Card Collection family. Checked BEFORE the standalone
  // anniversary rule so an asia-en label like "PREMIUM CARD COLLECTION
  // 25th ANNIVERSARY EDITION" buckets with EN's "Premium Card
  // Collection -25th Edition-" instead of falling into the anniv-25
  // bucket alongside the unrelated 25th-anniv promo set.
  if (/premium\s*card\s*collection|プレミアムカードコレクション|頂級卡牌典藏|顶级卡牌典藏/i.test(raw)) {
    // Sub-edition discriminator: 25th/25周年, FILM RED, GIRLS, DRAMA,
    // MEMORIAL, SELECTION, BEST. Order matters: more specific first.
    if (/(\d+)\s*(?:th|周年|週年|st\s*anniversary|nd\s*anniversary|rd\s*anniversary|th\s*anniversary)/i.test(raw)) {
      const y = (raw.match(/(\d+)\s*(?:th|周年|週年|st\s*anniversary|nd\s*anniversary|rd\s*anniversary|th\s*anniversary)/i))[1]
      return `premium-${y}`
    }
    if (/film\s*red|film[\s-]?red/i.test(raw)) return 'premium-filmred'
    if (/girls/i.test(raw)) return 'premium-girls'
    if (/drama/i.test(raw)) return 'premium-drama'
    if (/memorial/i.test(raw)) return 'premium-memorial'
    if (/selection/i.test(raw)) return 'premium-selection'
    return 'premium-other'
  }

  // 3. Standalone anniversary set (the card-game's 1st Anniversary
  // Set product line, distinct from the Premium Card Collection's
  // 25th Edition which celebrates the One Piece manga anniversary).
  const annivEn = s.match(/(\d+)\s*(?:st|nd|rd|th)\s*anniversary/)
  const annivCj = raw.match(/(\d+)\s*(?:周年|週年)/)
  // Simplified Chinese 1st-anniversary uses the character "一" rather
  // than a digit (e.g. "一周年纪念套装"). Map a small ladder of
  // Chinese number characters so the SC product harvest buckets with
  // EN's "1st Anniversary Set". Higher numbers (二/三/四 …) are rare
  // but covered for forward compat.
  const cjNumWord = raw.match(/([一二三四五六七八九十]+)\s*(?:周年|週年)/)
  let anniv = annivEn ?? annivCj
  if (!anniv && cjNumWord) {
    const CJ_DIGITS = { '一': '1', '二': '2', '三': '3', '四': '4', '五': '5', '六': '6', '七': '7', '八': '8', '九': '9', '十': '10' }
    const num = CJ_DIGITS[cjNumWord[1]] ?? cjNumWord[1]
    anniv = [null, num]
  }
  if (anniv) return `anniv-${anniv[1]}`

  // 4. Magazine appendices: Jump GIGA, V-Jump, 最強ジャンプ. Year is
  // the discriminator. Doesn't cross language perfectly (TC version
  // of a JP magazine promo doesn't exist), but at least groups JP
  // multi-year reprints of the same magazine slot.
  if (/jump\s*giga|v[\s-]?jump|最強ジャンプ|ジャンプgiga|週刊少年ジャンプ|周刊少年jump/i.test(raw)) {
    const y = raw.match(/(\d{4})/)
    return y ? `magazine-${y[1]}` : 'magazine'
  }
  if (/gift\s*collection|ギフトコレクション/i.test(raw)) {
    const y = raw.match(/(\d{4})/)
    return y ? `gift-${y[1]}` : 'gift'
  }

  // 5. Promotion Card Set across all languages.
  if (/promotion(?:al)?\s*card\s*set|プロモーションカードセット|推[廣广]卡套組/i.test(raw)) {
    return 'promo-set'
  }

  // 6. Slug fallback. Strip non-ASCII so we don't accidentally
  // cross-match unrelated CJK strings via residual punctuation.
  const slug = s.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return slug ? `misc-${slug}` : null
}

function loadJsonOrEmpty(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    console.warn(`  warning: ${path} is unparseable (${err.message}); ignoring`)
    return null
  }
}

function loadLanguageFiles() {
  const all = []
  for (const [file, lang] of Object.entries(FILE_TO_LANGUAGE)) {
    const path = join(BY_LANG_DIR, `${file}.json`)
    if (!existsSync(path)) continue
    const rows = loadJsonOrEmpty(path) ?? []
    for (const row of rows) {
      all.push({ ...row, language: lang, source: row.source ?? 'bandai' })
    }
    console.log(`  loaded ${rows.length} rows from ${file}.json  (tagged ${lang})`)
  }
  return all
}

/**
 * Legacy fallback: if no per-language files exist yet, derive EN and JP
 * rows from the existing `data/cards.json`. Kept so a developer
 * checking out the repo without re-running the scrapes can still
 * rebuild a (degraded) dataset.
 */
function loadLegacyCards() {
  if (!existsSync(LEGACY_PATH)) return []
  const rows = loadJsonOrEmpty(LEGACY_PATH) ?? []
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
 * Load off-catalog prints harvested from Limitless TCG. The shape
 * differs from Bandai rows — these come in as a printId-keyed map and
 * need to be reflowed into per-language row shape. We tag them with a
 * synthetic suffix `_l<N>` (instead of the original `_p<N>`) so they
 * don't collide with Bandai's natural suffix space when a card has
 * both a Bandai _pN and a Limitless _N alt at the same variant number.
 */
function loadLimitlessRows(byCardLookup) {
  if (!existsSync(LIMITLESS_PATH)) return []
  const detailed = loadJsonOrEmpty(LIMITLESS_PATH) ?? {}
  const rows = []
  for (const [printId, d] of Object.entries(detailed)) {
    const baseId = d.cardId
    const base = byCardLookup.get(baseId)
    if (!base) continue
    // Re-key into _l<N> namespace to keep Limitless prints from
    // colliding with Bandai _p<N> ids in any region.
    const variant = Number.isFinite(d.variant) ? d.variant : 1
    const limitlessId = `${baseId}_l${variant}`
    rows.push({
      ...base,
      id: limitlessId,
      language: 'EN',
      distribution: distributionLine(d) ?? base.distribution,
      img_full_url: d.imageUrl,
      img_path: `cards/${limitlessId}.png`,
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

function loadBucketOverrides() {
  if (!existsSync(BUCKETS_PATH)) return new Map()
  const raw = loadJsonOrEmpty(BUCKETS_PATH) ?? {}
  // Map: rowKey ("LANG:printId") -> bucketKey
  const out = new Map()
  for (const [bucketKey, members] of Object.entries(raw)) {
    if (!Array.isArray(members)) continue
    for (const m of members) {
      out.set(m, bucketKey)
    }
  }
  console.log(`  loaded ${out.size} override pins from print-buckets.json (${Object.keys(raw).length} buckets)`)
  return out
}

/**
 * Compute the bucket key for a row. Base cards (no natural suffix) all
 * land in the `<baseId>::base` bucket; alts bucket by normalized
 * distribution string. Manual overrides from print-buckets.json win
 * over auto-bucketing.
 */
function bucketKeyFor(row, overrides) {
  const rowKey = `${row.language}:${canonicalSuffix(row.id)}`
  if (overrides.has(rowKey)) return overrides.get(rowKey)
  const base = baseIdOf(row.id)
  const suffix = naturalSuffix(row.id)
  if (suffix === null) return `${base}::base`
  const distKey = normalizedDistKey(row.distribution)
  if (distKey) return `${base}::${distKey}`
  // No dist + has suffix: fall back to natural-suffix grouping so two
  // regions that publish the same _p3 with no dist info still merge.
  return `${base}::nodist-${suffix}`
}

/**
 * Some buckets unavoidably end up with two prints from the SAME region
 * (e.g. EN has both _p1 and _p3 with identical distribution strings,
 * which Bandai sometimes does for tournament Top 4 + Top 8 prize
 * artworks that ship together). When this happens we split the
 * over-stuffed bucket into per-suffix sub-buckets so we don't merge
 * two unrelated EN prints together.
 */
function splitOverstuffedBuckets(buckets) {
  const out = new Map()
  for (const [bk, rows] of buckets) {
    const perLangCount = new Map()
    for (const r of rows) {
      perLangCount.set(r.language, (perLangCount.get(r.language) ?? 0) + 1)
    }
    const needsSplit = [...perLangCount.values()].some((n) => n > 1)
    if (!needsSplit) {
      out.set(bk, rows)
      continue
    }
    const bySuffix = new Map()
    for (const r of rows) {
      const sfx = naturalSuffix(r.id) ?? 'base'
      const subKey = `${bk}::${sfx}`
      if (!bySuffix.has(subKey)) bySuffix.set(subKey, [])
      bySuffix.get(subKey).push(r)
    }
    for (const [subKey, subRows] of bySuffix) out.set(subKey, subRows)
  }
  return out
}

function sortByPriority(rows) {
  return [...rows].sort(
    (a, b) => LANGUAGE_PRIORITY.indexOf(a.language) - LANGUAGE_PRIORITY.indexOf(b.language)
  )
}

/**
 * Assign canonical ids to every bucket. Algorithm: walk buckets in
 * order of their best-priority member, and for each bucket pick the
 * highest-priority natural suffix among its members as the canonical
 * suffix. If that natural-suffix id is already taken by a previously-
 * assigned bucket for the same baseId, append the winning region's
 * collision suffix to disambiguate (`_p7` -> `_p7_jp`).
 */
function assignCanonicalIds(buckets) {
  // Group buckets per baseId so the collision space is scoped to a
  // single card. Two different cards can both have `_p7` without
  // interfering.
  const perBase = new Map()
  for (const [bk, rows] of buckets) {
    const base = bk.split('::')[0]
    if (!perBase.has(base)) perBase.set(base, [])
    perBase.get(base).push({ bk, rows })
  }

  const canonicalForBucket = new Map()

  for (const [base, items] of perBase) {
    // Stable assignment order: highest-priority-language buckets first,
    // base bucket always first.
    items.sort((a, b) => {
      const aBase = a.bk.endsWith('::base') ? -1 : 0
      const bBase = b.bk.endsWith('::base') ? -1 : 0
      if (aBase !== bBase) return aBase - bBase
      const aBest = LANGUAGE_PRIORITY.indexOf(sortByPriority(a.rows)[0].language)
      const bBest = LANGUAGE_PRIORITY.indexOf(sortByPriority(b.rows)[0].language)
      if (aBest !== bBest) return aBest - bBest
      return a.bk.localeCompare(b.bk)
    })

    const taken = new Set()

    for (const { bk, rows } of items) {
      const isBase = bk.endsWith('::base')
      const isLimitlessOnly = rows.every((r) => r.source === 'limitless')

      let canonicalId
      if (isBase) {
        canonicalId = base
      } else {
        const winner = sortByPriority(rows)[0]
        const sfx = naturalSuffix(winner.id) ?? 'p1'
        let candidate = `${base}_${sfx}`
        if (!taken.has(candidate)) {
          canonicalId = candidate
        } else {
          // Collision: append the winner's language code. For limitless-
          // only buckets, the winner is always EN so the suffix is
          // _l<N> already (set in loadLimitlessRows) — but if it
          // somehow collides too, fall back to a numeric.
          const langCode = LANG_COLLISION_SUFFIX[winner.language] ?? winner.language.toLowerCase()
          candidate = `${base}_${sfx}_${langCode}`
          let i = 2
          while (taken.has(candidate)) {
            candidate = `${base}_${sfx}_${langCode}${i++}`
          }
          canonicalId = candidate
        }
      }
      taken.add(canonicalId)
      canonicalForBucket.set(bk, canonicalId)
      // Mark unused for downstream consumers (Limitless tag mostly).
      void isLimitlessOnly
    }
  }

  return canonicalForBucket
}

function mergeBucketRows(rows) {
  const sorted = sortByPriority(rows)
  const bandaiRows = sorted.filter((r) => r.source !== 'limitless')
  const limitlessRows = sorted.filter((r) => r.source === 'limitless')
  const bandaiOnly = bandaiRows.length > 0

  const imagesByLanguage = {}
  const namesByLanguage = {}
  const regionalIds = {}
  const languages = []

  for (const r of bandaiRows) {
    const code = r.language.toLowerCase()
    if (r.img_full_url) imagesByLanguage[code] = r.img_full_url
    if (r.name) namesByLanguage[code] = r.name
    if (!languages.includes(r.language)) languages.push(r.language)
    // Track the regional id Bandai uses on each language's site. Keyed
    // by the language *enum* (EN, JP, ...) so consumers can show the
    // operator exactly which site's print they're looking at.
    if (!regionalIds[r.language]) regionalIds[r.language] = canonicalSuffix(r.id)
  }

  if (!bandaiOnly && limitlessRows.length > 0) {
    const ll = limitlessRows[0]
    if (ll.img_full_url) imagesByLanguage.limitless = ll.img_full_url
    if (ll.name) namesByLanguage.limitless = ll.name
  }

  const regions = []
  for (const lang of languages) {
    const r = LANGUAGE_TO_REGION[lang]
    if (r && !regions.includes(r)) regions.push(r)
  }
  if (regions.length === 0 && limitlessRows.length > 0) regions.push('EN')

  const headRow = bandaiRows[0] ?? limitlessRows[0]

  let primaryImg = null
  for (const lang of LANGUAGE_PRIORITY) {
    const url = imagesByLanguage[lang.toLowerCase()]
    if (url) { primaryImg = url; break }
  }
  if (!primaryImg) primaryImg = imagesByLanguage.limitless ?? headRow.img_full_url

  return {
    headRow,
    languages,
    regions,
    imagesByLanguage,
    namesByLanguage,
    regionalIds,
    primaryImg,
    bandaiOnly,
    isLimitless: !bandaiOnly && limitlessRows.length > 0,
  }
}

/**
 * Build a suggestions file listing buckets that only contain one region,
 * grouped by baseId. The operator scans this file looking for groups
 * where two single-region buckets *should* have merged (e.g. a JP
 * promo and a TC promo with the same artwork that have unique non-
 * matching distribution strings), and adds them to print-buckets.json.
 */
function writeSuggestions(buckets, canonicalForBucket) {
  const perBase = new Map()
  for (const [bk, rows] of buckets) {
    const base = bk.split('::')[0]
    const langs = new Set(rows.map((r) => r.language))
    if (langs.size > 1) continue
    if (!perBase.has(base)) perBase.set(base, [])
    perBase.get(base).push({
      bucketKey: bk,
      canonicalId: canonicalForBucket.get(bk),
      languages: [...langs],
      members: rows.map((r) => ({
        rowKey: `${r.language}:${canonicalSuffix(r.id)}`,
        distribution: r.distribution ?? null,
      })),
    })
  }
  // Keep only baseIds with two or more single-region buckets — those
  // are the candidates worth a human glance.
  const candidates = {}
  for (const [base, list] of perBase) {
    if (list.length >= 2) candidates[base] = list
  }
  const orderedKeys = Object.keys(candidates).sort()
  const sortedOut = {}
  for (const k of orderedKeys) sortedOut[k] = candidates[k]
  if (!DRY_RUN) {
    writeFileSync(BUCKETS_SUGGESTED_PATH, JSON.stringify(sortedOut, null, 2))
  }
  console.log(`  suggestions: ${orderedKeys.length} base cards with multiple single-region buckets`)
  console.log(`               (review ${BUCKETS_SUGGESTED_PATH} -> pin matches in print-buckets.json)`)
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

  // De-duplicate within each language file by (language, canonical id).
  // The cardlist + products files for the same region may report the
  // same print twice if a promo is also catalogued; we want at most
  // one row per (region, suffix).
  {
    const seen = new Map()
    const winnowed = []
    for (const r of rows) {
      const key = `${r.language}:${canonicalSuffix(r.id)}`
      if (seen.has(key)) {
        // Prefer the row with a non-null distribution (products files
        // sometimes have richer dist than cardlist files for promos).
        const existing = seen.get(key)
        if (!existing.distribution && r.distribution) {
          const idx = winnowed.indexOf(existing)
          winnowed[idx] = r
          seen.set(key, r)
        }
        continue
      }
      seen.set(key, r)
      winnowed.push(r)
    }
    const dropped = rows.length - winnowed.length
    if (dropped > 0) console.log(`  collapsed ${dropped} duplicate same-region rows`)
    rows = winnowed
  }

  // Build base-card lookup for Limitless metadata inheritance.
  const byCardLookup = new Map()
  for (const r of rows) {
    if (!byCardLookup.has(r.id) || r.language === 'EN') byCardLookup.set(r.id, r)
  }
  rows.push(...loadLimitlessRows(byCardLookup))

  const overrides = loadBucketOverrides()

  // Bucket every row by (baseId, distKey).
  const buckets = new Map()
  for (const row of rows) {
    const bk = bucketKeyFor(row, overrides)
    if (!buckets.has(bk)) buckets.set(bk, [])
    buckets.get(bk).push(row)
  }

  // Defensive split: if a bucket somehow contains multiple rows from
  // the same region, partition by natural suffix so we don't merge
  // two unrelated EN prints into one row.
  const finalBuckets = splitOverstuffedBuckets(buckets)
  console.log(`  bucketed ${rows.length} rows into ${finalBuckets.size} canonical prints`)

  const canonicalForBucket = assignCanonicalIds(finalBuckets)

  const merged = []
  for (const [bk, bucketRows] of finalBuckets) {
    const m = mergeBucketRows(bucketRows)
    const canonicalId = canonicalForBucket.get(bk)
    merged.push({
      ...m.headRow,
      id: canonicalId,
      img_full_url: m.primaryImg,
      img_path: `cards/${canonicalId}.png`,
      regions: m.regions,
      languages: m.languages,
      // A print is "exclusive to" the set of languages that ship it
      // when that set has exactly one language. Multi-region prints
      // get an empty array (they're not exclusive to anything).
      exclusiveTo: m.languages.length === 1 ? [...m.languages] : [],
      imagesByLanguage: m.imagesByLanguage,
      namesByLanguage: m.namesByLanguage,
      regionalIds: m.regionalIds,
      source: m.isLimitless ? 'limitless' : 'bandai',
      stamp: m.headRow.stamp ?? null,
      limitless_product: m.headRow.limitless_product ?? null,
      limitless_artist: m.headRow.limitless_artist ?? null,
      limitless_subtitle: m.headRow.limitless_subtitle ?? null,
      limitless_url: m.headRow.limitless_url ?? null,
      // Trace metadata: bucket key used (helpful for debugging the
      // suggestions file and writing overrides).
      bucket_key: bk,
    })
  }

  merged.sort((a, b) => a.id.localeCompare(b.id))

  // Stats.
  const byLang = {}
  for (const m of merged) {
    for (const l of m.languages ?? []) byLang[l] = (byLang[l] ?? 0) + 1
  }
  const exclusive = {}
  for (const m of merged) {
    if ((m.exclusiveTo ?? []).length === 1) {
      const l = m.exclusiveTo[0]
      exclusive[l] = (exclusive[l] ?? 0) + 1
    }
  }
  const stamped = merged.filter((m) => m.stamp).length
  const limitless = merged.filter((m) => m.source === 'limitless').length
  console.log(`\nMerged ${merged.length} unique prints.`)
  console.log(`  by language: ${JSON.stringify(byLang)}`)
  console.log(`  exclusives:  ${JSON.stringify(exclusive)}`)
  console.log(`  stamped:     ${stamped}`)
  console.log(`  limitless:   ${limitless}`)

  writeSuggestions(finalBuckets, canonicalForBucket)

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
