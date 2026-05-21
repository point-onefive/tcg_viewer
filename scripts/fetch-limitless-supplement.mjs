/**
 * Supplemental fetch for One Piece TCG cards that exist in the wild
 * but are missing from Bandai's official cardlist database.
 *
 * Why this exists: Bandai's /cardlist/ catalogs every booster and
 * starter deck plus the JP 550801 "limited products" bucket, but
 * silently omits a long tail of retail-bundle promos (Illustration
 * Box, Premium Card Collection, championship celebration packs,
 * etc.). The Bandai-only pipeline therefore misses cards like
 * OP05-062 Illustration Box Vol.1 (Peach Momoko art) -- visible on
 * Limitless TCG, TCGplayer, Cardmarket, but invisible to us.
 *
 * Limitless TCG is the de-facto community catalog. It aggregates
 * everything Bandai publishes AND every promo that ships through
 * retail bundles / tournaments / magazine inserts that Bandai
 * forgot to add. We treat it as a supplement, not a replacement:
 * Bandai stays authoritative for everything it covers; Limitless
 * fills the gaps.
 *
 * Output: data/limitless/inventory.json -- one entry per (card_id,
 *   variant) pair seen on Limitless, with the source category and
 *   the CDN image URL. The merge step (apply-limitless-supplement
 *   below) diffs this against data/cards.json and emits a delta.
 *
 * Usage:
 *   node scripts/fetch-limitless-supplement.mjs --crawl   # categories + card urls
 *   node scripts/fetch-limitless-supplement.mjs --details # full metadata per card
 *   node scripts/fetch-limitless-supplement.mjs --all     # both phases
 *
 * Politeness: 200ms between requests, single-threaded. With ~5k
 * card pages a full crawl is ~17 minutes. The script writes after
 * every category so an interrupted run resumes from disk on the
 * next invocation.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const STAGE_DIR = join(ROOT, 'data', 'limitless')
const CATEGORIES_PATH = join(STAGE_DIR, 'categories.json')
const CARD_URLS_PATH = join(STAGE_DIR, 'card-urls.json')
const INVENTORY_PATH = join(STAGE_DIR, 'inventory.json')

const SITE = 'https://onepiece.limitlesstcg.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const THROTTLE_MS = 200

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHTML(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await sleep(THROTTLE_MS)
    return res.text()
  } catch (e) {
    if (attempt >= 3) throw new Error(`${url}: ${e.message}`)
    await sleep(1000 * (attempt + 1))
    return fetchHTML(url, attempt + 1)
  }
}

/**
 * Phase 1a: discover every category page (booster sets + promos).
 *
 * Sources:
 *   - /cards         : 21 booster sets + EB + PRB
 *   - /cards/promos  : every promo subcategory (Illustration Box,
 *                       Championship packs, magazine promos, etc.)
 *
 * Each category has the form /cards/<slug>; we keep the slug as
 * the category id so downstream code can attribute provenance
 * ("from cards/premium-card-collection-best-selection-01").
 */
async function discoverCategories() {
  const categories = []
  const seen = new Set()

  for (const indexPath of ['/cards', '/cards/promos']) {
    const html = await fetchHTML(`${SITE}${indexPath}`)
    if (!html) continue
    const links = html.matchAll(/href="\/cards\/([a-z0-9][a-z0-9-]*)"/g)
    for (const m of links) {
      const slug = m[1]
      // Skip meta routes (advanced search, the promos index itself,
      // language toggles, etc.). Anything that links to a real
      // category page works.
      if (slug === 'advanced' || slug === 'promos') continue
      if (seen.has(slug)) continue
      seen.add(slug)
      categories.push(slug)
    }
  }
  return categories
}

/**
 * Phase 1b: for every category page, extract every card link.
 *
 * Card links on category pages look like /cards/OP05-001 (base) or
 * /cards/OP05-001?v=2 (alt art print). We keep BOTH the cardId
 * and the variant index (0 = base, 1+ = alt) so we can build a
 * stable variant id later.
 *
 * Some categories include cards from other sets (e.g. the OP05
 * page mentions "OP01-016?v=4" because that pack reprinted it as
 * a parallel art). We attribute each (cardId, variant) to the
 * FIRST category that contained it -- arbitrary but reproducible.
 */
async function crawlCardUrls(categories) {
  const inventory = existsSync(CARD_URLS_PATH)
    ? JSON.parse(readFileSync(CARD_URLS_PATH, 'utf8'))
    : { byCardVariant: {}, byCategory: {} }

  for (const slug of categories) {
    if (inventory.byCategory[slug]) {
      console.log(`  ${slug}: cached (${inventory.byCategory[slug].length} cards)`)
      continue
    }
    const html = await fetchHTML(`${SITE}/cards/${slug}`)
    if (!html) {
      inventory.byCategory[slug] = []
      continue
    }
    const links = new Set()
    for (const m of html.matchAll(/href="\/cards\/([A-Z]+\d+-\d+)(\?v=(\d+))?"/g)) {
      const cardId = m[1]
      const variant = m[3] ? Number(m[3]) : 0
      const key = `${cardId}|${variant}`
      links.add(key)
      if (!inventory.byCardVariant[key]) {
        inventory.byCardVariant[key] = { cardId, variant, firstSeenIn: slug }
      }
    }
    inventory.byCategory[slug] = Array.from(links)
    console.log(`  ${slug}: ${links.size} card refs`)
    writeFileSync(CARD_URLS_PATH, JSON.stringify(inventory, null, 2))
  }
  return inventory
}

/**
 * Parse a single Limitless card-detail page into our normalised
 * shape. We extract enough to either (a) attach as a new variant
 * to an existing card or (b) instantiate a brand-new base card.
 *
 * Fields:
 *   - cardId     : e.g. "OP05-062"
 *   - variant    : 0 for the base print, 1+ for alt prints
 *   - name       : English name as printed
 *   - cardType   : Character / Leader / Event / Stage
 *   - colors     : array, multi-color cards split by "/"
 *   - cost       : integer or null (Leaders have no cost)
 *   - power      : integer or null
 *   - counter    : integer or null
 *   - life       : integer or null (Leaders only)
 *   - attribute  : string (Special / Strike / Ranged / etc.)
 *   - types      : array of subtype tags (Straw Hat Crew, etc.)
 *   - effect     : rules text, <br> -> newline
 *   - trigger    : rules text under [Trigger], or null
 *   - rarity     : C / UC / R / SR / SEC / L (where exposed)
 *   - category   : "Misc. Promos", "Awakening of the New Era", ...
 *   - subtitle   : e.g. "Illustration Box Vol.1" or "Alternate Art"
 *   - artist     : artist name as printed
 *   - imageUrl   : absolute Limitless CDN URL of the print
 */
function parseCardPage(html, cardId, variant) {
  const out = { cardId, variant }

  // Image - always under <div class="card-image"><img src="...">
  const img = html.match(/<div\s+class="card-image">\s*<img[^>]+src="([^"]+)"/i)
  out.imageUrl = img?.[1] ?? null

  // Name
  const name = html.match(/class="card-text-name"[^>]*>\s*<a[^>]*>\s*([^<]+?)\s*<\/a>/i)
  out.name = name?.[1] ? decodeHtml(name[1]).trim() : null

  // Type/color/cost row: "<span>Category</span> • <span>Color</span> • N Cost"
  const typeRow = html.match(/class="card-text-type"[\s\S]*?<\/p>/i)?.[0] ?? ''
  out.cardType = (typeRow.match(/data-tooltip="Category"[^>]*>([^<]+)/i)?.[1] ?? '').trim()
  const colorRaw = (typeRow.match(/data-tooltip="Color"[^>]*>([^<]+)/i)?.[1] ?? '').trim()
  out.colors = colorRaw ? colorRaw.split('/').map((s) => s.trim()).filter(Boolean) : []
  const cost = typeRow.match(/(\d+)\s*Cost/i)
  out.cost = cost ? Number(cost[1]) : null
  const life = typeRow.match(/(\d+)\s*Life/i)
  out.life = life ? Number(life[1]) : null

  // Power / Attribute / Counter row
  const powerRow = (html.match(/<p\s+class="card-text-section">[\s\S]*?Power[\s\S]*?<\/p>/i)?.[0]) ?? ''
  const power = powerRow.match(/(\d+)\s*Power/i)
  out.power = power ? Number(power[1]) : null
  out.attribute = (powerRow.match(/data-tooltip="Attribute"[^>]*>([^<]+)/i)?.[1] ?? '').trim() || null
  const counter = powerRow.match(/\+?(\d+)\s*Counter/i)
  out.counter = counter ? Number(counter[1]) : null

  // Effect / trigger - inside <div class="card-text-section">...</div>
  // Sections come in order: title, power, EFFECT, types. We grab the
  // effect by looking for any section that doesn't contain Power and
  // appears after the power row.
  const sections = [...html.matchAll(/<div\s+class="card-text-section">([\s\S]*?)<\/div>/g)]
    .map((m) => m[1])
  let effect = null
  for (const s of sections) {
    if (/Power\b/.test(s) || /data-tooltip="Type"/.test(s)) continue
    // Strip nested tags except <br>
    const cleaned = s
      .replace(/<span\s+class="reminder-text">/gi, '')
      .replace(/<\/span>/gi, '')
      .replace(/<br\s*\/?\s*>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .trim()
    if (cleaned) { effect = decodeHtml(cleaned); break }
  }
  out.effect = effect

  // Trigger: Bandai uses "[Trigger]" prefix; reuse it as a sentinel
  if (out.effect && /\[Trigger\]/.test(out.effect)) {
    const [pre, post] = out.effect.split(/\[Trigger\]/)
    out.effect = pre.trim() || null
    out.trigger = post.trim() || null
  } else {
    out.trigger = null
  }

  // Subtypes ("Straw Hat Crew", "Wano Country", etc.)
  const typeSection = sections.find((s) => /data-tooltip="Type"/.test(s)) ?? ''
  const subs = [...typeSection.matchAll(/data-tooltip="Type"[^>]*>([^<]+)/g)].map((m) =>
    decodeHtml(m[1]).trim(),
  )
  out.types = subs

  // Artist
  const artist = html.match(/card-text-artist[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/i)
  out.artist = artist?.[1] ? decodeHtml(artist[1].replace(/<[^>]+>/g, '')).trim() : null

  // Source category - the "current print" pill at top of the prints panel
  const cat = html.match(/card-prints-current">[\s\S]*?<span\s+class="text-lg">\s*([\s\S]*?)\s*<\/span>[\s\S]*?<span>\s*([\s\S]*?)\s*<\/span>/i)
  out.category = cat?.[1] ? decodeHtml(cat[1].replace(/<[^>]+>/g, '')).trim() : null
  out.subtitle = cat?.[2] ? decodeHtml(cat[2].replace(/<[^>]+>/g, '')).trim() : null

  // Notes line (e.g. "Illustration Box Vol.1") sits below the pill
  const notes = html.match(/card-prints-notes">\s*([\s\S]*?)\s*<\/div>/i)
  if (notes?.[1]) {
    const n = decodeHtml(notes[1].replace(/<[^>]+>/g, '')).trim()
    if (n) out.notes = n
  }

  // Rarity - in the prints table the current print's row has a card
  // number marker; rarity is not directly exposed on every page, but
  // we can pull it from the title attribute on the prints row if
  // present. (Best-effort; downstream code defaults to "P" for promo
  // when missing.)
  const rarity = html.match(/Rarity[^<]*<\/[^>]+>\s*<[^>]+>\s*([A-Z]+)/)
  out.rarity = rarity?.[1] ?? null

  return out
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

async function fetchDetails(cardUrls) {
  const inventory = existsSync(INVENTORY_PATH)
    ? JSON.parse(readFileSync(INVENTORY_PATH, 'utf8'))
    : {}

  const entries = Object.values(cardUrls.byCardVariant)
  console.log(`  Total card refs: ${entries.length}`)
  let i = 0
  let saveEvery = 100
  for (const e of entries) {
    i++
    const key = `${e.cardId}|${e.variant}`
    if (inventory[key]) continue

    const url = e.variant === 0
      ? `${SITE}/cards/${e.cardId}`
      : `${SITE}/cards/${e.cardId}?v=${e.variant}`
    try {
      const html = await fetchHTML(url)
      if (!html) {
        inventory[key] = { cardId: e.cardId, variant: e.variant, missing: true, firstSeenIn: e.firstSeenIn }
        continue
      }
      const parsed = parseCardPage(html, e.cardId, e.variant)
      parsed.firstSeenIn = e.firstSeenIn
      inventory[key] = parsed
    } catch (err) {
      inventory[key] = { cardId: e.cardId, variant: e.variant, error: err.message, firstSeenIn: e.firstSeenIn }
    }

    if (i % saveEvery === 0) {
      writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2))
      console.log(`  [${i}/${entries.length}] saved (last: ${key})`)
    }
  }
  writeFileSync(INVENTORY_PATH, JSON.stringify(inventory, null, 2))
  console.log(`  Done. ${Object.keys(inventory).length} entries.`)
  return inventory
}

async function main() {
  if (!existsSync(STAGE_DIR)) mkdirSync(STAGE_DIR, { recursive: true })

  const args = new Set(process.argv.slice(2))
  const doCrawl = args.has('--crawl') || args.has('--all')
  const doDetails = args.has('--details') || args.has('--all')

  if (!doCrawl && !doDetails) {
    console.error('usage: node scripts/fetch-limitless-supplement.mjs [--crawl] [--details] [--all]')
    process.exit(1)
  }

  if (doCrawl) {
    console.log('=== Phase 1: discover categories ===')
    let categories
    if (existsSync(CATEGORIES_PATH)) {
      categories = JSON.parse(readFileSync(CATEGORIES_PATH, 'utf8'))
      console.log(`  cached: ${categories.length} categories`)
    } else {
      categories = await discoverCategories()
      writeFileSync(CATEGORIES_PATH, JSON.stringify(categories, null, 2))
      console.log(`  discovered: ${categories.length} categories`)
    }

    console.log('=== Phase 2: crawl card urls per category ===')
    const urls = await crawlCardUrls(categories)
    const totalRefs = Object.keys(urls.byCardVariant).length
    console.log(`  total unique (card, variant) refs: ${totalRefs}`)
  }

  if (doDetails) {
    console.log('=== Phase 3: fetch card-detail pages ===')
    if (!existsSync(CARD_URLS_PATH)) {
      console.error('Run --crawl first to build card-urls.json')
      process.exit(1)
    }
    const urls = JSON.parse(readFileSync(CARD_URLS_PATH, 'utf8'))
    await fetchDetails(urls)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
