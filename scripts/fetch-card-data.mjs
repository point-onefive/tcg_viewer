/**
 * Fetches One Piece TCG card data directly from Bandai's official cardlist
 * for one (or all) language regions.
 *
 * Supported regions (`--language=` flag):
 *   en        - en.onepiece-cardgame.com           (NA / EU English; default for back-compat)
 *   jp        - www.onepiece-cardgame.com          (Japan, the master catalogue)
 *   asia-en   - asia-en.onepiece-cardgame.com      (Asia English)
 *   asia-tc   - asia-tc.onepiece-cardgame.com      (Hong Kong / Macau, Traditional Chinese)
 *   asia-tw   - asia-tw.onepiece-cardgame.com      (Taiwan, Traditional Chinese)
 *   all       - sweep every region above, one after the other
 *   legacy    - special compat mode that reproduces the pre-Phase-7 behaviour:
 *               EN + JP merged into a single `data/cards.json` with a `regions`
 *               tag per card. Kept so the existing generator + UI keep working
 *               while the new multi-language pipeline lands.
 *
 * Per-language outputs live in `data/by-language/<lang>.json` and mirror the
 * raw vegapull schema (id, name, rarity, category, colors, cost, power,
 * counter, attributes, types, effect, trigger, distribution, img_full_url,
 * source_pack_id / prefix / label). The downstream cross-language deduper
 * (`scripts/dedupe-cross-language.mjs`) unifies them into a single
 * `data/cards.json` with `imagesByLanguage` and `languages` on every print.
 *
 * Examples:
 *   node scripts/fetch-card-data.mjs                 # legacy mode (EN + JP merged)
 *   node scripts/fetch-card-data.mjs --language=tc   # write data/by-language/tc.json
 *   node scripts/fetch-card-data.mjs --language=all  # sweep every region
 *   node scripts/fetch-card-data.mjs --language=jp --dry-run
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const BY_LANG_DIR = join(DATA_DIR, 'by-language')
const CARDS_PATH = join(DATA_DIR, 'cards.json')
const CARDS_TMP_PATH = join(DATA_DIR, 'cards.json.tmp')
const CARDS_BAK_PATH = join(DATA_DIR, 'cards.json.bak')
const PACKS_PATH = join(DATA_DIR, 'packs.json')

// Refuse to overwrite the existing cards.json if the new pull contains less
// than this fraction of the previous card count. Catches the common silent-
// failure modes: Bandai briefly returning empty pages, a regex change breaking
// the parser, or a network blip dropping half the series mid-run.
const MIN_RETENTION_RATIO = 0.8

const ALLOW_PARTIAL = process.argv.includes('--allow-partial')
const DRY_RUN = process.argv.includes('--dry-run')

const argLanguage = process.argv.find((a) => a.startsWith('--language='))?.split('=')[1] ?? 'legacy'

/**
 * Catalogue of every region we know how to scrape. Each entry maps a short
 * CLI flag value to:
 *
 *   id         - the language tag used in `data/by-language/<id>.json` and
 *                in the eventual `imagesByLanguage` map (lowercase short code).
 *   bundle     - the CardLanguage enum value the deduper / generator should
 *                tag every harvested print with.
 *   site       - the origin (https://...) used both to fetch the cardlist HTML
 *                and to resolve relative image paths.
 *   listUrl    - convenience: <site>/cardlist/, the form POST target.
 *   label      - short display label used in console output.
 *
 * `legacy` is omitted -- it's not a real region, just the back-compat
 * EN + JP merge mode.
 */
const REGIONS = {
  en:        { id: 'en',      bundle: 'EN',      site: 'https://en.onepiece-cardgame.com',      label: 'EN'      },
  jp:        { id: 'jp',      bundle: 'JP',      site: 'https://www.onepiece-cardgame.com',     label: 'JP'      },
  'asia-en': { id: 'asia-en', bundle: 'EN_ASIA', site: 'https://asia-en.onepiece-cardgame.com', label: 'ASIA-EN' },
  'asia-tc': { id: 'asia-tc', bundle: 'TC',      site: 'https://asia-tc.onepiece-cardgame.com', label: 'TC'      },
  'asia-tw': { id: 'asia-tw', bundle: 'TW',      site: 'https://asia-tw.onepiece-cardgame.com', label: 'TW'      },
}

const ALL_REGION_KEYS = Object.keys(REGIONS)

if (argLanguage !== 'legacy' && argLanguage !== 'all' && !REGIONS[argLanguage]) {
  console.error(
    `Unknown --language=${argLanguage}. Allowed: ${[...ALL_REGION_KEYS, 'all', 'legacy'].join(', ')}`
  )
  process.exit(1)
}

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// --en-only is a legacy-mode flag retained from before --language existed.
// It only matters when `--language=legacy` is in effect (the back-compat
// EN + JP merge); for the new per-language mode the flag is meaningless
// since each invocation already targets one region.
const EN_ONLY = process.argv.includes('--en-only')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHTML(url, query = null) {
  // Series-filter requests originally went out as form-encoded POSTs to
  // `/cardlist/`. That works for EN, JP, asia-en, and asia-tc, but
  // asia-tw silently ignores the POST body and returns the OP-15 default
  // every time -- producing a giant pile of duplicated rows. GET with
  // a query string works on every region, so we standardise on it.
  const fullUrl = query ? `${url}?${query}` : url
  const init = {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }
  const res = await fetch(fullUrl, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${fullUrl}`)
  return res.text()
}

// Resolve a relative image path from a Bandai cardlist HTML response. The
// HTML uses `../images/cardlist/card/<ID>.png?<cache-bust>` which is
// relative to `<host>/cardlist/`; we strip the leading `..` and prefix
// the region's site origin.
function resolveBandaiImageUrl(rawPath, hostOrigin) {
  if (!rawPath) return null
  let path = rawPath
  if (path.startsWith('../')) path = path.replace(/^\.\.\//, '/')
  return `${hostOrigin}${path.split('?')[0]}`
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&#0*8217;/g, '\u2019')
    .replace(/&lsquo;|&#0*8216;/g, '\u2018')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

/** Parse the cardlist landing page to extract all series options (the dropdown). */
function parseSeriesOptions(html) {
  const options = []
  const re = /<option\s+value="(\d+)"[^>]*>([^<]+)/g
  let m
  while ((m = re.exec(html)) !== null) {
    const id = m[1]
    const rawTitle = decodeHtml(m[2])
      .replace(/<br[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    const labelMatch = rawTitle.match(/\[([^\]]+)\]\s*$/)
    const label = labelMatch ? labelMatch[1] : null
    let prefix = null
    let title = rawTitle
    const dashSplit = rawTitle.match(/^([A-Z][A-Z\s]+?)\s+-(.+?)-\s*(?:\[|$)/)
    if (dashSplit) {
      prefix = dashSplit[1].trim()
      title = dashSplit[2].trim()
    } else if (labelMatch) {
      title = rawTitle.replace(/\[[^\]]+\]\s*$/, '').trim()
    }
    options.push({ id, raw_title: rawTitle, title_parts: { prefix, title, label } })
  }
  return options
}

function htmlToText(html) {
  return decodeHtml(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/\u00a0/g, ' ')
  ).trim()
}

function extractField(block, className) {
  const re = new RegExp(`<div\\s+class="${className}"[^>]*>([\\s\\S]*?)<\\/div>`, 'i')
  const m = block.match(re)
  if (!m) return null
  const stripped = m[1].replace(/<h3[^>]*>[\s\S]*?<\/h3>/i, '').trim()
  return stripped
}

function parseColors(text) {
  if (!text) return []
  return htmlToText(text).split('/').map((s) => s.trim()).filter(Boolean)
}

function parseTypes(text) {
  if (!text) return []
  return htmlToText(text).split('/').map((s) => s.trim()).filter(Boolean)
}

function parseAttributes(text) {
  if (!text) return []
  const out = []
  const re = /<i[^>]*>([^<]+)<\/i>/g
  let m
  while ((m = re.exec(text)) !== null) {
    out.push(decodeHtml(m[1]).trim())
  }
  if (out.length === 0) {
    const altRe = /<img[^>]*alt="([^"]+)"/g
    while ((m = altRe.exec(text)) !== null) {
      const v = decodeHtml(m[1]).trim()
      if (v && v !== 'Attribute') out.push(v)
    }
  }
  return out
}

function parseNumber(text) {
  if (text == null) return null
  const cleaned = htmlToText(text).trim()
  if (!cleaned || cleaned === '-' || cleaned === '\u2212') return null
  const n = parseInt(cleaned.replace(/[^\d-]/g, ''), 10)
  return isNaN(n) ? null : n
}

function parseCardBlock(block, pack, hostOrigin) {
  const idMatch = block.match(/<dl\s+class="modalCol"\s+id="([^"]+)"/)
  if (!idMatch) return null
  const id = idMatch[1]

  const infoMatch = block.match(/<div\s+class="infoCol"[^>]*>([\s\S]*?)<\/div>/)
  let rarity = null
  let category = null
  if (infoMatch) {
    const spans = [...infoMatch[1].matchAll(/<span>([^<]*)<\/span>/g)].map((m) => decodeHtml(m[1]).trim())
    rarity = spans[1] ?? null
    category = spans[2] ?? null
  }

  const nameMatch = block.match(/<div\s+class="cardName"[^>]*>([\s\S]*?)<\/div>/)
  const name = nameMatch ? htmlToText(nameMatch[1]) : id

  const imgMatch = block.match(/<img[^>]*data-src="([^"]+)"/)
  const imgFullUrl = resolveBandaiImageUrl(imgMatch ? imgMatch[1] : null, hostOrigin)

  const cost = parseNumber(extractField(block, 'cost'))
  const attributes = parseAttributes(extractField(block, 'attribute') ?? '')
  const power = parseNumber(extractField(block, 'power'))
  const counter = parseNumber(extractField(block, 'counter'))
  const colors = parseColors(extractField(block, 'color') ?? '')
  const types = parseTypes(extractField(block, 'feature') ?? '')

  const effectRaw = extractField(block, 'text')
  const effect = effectRaw ? htmlToText(effectRaw).replace(/\n/g, '<br>') : null

  const triggerRaw = extractField(block, 'trigger')
  const trigger = triggerRaw ? htmlToText(triggerRaw).replace(/\n/g, '<br>') : null

  const getInfoRaw = extractField(block, 'getInfo')
  const distribution = getInfoRaw
    ? htmlToText(getInfoRaw).replace(/\s+/g, ' ').trim()
    : null

  return {
    id,
    name,
    rarity,
    category,
    colors,
    cost,
    power,
    counter,
    attributes,
    types,
    effect,
    trigger,
    distribution,
    img_full_url: imgFullUrl,
    img_path: `cards/${id}.png`,
    source_pack_id: pack.id,
    source_pack_prefix: pack.title_parts?.prefix ?? null,
    source_pack_label: pack.title_parts?.label ?? null,
  }
}

function parseAllCards(html, pack, hostOrigin) {
  const cards = []
  const re = /<dl\s+class="modalCol"[\s\S]*?<\/dl>/g
  let m
  while ((m = re.exec(html)) !== null) {
    const card = parseCardBlock(m[0], pack, hostOrigin)
    if (card) cards.push(card)
  }
  return cards
}

function diffCards(prevList, nextList) {
  const prev = new Map(prevList.map((c) => [c.id, c]))
  const next = new Map(nextList.map((c) => [c.id, c]))
  const added = [...next.keys()].filter((id) => !prev.has(id))
  const removed = [...prev.keys()].filter((id) => !next.has(id))
  const COMPARE_FIELDS = ['name', 'rarity', 'category', 'cost', 'power', 'counter', 'effect', 'trigger', 'distribution', 'regions']
  const changed = []
  for (const [id, nc] of next) {
    const pc = prev.get(id)
    if (!pc) continue
    const fields = COMPARE_FIELDS.filter((f) => JSON.stringify(pc[f] ?? null) !== JSON.stringify(nc[f] ?? null))
    if (fields.length) changed.push({ id, fields })
  }
  return { added, removed, changed }
}

function readJsonOrNull(path) {
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch (err) {
    console.warn(`Unreadable JSON at ${path} (${err.message}); treating as first run.`)
    return null
  }
}

function printDiffReport(prev, next) {
  if (!prev) {
    console.log(`\nFirst run -- no previous file to diff against.`)
    return
  }
  const { added, removed, changed } = diffCards(prev, next)
  console.log(`\nDiff vs previous:`)
  console.log(`  +${added.length} added   -${removed.length} removed   ~${changed.length} metadata-changed`)
  const SHOW = 20
  if (added.length) {
    console.log(`\n  Added (${added.length}):`)
    added.slice(0, SHOW).forEach((id) => console.log(`    + ${id}`))
    if (added.length > SHOW) console.log(`    ... and ${added.length - SHOW} more`)
  }
  if (removed.length) {
    console.log(`\n  Removed (${removed.length}):`)
    removed.slice(0, SHOW).forEach((id) => console.log(`    - ${id}`))
    if (removed.length > SHOW) console.log(`    ... and ${removed.length - SHOW} more`)
  }
  if (changed.length) {
    console.log(`\n  Metadata changed (${changed.length}):`)
    changed.slice(0, SHOW).forEach((c) => console.log(`    ~ ${c.id} [${c.fields.join(', ')}]`))
    if (changed.length > SHOW) console.log(`    ... and ${changed.length - SHOW} more`)
  }
}

/**
 * Scrape every series on a Bandai cardlist site (EN, JP, TC, TW, Asia-EN).
 * Returns the packs metadata, the unique card list, and the failure list
 * so the caller can decide whether to abort.
 */
async function scrapeRegion(region) {
  const listUrl = `${region.site}/cardlist/`
  console.log(`\n[${region.label}] Fetching pack list from ${region.site}...`)
  const landingHtml = await fetchHTML(listUrl)
  const packs = parseSeriesOptions(landingHtml)
  console.log(`[${region.label}] Found ${packs.length} series.`)

  const cards = []
  const failed = []

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]
    const tag = pack.title_parts.label ?? pack.title_parts.title ?? pack.id
    process.stdout.write(`[${region.label} ${i + 1}/${packs.length}] ${tag} (${pack.id})... `)
    try {
      const html = await fetchHTML(listUrl, `series=${pack.id}`)
      const found = parseAllCards(html, pack, region.site)
      console.log(`${found.length} cards`)
      cards.push(...found)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed.push(pack)
    }
    if (i < packs.length - 1) await sleep(300)
  }

  // Tag each row with its source language so the deduper doesn't have
  // to look it up from filename context.
  for (const c of cards) c.language = region.bundle

  return { packs, cards, failed }
}

/**
 * Write a per-language raw file to `data/by-language/<id>.json`. Returns
 * the path written and the card count so the caller can log it.
 */
function writePerLanguageOutput(region, cards) {
  mkdirSync(BY_LANG_DIR, { recursive: true })
  const out = join(BY_LANG_DIR, `${region.id}.json`)
  if (DRY_RUN) {
    console.log(`  --dry-run: would write ${cards.length} cards to ${out}`)
    return out
  }
  const prev = readJsonOrNull(out)
  printDiffReport(prev, cards)
  writeFileSync(out + '.tmp', JSON.stringify(cards, null, 2))
  if (existsSync(out)) copyFileSync(out, out + '.bak')
  renameSync(out + '.tmp', out)
  return out
}

/**
 * Legacy back-compat mode: do the EN + JP merge into `data/cards.json`
 * exactly the way the pre-Phase-7 pipeline did. Used to keep the existing
 * generator + UI functional until the new per-language deduper takes over.
 */
async function runLegacyMode() {
  mkdirSync(DATA_DIR, { recursive: true })

  const en = await scrapeRegion(REGIONS.en)

  const allCards = []
  const seen = new Set()
  for (const c of en.cards) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    allCards.push({ ...c, regions: ['EN'] })
  }
  console.log(`\n[EN] ${allCards.length} unique cards.`)

  const failed = [...en.failed.map((p) => ({ region: 'EN', pack: p }))]

  if (!EN_ONLY) {
    const jp = await scrapeRegion(REGIONS.jp)
    failed.push(...jp.failed.map((p) => ({ region: 'JP', pack: p })))

    let jpAdded = 0
    let jpAlreadyHave = 0
    for (const c of jp.cards) {
      if (seen.has(c.id)) {
        const existing = allCards.find((x) => x.id === c.id)
        if (existing && !existing.regions.includes('JP')) existing.regions.push('JP')
        jpAlreadyHave++
        continue
      }
      seen.add(c.id)
      allCards.push({ ...c, regions: ['JP'] })
      jpAdded++
    }

    console.log(
      `\n[JP] +${jpAdded} new cards (variants + JP-only base cards), ` +
      `${jpAlreadyHave} already in EN (tagged multi-region).`
    )
  } else {
    console.log(`\n[JP] Skipped (--en-only).`)
  }

  const prev = readJsonOrNull(CARDS_PATH)
  printDiffReport(prev, allCards)

  if (failed.length > 0) {
    console.warn(`\nFailed packs (${failed.length}):`)
    failed.forEach((f) => console.warn(`  - [${f.region}] ${f.pack.title_parts.label ?? f.pack.id} (id=${f.pack.id})`))
    if (!ALLOW_PARTIAL) {
      console.error(
        `\nRefusing to overwrite data/cards.json: ${failed.length} series failed to fetch. ` +
        `Re-run when Bandai is healthy, or pass --allow-partial to overwrite anyway.`
      )
      process.exit(2)
    }
    console.warn(`--allow-partial set; writing anyway.`)
  }

  if (prev && allCards.length < prev.length * MIN_RETENTION_RATIO) {
    console.error(
      `\nRefusing to overwrite data/cards.json: new pull has ${allCards.length} cards ` +
      `vs previous ${prev.length} (below ${Math.round(MIN_RETENTION_RATIO * 100)}% retention threshold). ` +
      `This usually means a parser regression or a Bandai outage. ` +
      `Re-run, or pass --allow-partial if the drop is intentional.`
    )
    if (!ALLOW_PARTIAL) process.exit(3)
    console.warn(`--allow-partial set; writing anyway.`)
  }

  if (DRY_RUN) {
    console.log(`\n--dry-run set; not writing data/cards.json or data/packs.json.`)
    return
  }

  writeFileSync(CARDS_TMP_PATH, JSON.stringify(allCards, null, 2))
  if (existsSync(CARDS_PATH)) copyFileSync(CARDS_PATH, CARDS_BAK_PATH)
  renameSync(CARDS_TMP_PATH, CARDS_PATH)
  writeFileSync(PACKS_PATH, JSON.stringify(en.packs, null, 2))

  const jpCount = allCards.filter((c) => c.regions.includes('JP') && !c.regions.includes('EN')).length
  const dualCount = allCards.filter((c) => c.regions.includes('EN') && c.regions.includes('JP')).length
  console.log(
    `\nWrote ${allCards.length} unique cards to data/cards.json ` +
    `(EN-only: ${allCards.length - jpCount - dualCount}, ` +
    `dual-region: ${dualCount}, ` +
    `JP-only: ${jpCount}). Previous saved to data/cards.json.bak.`
  )
}

/**
 * New per-language mode: scrape a single region and write
 * `data/by-language/<id>.json` (plus `data/packs.json` for EN so the
 * existing generator's pack bucketing still has a packs map to read).
 */
async function runPerLanguageMode(region) {
  mkdirSync(DATA_DIR, { recursive: true })
  const { packs, cards, failed } = await scrapeRegion(region)

  if (failed.length > 0) {
    console.warn(`\n[${region.label}] Failed packs (${failed.length}):`)
    failed.forEach((p) => console.warn(`  - ${p.title_parts.label ?? p.id} (id=${p.id})`))
    if (!ALLOW_PARTIAL) {
      console.error(`\nRefusing to write ${region.id}.json: ${failed.length} series failed. ` +
        `Pass --allow-partial to write anyway.`)
      process.exit(2)
    }
  }

  const out = writePerLanguageOutput(region, cards)
  console.log(`\n[${region.label}] Wrote ${cards.length} card rows to ${out}.`)

  // Only EN drives packs.json (the generator uses pack ids that are EN-site
  // ids). Re-scraping packs from non-EN regions would overwrite that with
  // ids the generator can't match.
  if (region.id === 'en' && !DRY_RUN) {
    writeFileSync(PACKS_PATH, JSON.stringify(packs, null, 2))
    console.log(`[EN] Wrote ${packs.length} packs to ${PACKS_PATH}.`)
  }
}

async function main() {
  if (argLanguage === 'legacy') {
    return runLegacyMode()
  }
  if (argLanguage === 'all') {
    for (const key of ALL_REGION_KEYS) {
      await runPerLanguageMode(REGIONS[key])
    }
    return
  }
  return runPerLanguageMode(REGIONS[argLanguage])
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
