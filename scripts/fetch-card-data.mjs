/**
 * Fetches all One Piece TCG card data DIRECTLY from Bandai's official site:
 * https://en.onepiece-cardgame.com/cardlist/
 *
 * Why direct: the previous vegapull-records mirror lags by months. Going to the
 * source guarantees newest sets (OP-13, OP-14, OP-15, EB-03, PRB-02, ST-22+)
 * the moment Bandai adds them.
 *
 * Output: data/cards.json - normalized array compatible with the existing
 *         generate-card-data.mjs (id, name, category, rarity, colors, cost,
 *         power, counter, attributes, types, effect, trigger, img_full_url,
 *         source_pack_id/prefix/label)
 *
 *         data/packs.json - pack metadata derived from the dropdown
 *
 * Usage: node scripts/fetch-card-data.mjs
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync, renameSync, copyFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
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

const EN_SITE = 'https://en.onepiece-cardgame.com'
const EN_LIST_URL = `${EN_SITE}/cardlist/`
const JP_SITE = 'https://www.onepiece-cardgame.com'
const JP_LIST_URL = `${JP_SITE}/cardlist/`
// Backwards-compat alias: existing parseCardBlock builds the image URL from
// `SITE`, which used to be the EN host. Kept here so the EN parse path is
// unchanged; JP cards are parsed against JP_SITE separately below.
const SITE = EN_SITE
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Opt-out: by default we union the EN scrape with the JP scrape's variants
// of any EN base card we already know about (e.g. the JP-only Family Deck
// Set Nami `ST01-007_r1`, the JP-only Storage Box Nami `_p6`/`_p7`, and
// every comparable promo across the catalogue). JP-only base cards (i.e.
// JP cards whose base ID we've never seen on EN) are skipped to avoid
// surfacing unreleased EN content; we can revisit that policy later.
const EN_ONLY = process.argv.includes('--en-only')

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHTML(url, body = null) {
  const init = {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  }
  if (body) {
    init.method = 'POST'
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded'
    init.body = body
  }
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
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
    // Catch any remaining numeric refs (Bandai mixes &#039; and &#39; etc.)
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

function parseCardBlock(block, pack, hostOrigin = SITE) {
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

  // Bandai exposes "Card Set(s)" in a <div class="getInfo"> on every card,
  // which is the human-readable distribution string: where this specific
  // variant came from. Examples (drawn from real cards):
  //   - "Premium Card Collection -FILM RED Edition-"
  //   - "2025 NEW YEAR EVENT"
  //   - "Tournament Pack Vol.3"
  //   - "Super Pre-Release"
  //   - "Pre-Release OP03"
  //   - "-WINGS OF THE CAPTAIN-[OP06]"
  // Capturing it lets us label variants ("p4 = 2025 NEW YEAR EVENT") and
  // answer "is this a pre-release card?" by simple substring search, instead
  // of needing a manual investigation per question.
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

function parseAllCards(html, pack, hostOrigin = SITE) {
  const cards = []
  const re = /<dl\s+class="modalCol"[\s\S]*?<\/dl>/g
  let m
  while ((m = re.exec(html)) !== null) {
    const card = parseCardBlock(m[0], pack, hostOrigin)
    if (card) cards.push(card)
  }
  return cards
}

/**
 * Compare a fresh card pull against the previous on-disk copy and print a
 * structured diff. Pure: returns the diff buckets, doesn't write anything.
 *
 * "metadata changed" is intentionally narrow -- we only compare a stable
 * subset of fields so cosmetic upstream HTML reshuffling (e.g. attribute
 * ordering) doesn't blow up the diff with noise.
 */
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

function readPrevCards() {
  if (!existsSync(CARDS_PATH)) return null
  try {
    return JSON.parse(readFileSync(CARDS_PATH, 'utf8'))
  } catch (err) {
    console.warn(`Previous cards.json unreadable (${err.message}); treating as first run.`)
    return null
  }
}

function printDiffReport(prev, next) {
  if (!prev) {
    console.log(`\nFirst run -- no previous cards.json to diff against.`)
    return
  }
  const { added, removed, changed } = diffCards(prev, next)
  console.log(`\nDiff vs previous cards.json:`)
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
 * Scrape every series on a Bandai cardlist site (EN or JP) and return the
 * unique card list. Returns the new cards (no dedup across `seen`) plus the
 * list of packs that failed so the caller can fail loud or filter.
 */
async function scrapeRegion(label, listUrl, hostOrigin) {
  console.log(`\n[${label}] Fetching pack list from ${hostOrigin}...`)
  const landingHtml = await fetchHTML(listUrl)
  const packs = parseSeriesOptions(landingHtml)
  console.log(`[${label}] Found ${packs.length} series.`)

  const cards = []
  const failed = []

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]
    const tag = pack.title_parts.label ?? pack.title_parts.title ?? pack.id
    process.stdout.write(`[${label} ${i + 1}/${packs.length}] ${tag} (${pack.id})... `)
    try {
      const html = await fetchHTML(listUrl, `series=${pack.id}`)
      const found = parseAllCards(html, pack, hostOrigin)
      console.log(`${found.length} cards`)
      cards.push(...found)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed.push(pack)
    }
    if (i < packs.length - 1) await sleep(300)
  }

  return { packs, cards, failed }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  // ---- EN scrape (canonical) ----
  // EN data is the source of truth. Card metadata, set membership, ordering
  // -- all of it comes from EN. JP is consulted only to fill in variants
  // EN hasn't listed yet (and is opt-out via --en-only).
  const en = await scrapeRegion('EN', EN_LIST_URL, EN_SITE)

  const allCards = []
  const seen = new Set()
  for (const c of en.cards) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    allCards.push({ ...c, regions: ['EN'] })
  }
  console.log(`\n[EN] ${allCards.length} unique cards.`)

  const failed = [...en.failed.map((p) => ({ region: 'EN', pack: p }))]

  // ---- JP merge (additive only) ----
  // Every JP card the scrape returns gets admitted unless we already
  // saw it on EN. Each new card is tagged `regions: ['JP']`; cards
  // listed on both sites get `regions: ['EN', 'JP']`. This includes
  // JP-only alt-art variants (Family Deck Set, Storage Box pulls,
  // magazine promos) AND JP-only base cards (e.g. ST-30 Luffy & Ace,
  // a Japan-only starter EN hasn't shipped yet; ~21 P-XXX magazine
  // promos like the Vジャンプ Trafalgar Law).
  //
  // The application layer hides JP content by default behind the
  // header "JP" toggle (see src/lib/card-filter.ts applyRegionFilter
  // -- it strips both JP-only base cards and JP-only variants). So
  // the ingestion is the "complete dataset" layer; the UI decides
  // what to surface. Casual EN browsers never see JP cards unless
  // they opt in.
  if (!EN_ONLY) {
    const jp = await scrapeRegion('JP', JP_LIST_URL, JP_SITE)
    failed.push(...jp.failed.map((p) => ({ region: 'JP', pack: p })))

    let jpAdded = 0
    let jpAlreadyHave = 0
    for (const c of jp.cards) {
      if (seen.has(c.id)) {
        // Card exists on both sites -- tag the existing record as multi-region.
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

  // ---- Safety rails ----
  // Anything below here is "we have the data, now decide whether to publish
  // it". This is the layer that catches silent corruption: a partial scrape,
  // a parser regression, or a Bandai-side outage that drops half the catalog.

  const prev = readPrevCards()
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

  // Atomic-ish write: stage to .tmp, rotate current to .bak, swap in .tmp.
  // If anything throws between the writeFileSync and the rename, .tmp is left
  // in place (easy to inspect) and the existing cards.json is untouched.
  writeFileSync(CARDS_TMP_PATH, JSON.stringify(allCards, null, 2))
  if (existsSync(CARDS_PATH)) copyFileSync(CARDS_PATH, CARDS_BAK_PATH)
  renameSync(CARDS_TMP_PATH, CARDS_PATH)
  // packs.json is EN-only on purpose. The downstream generator uses it for
  // pack-id-based bucketing (PROMO / Premium Bandai Exclusives), and those
  // bucket IDs are EN site IDs. JP scrape contributes cards, not packs.
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

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
