/**
 * Scrapes Digimon Card Game cards from the official Bandai site.
 * Source: https://world.digimoncard.com/cardlist/
 *
 * Strategy:
 *   1. GET the cardlist root; extract pack options from the first <select name="category">.
 *   2. For each category: GET /cards/?search=true&category={N}. Response contains
 *      all cards for that pack with full metadata embedded in the listing HTML -
 *      no separate detail page to fetch.
 *   3. Per-pack release dates come from /products/pack/{slug}/ (linked in each
 *      card's Notes). Fetch once per pack and cache.
 *
 * Output: data/digimon-cards-raw.json
 *
 * Usage: node scripts/fetch-digimon-data.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const OUT = join(DATA_DIR, 'digimon-cards-raw.json')

const BASE = 'https://world.digimoncard.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url, init = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...init.headers }, ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

function cleanText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function fetchPackList() {
  const html = await fetchText(`${BASE}/cardlist/`)
  const sel = html.match(/<select[^>]*name="category"[^>]*>([\s\S]*?)<\/select>/)
  if (!sel) throw new Error('category <select> not found')
  const opts = []
  const re = /<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g
  let m
  while ((m = re.exec(sel[1]))) {
    const numericId = m[1]
    if (numericId === '0' || numericId === '') continue
    const label = m[2].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
    const codeMatch = label.match(/\[([^\]]+)\]\s*$/)
    const code = codeMatch ? codeMatch[1].replace(/-/g, '') : null
    opts.push({ numericId, code, label, rawLabel: label })
  }
  return opts
}

async function fetchPackHtml(numericId) {
  return fetchText(`${BASE}/cards/?search=true&category=${numericId}`)
}

function extractCardBlocks(html) {
  // <div class="popupCol" id="ID"> ... </div></li>
  const re = /<div class="popupCol" id="([^"]+)">([\s\S]*?)<\/div>\s*<\/li>/g
  const out = []
  let m
  while ((m = re.exec(html))) out.push({ id: m[1], body: m[2] })
  return out
}

function extractInfoRow(body, label) {
  const re = new RegExp(
    `<dt class="cardInfoTit">\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`,
    'i'
  )
  const m = body.match(re)
  return m ? m[1] : null
}

function extractSmallRow(body, label) {
  const re = new RegExp(
    `<dt class="cardInfoTitSmall">\\s*\\[${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\]\\s*</dt>\\s*<dd[^>]*>([\\s\\S]*?)</dd>`,
    'i'
  )
  const m = body.match(re)
  return m ? cleanText(m[1]) : ''
}

function parseColors(dd) {
  if (!dd) return []
  const out = []
  const re = /cardColor_([a-z]+)"[^>]*>([A-Za-z]+)</g
  let m
  while ((m = re.exec(dd))) out.push(m[2])
  return out
}

function parseCard(rawId, body) {
  // Main <ul> class="cardli_..." tiny rows
  const cardNo = (body.match(/<li class="cardNo">\s*([^<]+?)\s*<\/li>/i) || [])[1]?.trim() || rawId
  const rarity = (body.match(/<li class="cardRarity">\s*([^<]+?)\s*<\/li>/i) || [])[1]?.trim() || ''
  const cardType = (body.match(/<li class="cardType">\s*([^<]+?)\s*<\/li>/i) || [])[1]?.trim() || ''
  const lvMatch = body.match(/<li class="cardLv">\s*Lv\.?\s*(\d+)\s*<\/li>/i)
  const level = lvMatch ? lvMatch[1] : null
  const name = cleanText((body.match(/<div class="cardTitle">\s*([^<]+?)\s*<\/div>/i) || [])[1] || '')

  const colorDd = extractInfoRow(body, 'Color')
  const colors = parseColors(colorDd)

  const cost = cleanText(extractInfoRow(body, 'Cost') || '') || null
  const dp = cleanText(extractInfoRow(body, 'DP') || '') || null
  const form = cleanText(extractInfoRow(body, 'Form') || '') || null
  const attribute = cleanText(extractInfoRow(body, 'Attribute') || '') || null
  const typeRow = cleanText(extractInfoRow(body, 'Type') || '') || null

  const digiCost1 = cleanText(extractInfoRow(body, 'Digivolve Cost 1') || '') || null
  const digiCost2 = cleanText(extractInfoRow(body, 'Digivolve Cost 2') || '') || null
  const digivolveCosts = [digiCost1, digiCost2].filter(Boolean)

  const effect = extractSmallRow(body, 'Effect')
  const inherited = extractSmallRow(body, 'Inherited Effect')
  const security = extractSmallRow(body, 'Security Effect')
  const specialCond = extractSmallRow(body, 'Special Digivolution Condition')
  const playCond = extractSmallRow(body, 'Special Play Condition')
  const linkCond = extractSmallRow(body, 'Link Condition')
  const linkDp = extractSmallRow(body, 'Link DP')
  const linkEffect = extractSmallRow(body, 'Link Effect')

  const notesRaw = extractInfoRow(body, 'Notes') || ''
  const productSlug = (notesRaw.match(/href="\/products\/pack\/([^"\/?#]+)/) || [])[1] || null
  const notes = cleanText(notesRaw.replace(/<ul[\s\S]*$/, ''))
  const setCodeMatch = notes.match(/\[([^\]]+)\]\s*$/)
  const setCode = setCodeMatch ? setCodeMatch[1].replace(/-/g, '') : null

  return {
    id: rawId,
    cardNo,
    name,
    rarity,
    cardType,
    level,
    colors,
    cost,
    dp,
    form,
    attribute,
    typeRow,
    digivolveCosts,
    effect,
    inheritedEffect: inherited,
    securityEffect: security,
    specialDigivolutionCondition: specialCond,
    specialPlayCondition: playCond,
    linkCondition: linkCond,
    linkDp,
    linkEffect,
    notes,
    setCode,
    productSlug,
  }
}

async function fetchReleaseDate(slug) {
  try {
    const html = await fetchText(`${BASE}/products/pack/${slug}/`)
    const m = html.match(/<dt>\s*Release date\s*<\/dt>\s*<dd>([^<]+)<\/dd>/i)
    if (!m) return null
    const raw = m[1].trim()
    // e.g. "August 29, 2025"
    const d = new Date(raw + ' UTC')
    if (Number.isNaN(d.getTime())) return raw
    return d.toISOString().slice(0, 10)
  } catch {
    return null
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  let existing = []
  if (existsSync(OUT)) {
    try {
      existing = JSON.parse(readFileSync(OUT, 'utf8'))
      console.log(`Resuming: ${existing.length} cards already fetched`)
    } catch {
      existing = []
    }
  }
  const already = new Set(existing.map((c) => c.id))

  console.log('Fetching pack list...')
  const packs = await fetchPackList()
  console.log(`Found ${packs.length} packs`)

  const records = [...existing]
  const packDates = {} // productSlug -> date
  let newCards = 0
  let failed = 0

  for (let i = 0; i < packs.length; i++) {
    const p = packs[i]
    process.stdout.write(`[${i + 1}/${packs.length}] ${p.label} ... `)
    try {
      const html = await fetchPackHtml(p.numericId)
      const blocks = extractCardBlocks(html)
      let added = 0
      let packSlug = null
      for (const { id, body } of blocks) {
        if (already.has(id)) continue
        const parsed = parseCard(id, body)
        parsed.sourcePackLabel = p.rawLabel
        parsed.sourcePackCode = p.code
        if (parsed.productSlug && !packSlug) packSlug = parsed.productSlug
        records.push(parsed)
        already.add(id)
        added++
        newCards++
      }
      // Resolve pack release date once
      if (packSlug && !packDates[packSlug]) {
        packDates[packSlug] = await fetchReleaseDate(packSlug)
      }
      console.log(`${blocks.length} tiles, +${added} new`)
      if (newCards && newCards % 100 === 0) {
        writeFileSync(OUT, JSON.stringify(records, null, 2))
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed++
    }
    await sleep(200)
  }

  // Stamp release dates onto every record
  for (const r of records) {
    if (r.productSlug && packDates[r.productSlug]) {
      r.releaseDate = packDates[r.productSlug]
    }
  }

  writeFileSync(OUT, JSON.stringify(records, null, 2))
  writeFileSync(join(DATA_DIR, 'digimon-pack-dates.json'), JSON.stringify(packDates, null, 2))
  console.log(`\nDone. ${records.length} cards -> ${OUT} (${failed} pack failures)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
