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

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')

const SITE = 'https://en.onepiece-cardgame.com'
const LIST_URL = `${SITE}/cardlist/`
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&#8217;/g, '\u2019')
    .replace(/&lsquo;|&#8216;/g, '\u2018')
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

function parseCardBlock(block, pack) {
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
  let imgPath = imgMatch ? imgMatch[1] : null
  if (imgPath && imgPath.startsWith('../')) imgPath = imgPath.replace(/^\.\.\//, '/')
  const imgFullUrl = imgPath ? `${SITE}${imgPath.split('?')[0]}` : null

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
    img_full_url: imgFullUrl,
    img_path: `cards/${id}.png`,
    source_pack_id: pack.id,
    source_pack_prefix: pack.title_parts?.prefix ?? null,
    source_pack_label: pack.title_parts?.label ?? null,
  }
}

function parseAllCards(html, pack) {
  const cards = []
  const re = /<dl\s+class="modalCol"[\s\S]*?<\/dl>/g
  let m
  while ((m = re.exec(html)) !== null) {
    const card = parseCardBlock(m[0], pack)
    if (card) cards.push(card)
  }
  return cards
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  console.log('Fetching pack list from Bandai...')
  const landingHtml = await fetchHTML(LIST_URL)
  const packs = parseSeriesOptions(landingHtml)
  console.log(`Found ${packs.length} series.`)

  writeFileSync(join(DATA_DIR, 'packs.json'), JSON.stringify(packs, null, 2))

  const allCards = []
  const seen = new Set()
  const failed = []

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]
    const tag = pack.title_parts.label ?? pack.title_parts.title ?? pack.id
    process.stdout.write(`[${i + 1}/${packs.length}] ${tag} (${pack.id})... `)
    try {
      const html = await fetchHTML(LIST_URL, `series=${pack.id}`)
      const cards = parseAllCards(html, pack)
      let added = 0
      for (const c of cards) {
        if (seen.has(c.id)) continue
        seen.add(c.id)
        allCards.push(c)
        added++
      }
      console.log(`${cards.length} cards (${added} new)`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed.push(pack)
    }
    if (i < packs.length - 1) await sleep(300)
  }

  writeFileSync(join(DATA_DIR, 'cards.json'), JSON.stringify(allCards, null, 2))
  console.log(`\nDone. ${allCards.length} unique cards written to data/cards.json`)

  if (failed.length > 0) {
    console.warn(`\nFailed packs (${failed.length}):`)
    failed.forEach((p) => console.warn(`  - ${p.title_parts.label ?? p.id}`))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
