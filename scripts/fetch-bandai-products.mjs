/**
 * Scrape Bandai's /products/ showcase pages for card prints that don't
 * appear in /cardlist/.
 *
 * MOTIVATION
 * ----------
 * Bandai keeps anniversary boxes, Premium Card Collection variants,
 * drama collections, magazine appendices, and other Premium-Bandai-only
 * promo products on `/products/other/*.php` (and `/products/*.html`)
 * pages, NOT in the searchable `/cardlist/` database. The Phase 7
 * scraper only hits `/cardlist/`, so anything Bandai files under
 * /products/ never makes it into our dataset.
 *
 * This script fills that gap. Per region:
 *   1. Fetch `/products/`, `/products/?subcategory=others`, and
 *      `/products/?tags=other` to enumerate every product URL the
 *      region currently exposes.
 *   2. For each product page, look for `<img>` tags whose `alt`
 *      attribute embeds a Bandai card id (the convention used across
 *      EN, JP, asia-en, asia-tc, asia-tw).
 *   3. Emit one row per harvested card, shaped like the per-language
 *      cardlist scrapes so the deduper can ingest it without special-
 *      casing.
 *
 * ALT-TEXT CONVENTIONS WE PARSE
 * -----------------------------
 *   EN (en + asia-en):
 *     alt="Card image of P-141 Roronoa Zoro"
 *     alt="Card image of OP01-016 Nami"
 *
 *   JP:
 *     alt="『<product name> - <CARDID> <JP name>』のカード画像"
 *
 *   TC / TW:
 *     alt="『<product name> - <CARDID> <CN name>』的卡牌圖像"
 *
 * The card-id regex is the union of every Bandai print id format we
 * know: OP01-016, ST10-001, EB04-028, PRB01-005, P-140, P-141_p1.
 *
 * IMAGE URL POLICY
 * ----------------
 * Product-page images are NOT canonical card images. Their filenames
 * are hash slugs like `img_item07.webp` or `/onepiececg/bccard/.../
 * img_item02.webp`. We pass them through as-is; the deduper treats
 * them as the "image of record" for prints that have no /cardlist/
 * counterpart, but defers to /cardlist/ images when both exist.
 *
 * Usage:
 *   node scripts/fetch-bandai-products.mjs                  # sweep every region
 *   node scripts/fetch-bandai-products.mjs --region=jp      # one region only
 *   node scripts/fetch-bandai-products.mjs --dry-run
 */

import { writeFileSync, mkdirSync, existsSync, copyFileSync, renameSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BY_LANG_DIR = join(ROOT, 'data', 'by-language')

const DRY_RUN = process.argv.includes('--dry-run')
const onlyRegion = process.argv.find((a) => a.startsWith('--region='))?.split('=')[1]

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

// Each region exposes /products/ as a curated landing page plus a few
// taxonomy variants. We sweep all of them and de-duplicate URLs at
// the end. The naming differs across sites (subcategory=others vs
// subcategory=other vs tags=other), so we try every known variant.
const REGIONS = {
  en:        { id: 'en',      lang: 'EN',      site: 'https://en.onepiece-cardgame.com' },
  jp:        { id: 'jp',      lang: 'JP',      site: 'https://www.onepiece-cardgame.com' },
  'asia-en': { id: 'asia-en', lang: 'EN_ASIA', site: 'https://asia-en.onepiece-cardgame.com' },
  'asia-tc': { id: 'asia-tc', lang: 'TC',      site: 'https://asia-tc.onepiece-cardgame.com' },
  'asia-tw': { id: 'asia-tw', lang: 'TW',      site: 'https://asia-tw.onepiece-cardgame.com' },
}

const PRODUCT_LIST_PATHS = [
  '/products/',
  '/products/?subcategory=others',
  '/products/?subcategory=other',
  '/products/?tags=other',
  '/products/?tags=others',
  '/products/?subcategory=boosters',
  '/products/?subcategory=decks',
]

// Card-id formats Bandai uses across all regions:
//   OP01-016, OP01-016_p1
//   ST10-001
//   EB04-028
//   PRB01-005
//   P-140, P-141_p1   (promo namespace)
const CARD_ID_RE = /\b(OP\d+|ST\d+|EB\d+|PRB\d+|P)-(\d+)(_p\d+)?\b/g

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHTML(url) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      'Accept': 'text/html,application/xhtml+xml',
      'Accept-Language': 'en-US,en;q=0.9',
    },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.text()
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

/**
 * Find all product page URLs linked from a /products/ listing HTML.
 * We accept hrefs matching `/products/<file>.(php|html)` and
 * `/products/<dir>/<file>.(php|html)`. Filters out the listing page
 * itself and any non-product links (boosters/decks landing pages are
 * still passed through; their detail pages get scraped if they list
 * cards).
 */
function extractProductLinks(html, siteOrigin) {
  const out = new Set()
  const re = /href="([^"]+)"/g
  let m
  while ((m = re.exec(html)) !== null) {
    let href = m[1]
    if (href.startsWith('/')) href = `${siteOrigin}${href}`
    if (!href.startsWith(siteOrigin)) continue
    // Drop query strings + fragments before matching
    const clean = href.split('#')[0].split('?')[0]
    if (!/\/products\/[^/]+(?:\/[^/]+)?\.(?:php|html)$/.test(clean)) continue
    if (clean.endsWith('/products/')) continue
    out.add(clean)
  }
  return [...out]
}

/**
 * Extract one row per card found in a product page's `<img>` tags.
 * Returns `{ productLabel, cards: [{id, name, imageUrl, distribution}] }`.
 *
 * Heuristics:
 *   1. Pull the product title from <title> or the breadcrumb (last
 *      breadcrumb item is the product name).
 *   2. Walk every <img ...> tag and check its alt text for a card id.
 *      The alt is the only reliable signal because filename slugs are
 *      bandai-cms hashes (`bccard/.../<hash>/img_item07.webp`).
 *   3. Image URL is the data-src (lazy loader) when present, else src.
 *      Resolve relative URLs against siteOrigin.
 *   4. Distribution string = the product label, prefixed with the
 *      slug so the deduper's normalizer can still bracket-extract a
 *      product code when one exists (e.g. "[EB04]" inside the label
 *      survives slug merging).
 */
function parseCardsFromProduct(html, pageUrl, siteOrigin) {
  const title = decodeHtml(html.match(/<title>([^<]+)<\/title>/)?.[1] ?? '').trim()
  // Pull the product title from the breadcrumb container specifically
  // (not just any <li>, which would also match list-item disclaimers
  // like "※画像はイメージです..."). Falls back to <title>'s first
  // segment, which Bandai formats as "PRODUCT NAME − PRODUCTS | ...".
  let productLabel = ''
  const breadcrumbBlock = html.match(/<ul\s+class="breadcrumbList"[^>]*>([\s\S]*?)<\/ul>/i)
  if (breadcrumbBlock) {
    const items = [...breadcrumbBlock[1].matchAll(/<li[^>]*>(?:<a[^>]*>)?([^<]+)/g)]
      .map((m) => decodeHtml(m[1]).trim())
      .filter((s) => s && !/^home$/i.test(s) && !/^products$/i.test(s) && !/^other$/i.test(s))
    if (items.length) productLabel = items[items.length - 1]
  }
  if (!productLabel) {
    productLabel = title.split(/[|｜]/)[0].replace(/[−–-]\s*PRODUCTS.*$/i, '').trim()
  }

  const cards = []
  const imgRe = /<img\b[^>]*>/gi
  let im
  while ((im = imgRe.exec(html)) !== null) {
    const tag = im[0]
    const altMatch = tag.match(/\salt="([^"]+)"/i)
    if (!altMatch) continue
    const alt = decodeHtml(altMatch[1])
    // Match the FIRST card id in the alt. Reset lastIndex on the
    // shared regex so per-tag iteration restarts cleanly.
    CARD_ID_RE.lastIndex = 0
    const idMatch = CARD_ID_RE.exec(alt)
    if (!idMatch) continue
    // Normalize the numeric portion to match cardlist conventions:
    // OP/ST/EB/PRB use 3-digit zero-padding ("OP14-069"); P-prefixed
    // promos use raw integers ("P-140"). Bandai's product-page alt
    // text occasionally drops the leading zero ("OP14-69") which
    // would otherwise prevent the row from merging with the
    // cardlist's properly-padded "OP14-069".
    const prefix = idMatch[1]
    const numRaw = idMatch[2]
    const variant = idMatch[3] ?? ''
    const num = prefix === 'P' ? numRaw : numRaw.padStart(3, '0')
    const id = `${prefix}-${num}${variant}`

    // Skip if this alt was just a generic product photo, e.g. just
    // mentions the set name without a per-card subject.
    if (/storage box|playmat|sleeve|outer box|商品画像|商品圖像|的商品|set image/i.test(alt) && !/card image|カード画像|卡牌圖像|卡牌图像/i.test(alt)) {
      continue
    }

    let src = tag.match(/\sdata-src="([^"]+)"/i)?.[1] ?? tag.match(/\ssrc="([^"]+)"/i)?.[1]
    if (!src) continue
    if (src.startsWith('//')) src = `https:${src}`
    else if (src.startsWith('/')) src = `${siteOrigin}${src}`
    else if (src.startsWith('../')) {
      // Resolve ../ relative to the product page URL's directory.
      try {
        const u = new URL(src, pageUrl)
        src = u.toString()
      } catch {
        continue
      }
    }
    // Strip cache-busting query.
    src = src.split('?')[0]

    // Recover a card name from the alt by stripping the id and any
    // leading product framing.
    const name = alt
      .replace(/Card image of\s*/i, '')
      .replace(/のカード画像|のカード画像」|的卡牌圖像|的卡牌图像/g, '')
      .replace(/^[『「【]\s*/, '')
      .replace(new RegExp(`.*?${id}\\s*`), '')
      .replace(/[』」】]\s*$/, '')
      .trim()

    cards.push({ id, name, imageUrl: src, alt })
  }
  return { productLabel, cards }
}

async function scrapeRegion(region) {
  console.log(`\n[${region.id}] sweeping product index...`)
  const allLinks = new Set()
  for (const path of PRODUCT_LIST_PATHS) {
    try {
      const html = await fetchHTML(`${region.site}${path}`)
      const links = extractProductLinks(html, region.site)
      links.forEach((u) => allLinks.add(u))
      console.log(`  ${path.padEnd(38)} -> ${links.length} product URLs`)
    } catch (err) {
      console.warn(`  ${path}: FAILED (${err.message})`)
    }
    await sleep(250)
  }
  console.log(`[${region.id}] ${allLinks.size} unique product pages discovered`)

  const cards = []
  const seenIdsByPage = new Map()
  let idx = 0
  for (const pageUrl of allLinks) {
    idx += 1
    try {
      const html = await fetchHTML(pageUrl)
      const { productLabel, cards: pageCards } = parseCardsFromProduct(html, pageUrl, region.site)
      if (pageCards.length === 0) {
        // Only log "no cards" for pages we'd otherwise expect to have
        // them, to keep the operator output readable.
        console.log(`  [${idx}/${allLinks.size}] ${pageUrl.replace(region.site, '')} - 0 cards (marketing-only)`)
      } else {
        console.log(`  [${idx}/${allLinks.size}] ${pageUrl.replace(region.site, '')} - ${pageCards.length} cards`)
      }
      seenIdsByPage.set(pageUrl, pageCards.length)
      for (const c of pageCards) {
        // Synthesize a row matching the per-language cardlist shape.
        // The deduper recognises product-page rows by `source_pack_id`
        // starting with `products:`.
        const slug = pageUrl.split('/').slice(-1)[0].replace(/\.(php|html)$/, '')
        cards.push({
          id: c.id,
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
          // Distribution string: the product label as Bandai presents it.
          // The deduper's normalizer will bracket-extract any product
          // code (e.g. [PRB01], [EB04]) embedded in the label, or fall
          // back to the named-product family (Premium / Anniversary / ...).
          distribution: productLabel || slug,
          img_full_url: c.imageUrl,
          img_path: `cards/${c.id}.png`,
          source_pack_id: `products:${slug}`,
          source_pack_prefix: 'PRODUCT',
          source_pack_label: slug,
          source: 'bandai',
          product_url: pageUrl,
        })
      }
    } catch (err) {
      console.warn(`  [${idx}/${allLinks.size}] ${pageUrl}: FAILED (${err.message})`)
    }
    if (idx % 5 === 0) await sleep(400)
    else await sleep(200)
  }
  return cards
}

function writeRegionFile(region, cards) {
  mkdirSync(BY_LANG_DIR, { recursive: true })
  const out = join(BY_LANG_DIR, `${region.id}-products.json`)
  if (DRY_RUN) {
    console.log(`  --dry-run: would write ${cards.length} rows to ${out}`)
    return
  }
  if (existsSync(out)) copyFileSync(out, out + '.bak')
  writeFileSync(out + '.tmp', JSON.stringify(cards, null, 2))
  renameSync(out + '.tmp', out)
  console.log(`  wrote ${cards.length} rows to ${out}`)
}

async function main() {
  const keys = onlyRegion ? [onlyRegion] : Object.keys(REGIONS)
  for (const key of keys) {
    const region = REGIONS[key]
    if (!region) {
      console.error(`Unknown region: ${key}. Allowed: ${Object.keys(REGIONS).join(', ')}`)
      process.exit(1)
    }
    const cards = await scrapeRegion(region)
    writeRegionFile(region, cards)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
