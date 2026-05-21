/**
 * Scrape Bandai's official Simplified Chinese cardlist from the
 * `onepiece-cardgame.cn` Vue SPA backed by the
 * `onepieceserve.windoent.com` JSON API.
 *
 * WHY THIS EXISTS
 * ---------------
 * The other Bandai regional sites (`en`, `jp`, `asia-en`, `asia-tc`,
 * `asia-tw`) ship a static-HTML `/cardlist/` we scrape via
 * `fetch-card-data.mjs`. The `.cn` site is a Vue SPA: there is no
 * static HTML to parse. We have to call the same JSON API the SPA
 * uses internally. The endpoint was reverse-engineered from
 * `https://www.onepiece-cardgame.cn/static/js/app.efccd344.js` (the
 * mapping `e.cardListApi = L` returns
 * `cardList/cardlist/weblist?page=N&limit=M`; details endpoint is
 * `cardList/cardlist/webInfo/<id>`).
 *
 * Output: `data/by-language/cn.json`, in the same row shape as the
 * other per-language files so `dedupe-cross-language.mjs` can ingest
 * it identically. Each row is tagged language `SC` (Simplified
 * Chinese) — a new CardLanguage value added in this phase that
 * extends the CN bucket of the picker (along with the existing TC
 * and TW).
 *
 * IMAGES
 * ------
 * The CN site stores cards on `source.windoent.com` (a Bandai CDN
 * partner). URLs look like:
 *   https://source.windoent.com/OnePiecePc/Picture/<ts><CARDID>.png
 * Filename conventions differ from Bandai's other regions:
 *   OP01-001P_D.png   (Promo + Discard variant marker)
 *   OP06_118_SEC.png  (Secret rare; uses _ instead of -)
 * We pass URLs through as-is; the deduper's `imagesByLanguage` map
 * keys them under the `sc` slot, which the generator renders directly
 * (no R2 mirror until uploaded).
 *
 * VARIANT NORMALIZATION
 * ---------------------
 * Some CN card numbers have a trailing variant marker (the same
 * `_pN` suffix Bandai uses on other regions) but a few use CN-
 * specific markers (`P_D`, `_SEC`, `_pN`). When the `cardNumber`
 * field of the API response doesn't match the standard
 * `<PREFIX>-<NNN>(_pN)?` pattern, we normalize it via
 * `normalizeCnId()` so cross-region dedup works.
 *
 * Usage:
 *   node scripts/fetch-bandai-cn.mjs
 *   node scripts/fetch-bandai-cn.mjs --dry-run
 *   node scripts/fetch-bandai-cn.mjs --max-pages=10
 */

import { writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BY_LANG_DIR = join(ROOT, 'data', 'by-language')
const OUT_PATH = join(BY_LANG_DIR, 'cn.json')

const DRY_RUN = process.argv.includes('--dry-run')
const MAX_PAGES = (() => {
  const a = process.argv.find((x) => x.startsWith('--max-pages='))
  return a ? parseInt(a.split('=')[1], 10) : Infinity
})()

const API_BASE = 'https://onepieceserve.windoent.com'
const PAGE_SIZE = 100  // server caps at ~200; 100 is a safe sweet spot
const REFERER = 'https://www.onepiece-cardgame.cn/'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchJson(path) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: {
      'Accept': 'application/json',
      'Referer': REFERER,
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`)
  return res.json()
}

/**
 * Normalize the `cardNumber` returned by the CN API into the canonical
 * Bandai id format used by every other region's scrape:
 *
 *   "OP01-016"        -> "OP01-016"            (no change)
 *   "OP01-016_p1"     -> "OP01-016_p1"         (no change)
 *   "OP06_118_SEC"    -> "OP06-118"            (underscore -> dash; drop _SEC suffix)
 *   "OP01-001P_D"     -> "OP01-001"            (drop CN-specific marker)
 *   "OP01-001P"       -> "OP01-001"            (Promo marker)
 *   "OP09-076"        -> "OP09-076"            (no change)
 *
 * The CN-specific markers (`P_D`, `_SEC`, `P` alone) are visual
 * rarity / overlay indicators, NOT variant suffixes. They map to
 * the same canonical print, with the variant suffix (if any) carried
 * by the `_pN` portion when present.
 */
function normalizeCnId(raw) {
  if (!raw) return null
  let id = String(raw).trim()

  // 1. Underscore-as-separator: "OP06_118" -> "OP06-118"
  id = id.replace(/^([A-Z]+\d+)_(\d{3,})/, '$1-$2')

  // 2. CN-specific rarity / overlay markers — strip in order from
  // longest to shortest so a "P-SR" doesn't get half-eaten by "-SR".
  // These are visual overlays on the underlying print, not variants
  // (e.g. `OP01-022SP` is the SR-rarity printing of OP01-022, NOT
  // a separate alt art). Order matters.
  const STRIP_TAILS = [
    'P-SEC', 'P-SR', 'P-SP', 'P-LP', 'P-CP',
    'P-R', 'P-D',
    '_SEC', '_SR', '_SP', '_LP', '_CP',
    '_PR', '_PD', '_D',
    'SEC', 'SR', 'SP', 'LP', 'CP', 'PR',
    'P',
    'S',
  ]
  for (const tail of STRIP_TAILS) {
    if (id.endsWith(tail)) {
      // Don't strip if it would leave nothing or only a prefix; the
      // underlying id must keep at least one digit after the last
      // letter group.
      const stripped = id.slice(0, -tail.length)
      if (/\d$/.test(stripped)) {
        id = stripped
        break
      }
    }
  }

  // 3. CN variant suffix style: "_01", "_02", ... -> "_p1", "_p2" so
  // it bucket-aligns with Bandai's other regions' `_pN` convention.
  id = id.replace(/_(0?\d+)$/, (_, n) => `_p${parseInt(n, 10)}`)

  // 4. Stray trailing dash-digit groups (rare): "-04" -> "_p4"
  id = id.replace(/-(\d+)$/, (whole, n) => {
    // Don't munge a legitimate base id (e.g. OP14-099). Only convert
    // if the digit group is short (1-2 digits) and there's already
    // a base-id-style "XX-NNN" before it.
    if (/^[A-Z]+\d+-\d{3,}/.test(id.slice(0, -whole.length)) && n.length <= 2) {
      return `_p${parseInt(n, 10)}`
    }
    return whole
  })

  return id
}

/**
 * Determine whether a CN id has a CN-only stamp suffix (P, P_D, SEC)
 * that should become a separate canonical print rather than collapsing
 * onto the base. The 1st Anniversary Set Nami is one of these — its
 * filename ends in something like _P_D and Bandai treats it as a
 * distinct print in their own database even though it shares the base
 * card number.
 */
function detectCnStampSuffix(raw) {
  if (!raw) return null
  const s = String(raw)
  if (/_SEC$/.test(s)) return 'sec'
  if (/P_D$/.test(s)) return 'pd'
  if (/_PR$/.test(s)) return 'pr'
  return null
}

async function fetchAllCards() {
  console.log('Fetching CN catalogue from onepieceserve.windoent.com...')
  // Probe page 1 to learn totals.
  const first = await fetchJson(`/cardList/cardlist/weblist?page=1&limit=${PAGE_SIZE}`)
  if (first.code !== 0) throw new Error(`API error: ${first.msg}`)
  const total = first.page.totalCount
  const totalPages = first.page.totalPage
  console.log(`  total cards: ${total} across ${totalPages} pages (page size ${PAGE_SIZE})`)

  const all = [...first.page.list]
  const maxPages = Math.min(totalPages, MAX_PAGES)
  for (let p = 2; p <= maxPages; p++) {
    try {
      const res = await fetchJson(`/cardList/cardlist/weblist?page=${p}&limit=${PAGE_SIZE}`)
      if (res.code !== 0) {
        console.warn(`  page ${p}: API error ${res.msg}`)
        continue
      }
      all.push(...res.page.list)
      if (p % 10 === 0) {
        process.stdout.write(`  page ${p}/${maxPages} (${all.length} cards so far)\n`)
      }
    } catch (err) {
      console.warn(`  page ${p}: FAILED (${err.message})`)
    }
    // Be polite — the API is hosted on a partner CDN, not Bandai
    // proper. Throttle harder than the cardlist scrape.
    await sleep(200)
  }
  console.log(`Fetched ${all.length} raw cards.`)
  return all
}

function transformRow(raw) {
  const id = normalizeCnId(raw.cardNumber)
  if (!id) return null
  // If the raw cardNumber has a CN-specific stamp marker AND no
  // explicit _pN variant suffix, attach a synthetic variant marker
  // so cross-region dedup keeps it separate from the base print.
  // Examples that need this: OP01-016 1st Anniversary Set print
  // (CN labels it OP01-016 with a P_D / SEC marker but it's the
  // exclusive serial-numbered anniversary print, not the base R).
  const stamp = detectCnStampSuffix(raw.cardNumber)
  const hasExplicitVariant = /_p\d+$/i.test(id)
  // We trust the deduper's distribution-based bucketing to merge
  // this with the equivalent EN/JP anniversary print, so we DON'T
  // append a variant suffix here. The stamp is preserved on the
  // row metadata for downstream display.
  return {
    id,
    name: '',  // The CN API does NOT include card names in the list
                // endpoint. Names live on cardInfo per-card; we skip
                // fetching them by default to keep the scrape fast.
                // Bandai's other regions provide names, so the
                // deduper will pick those up via namesByLanguage and
                // the CN row inherits via the merge.
    rarity: null,
    category: null,
    colors: [],
    cost: null,
    power: null,
    counter: null,
    attributes: [],
    types: [],
    effect: null,
    trigger: null,
    distribution: raw.cardOfferType || null,
    img_full_url: raw.cardImg || null,
    img_path: `cards/${id}.png`,
    source_pack_id: `cn:${raw.cardOfferType || 'unknown'}`,
    source_pack_prefix: 'CN',
    source_pack_label: raw.cardOfferType || null,
    source: 'bandai',
    cn_raw_number: raw.cardNumber,
    cn_id: raw.id,
    cn_stamp: stamp,
  }
}

/**
 * The CN site's product pages are the ONLY place to find region-
 * exclusive promo prints (1st Anniversary Set, Premium Card
 * Collection 2nd Anniversary, etc.) — those don't appear in the
 * paginated /cardlist/ API. Each product detail returns a
 * `productsInfoBean.titleModel` blob with fields
 *   modelTitle0 .. modelTitle5
 *   modelImage0 .. modelImage5
 * where each title typically contains "<label>：<CARDID> <NAME>".
 *
 * We parse those, synthesize one row per (product, card) match, and
 * write to a separate `cn-products.json` so the deduper bucket
 * matcher can merge them with equivalent EN/JP anniversary prints.
 *
 * Image policy: the modelImage URLs are PROMOTIONAL BANNERS for the
 * print, not the actual card scan (the official .cn site doesn't
 * publish high-res card scans for these limited products). They're
 * the best first-party image available; downstream code keeps them
 * as the SC-language image when no better source is known.
 */
async function fetchProductCatalogue() {
  console.log('\nFetching CN product catalogue...')
  const res = await fetchJson('/products/productsinfo/webList')
  if (res.code !== 0) throw new Error(`productsWebList error: ${res.msg}`)
  const products = res.list ?? []
  console.log(`  found ${products.length} products`)
  return products
}

async function fetchProductDetail(id) {
  try {
    const res = await fetchJson(`/products/productsinfo/webInfo/${id}`)
    return res.productsInfoBean ?? null
  } catch (err) {
    console.warn(`  product ${id}: FAILED (${err.message})`)
    return null
  }
}

/**
 * Pull every (cardId, name, imageUrl) triple out of a titleModel
 * blob. The titles use a colon (Chinese full-width or ASCII) to
 * separate the label from the card spec, and the spec is
 * "<CARDID> <NAME>". A handful of products tag prints with the
 * `modelNotes` field — we look there too in case the title is a
 * generic intro and the actual card spec is in the notes.
 */
const CARD_REF_RE = /\b(OP\d+|ST\d+|EB\d+|PRB\d+|P)-?(\d+)\b/g

function normalizeCardRef(prefix, numRaw) {
  const num = prefix === 'P' ? numRaw : numRaw.padStart(3, '0')
  return `${prefix}-${num}`
}

function extractFirstImgSrc(html) {
  if (!html) return null
  const m = html.match(/<img[^>]+src="([^"]+)"/)
  return m ? m[1] : null
}

/**
 * Pull every (cardId, name, imageUrl) triple out of a product detail
 * blob. Tries the structured `titleModel` first (used by 1st-
 * generation anniversary and Premium Card Collection products), then
 * falls back to scanning the HTML-rich content fields used by newer
 * anniversary sets (3rd, 4th anniversary).
 */
function parseProductCards(detail) {
  if (!detail) return []
  const productName = detail.name || ''
  const out = []
  const seen = new Set()

  // Path 1: structured titleModel (product 40 = 1st anniv).
  if (detail.titleModel) {
    for (let i = 0; i < 6; i++) {
      const title = detail.titleModel[`modelTitle${i}`]
      if (!title) continue
      CARD_REF_RE.lastIndex = 0
      const m = CARD_REF_RE.exec(title)
      if (!m) continue
      const id = normalizeCardRef(m[1], m[2])
      if (seen.has(id)) continue
      const image = detail.titleModel[`modelImage${i}`] || null
      const nameMatch = title.match(new RegExp(`${m[1]}-?${m[2]}\\s*(.+)$`))
      const name = nameMatch ? nameMatch[1].trim() : ''
      out.push({ id, name, image, productName, sourceTitle: title })
      seen.add(id)
    }
  }

  // Path 2: HTML body scan (products 84 / 94 / 128 = 2nd / 3rd / 4th
  // anniversary). The card spec lives inside `detailContent`,
  // `detailRemark`, `detailBodyTitle`, or `detailName` as plain text
  // mentions like "OP08-105杰丽·邦妮". We harvest every card ref we
  // find and pair it with the first <img> in the same HTML field as
  // the best-available banner image.
  const HTML_FIELDS = ['detailBodyTitle', 'detailName', 'detailContent', 'detailRemark']
  for (const field of HTML_FIELDS) {
    const html = detail[field]
    if (!html) continue
    const fieldImg = extractFirstImgSrc(html) ?? detail.detailBanner ?? null
    CARD_REF_RE.lastIndex = 0
    let m
    while ((m = CARD_REF_RE.exec(html)) !== null) {
      const id = normalizeCardRef(m[1], m[2])
      if (seen.has(id)) continue
      // Try to recover a name immediately following the card id.
      const tail = html.slice(m.index + m[0].length, m.index + m[0].length + 60)
      const nameMatch = tail.match(/^[\s·•]*([\u4e00-\u9fff·•\.A-Za-z]+)/)
      const name = nameMatch ? nameMatch[1].trim() : ''
      out.push({ id, name, image: fieldImg, productName, sourceTitle: `${field}: ${id}` })
      seen.add(id)
    }
  }

  return out
}

async function main() {
  const raw = await fetchAllCards()
  const transformed = raw.map(transformRow).filter(Boolean)
  // Collapse duplicates: the API may list the same cardNumber under
  // multiple cardOfferType sets (rare, but happens for cards that
  // reprint across booster + promo).
  const seen = new Map()
  for (const row of transformed) {
    if (!seen.has(row.id)) {
      seen.set(row.id, row)
      continue
    }
    // Keep the row with the richer distribution. If the existing
    // row already has a CN-specific stamp tag and the new one
    // doesn't, keep the existing — we don't want to lose the
    // anniversary marker.
    const existing = seen.get(row.id)
    if (!existing.cn_stamp && row.cn_stamp) seen.set(row.id, row)
  }
  const unique = [...seen.values()]

  // Stats.
  const stamps = unique.filter((r) => r.cn_stamp)
  const variants = unique.filter((r) => /_p\d+$/i.test(r.id))
  console.log(`\nNormalized to ${unique.length} unique prints (${transformed.length - unique.length} duplicates collapsed).`)
  console.log(`  CN-stamped prints (anniversary / secret / promo overlays): ${stamps.length}`)
  console.log(`  explicit _pN variant prints: ${variants.length}`)

  // Confirm the user's target card is in here.
  const op01016 = unique.filter((r) => r.id === 'OP01-016' || r.id.startsWith('OP01-016_'))
  console.log(`  OP01-016 family in CN data: ${op01016.length} entries`)
  for (const r of op01016) {
    console.log(`    ${r.id}  raw=${r.cn_raw_number}  stamp=${r.cn_stamp ?? '-'}  dist=${(r.distribution ?? '').slice(0, 60)}`)
  }

  // Walk the product catalogue and harvest prints that don't appear
  // in the paginated /cardlist/ (anniversary / premium / promo).
  const products = await fetchProductCatalogue()
  const productCards = []
  let probed = 0
  for (const p of products) {
    probed += 1
    // Only `其他` (Other) products use the titleModel format. Other
    // categories are merchandise (sleeves, playmats, storage boxes)
    // with no per-card spec.
    if (p.typeName !== '其他') continue
    const detail = await fetchProductDetail(p.id)
    if (!detail) continue
    const cards = parseProductCards(detail)
    if (cards.length === 0) continue
    console.log(`  product ${p.id} "${detail.name}": ${cards.length} cards extracted`)
    for (const c of cards) {
      // Attach a synthetic _pNN variant suffix so the deduper treats
      // this as a variant (not the base print), then groups it cross-
      // region by normalized distribution. The actual N is irrelevant
      // — the deduper's bucket-based merger replaces it with the
      // canonical id (e.g. EN's _p7 for the 1st Anniversary bucket).
      // Use _p9N where N is the CN product id to keep these out of
      // the natural _p1.._p9 suffix space Bandai uses elsewhere.
      const syntheticSuffix = `_p9${String(p.id).padStart(2, '0').slice(-2)}`
      const finalId = `${c.id}${syntheticSuffix}`
      productCards.push({
        id: finalId,
        name: c.name || c.id,
        rarity: null,
        category: null,
        colors: [],
        cost: null,
        power: null,
        counter: null,
        attributes: [],
        types: [],
        effect: null,
        trigger: null,
        // Use the product name as distribution so the deduper's
        // anniversary / premium / promo-set bucketing fires. The
        // CN names contain Chinese keywords like "一周年" (1st
        // Anniversary) which the normalizer recognises.
        distribution: detail.name,
        img_full_url: c.image,
        img_path: `cards/${finalId}.png`,
        source_pack_id: `cn-products:${p.id}`,
        source_pack_prefix: 'CN_PRODUCT',
        source_pack_label: detail.name,
        source: 'bandai',
        cn_product_id: p.id,
        cn_product_title: c.sourceTitle,
      })
    }
    await sleep(150)
  }
  console.log(`\nProbed ${probed} products, harvested ${productCards.length} additional prints from product pages.`)

  // Verify the user's target Nami print landed in here.
  const namis = productCards.filter((r) => r.id === 'OP01-016')
  if (namis.length) {
    console.log(`\nOP01-016 found in product harvest (${namis.length} entries):`)
    for (const n of namis) {
      console.log(`  product ${n.cn_product_id}  "${n.distribution}"  -> ${n.img_full_url?.slice(0, 100)}`)
    }
  }

  if (DRY_RUN) {
    console.log('\n--dry-run set; not writing.')
    return
  }

  mkdirSync(BY_LANG_DIR, { recursive: true })
  if (existsSync(OUT_PATH)) copyFileSync(OUT_PATH, OUT_PATH + '.bak')
  writeFileSync(OUT_PATH + '.tmp', JSON.stringify(unique, null, 2))
  renameSync(OUT_PATH + '.tmp', OUT_PATH)
  console.log(`\nWrote ${unique.length} rows to ${OUT_PATH}.`)

  const PRODUCTS_PATH = join(BY_LANG_DIR, 'cn-products.json')
  if (existsSync(PRODUCTS_PATH)) copyFileSync(PRODUCTS_PATH, PRODUCTS_PATH + '.bak')
  writeFileSync(PRODUCTS_PATH + '.tmp', JSON.stringify(productCards, null, 2))
  renameSync(PRODUCTS_PATH + '.tmp', PRODUCTS_PATH)
  console.log(`Wrote ${productCards.length} rows to ${PRODUCTS_PATH}.`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
