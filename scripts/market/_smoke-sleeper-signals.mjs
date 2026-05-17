/**
 * Pure data smoke test: read the pc-urls.json + run the PC ingester
 * in-process and surface the most interesting items based on pop counts
 * alone. Demonstrates exactly what the bot will say tonight, no DB needed.
 *
 *   node scripts/market/_smoke-sleeper-signals.mjs
 */

import * as cheerio from 'cheerio'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

const cards = JSON.parse(readFileSync(resolve(ROOT, 'src/lib/cards-one-piece.json'), 'utf-8'))
const cardByCode = new Map()
for (const c of cards) cardByCode.set((c.code || c.id || '').toUpperCase(), c)

// Use the URL map we already cached.
const urls = JSON.parse(readFileSync(resolve(__dirname, 'data/pc-urls.json'), 'utf-8'))
console.log(`loaded ${Object.keys(urls).length} cards from pc-urls.json`)

// Re-scrape the OP main-booster sets quickly and capture pop. (This is just
// a quick view; the real ingester writes to DB.)
const SETS = [
  'one-piece-romance-dawn',
  'one-piece-paramount-war',
  'one-piece-pillars-of-strength',
  'one-piece-kingdoms-of-intrigue',
  'one-piece-awakening-of-the-new-era',
  'one-piece-wings-of-the-captain',
  'one-piece-500-years-in-the-future',
  'one-piece-two-legends',
  'one-piece-emperors-in-the-new-world',
  'one-piece-royal-blood',
  'one-piece-fist-of-divine-speed',
  'one-piece-legacy-of-the-master',
  'one-piece-carrying-on-his-will',
  'one-piece-extra-booster-memorial-collection',
  'one-piece-premium-booster',
  'one-piece-premium-booster-2',
  'one-piece-promo',
]

const rows = []

for (const slug of SETS) {
  const r = await fetch(`https://www.pricecharting.com/pop/set/${slug}`, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  })
  const html = await r.text()
  const $ = cheerio.load(html)
  $('tr[data-product]').each((_, tr) => {
    const $tr = $(tr)
    let name = ''
    $tr.find('a[href*="/pop/item/"]').each((_, a) => {
      const t = $(a).text().trim()
      if (t && !name) name = t
    })
    if (!name) return
    const codeMatch = name.match(/\b(?:OP|EB|ST|PRB)\d{2}-\d{3}\b/) || name.match(/\bP-\d{3}\b/)
    if (!codeMatch) return
    const cells = []
    $tr.find('td.pop-value').each((_, td) => {
      const txt = $(td).text().trim()
      if (txt === '-' || txt === '') { cells.push(null); return }
      const n = parseInt(txt.replace(/[,\s]/g, ''), 10)
      cells.push(Number.isFinite(n) ? n : null)
    })
    if (cells.length < 6) return
    rows.push({
      pc_set: slug,
      name,
      code: codeMatch[0],
      grade_6: cells[0], grade_7: cells[1], grade_8: cells[2],
      grade_9: cells[3], grade_10: cells[4], grade_total: cells[5],
      variants: (name.match(/\[([^\]]+)\]/g) || []).map((s) => s.slice(1, -1)),
    })
  })
  await new Promise((r) => setTimeout(r, 600))
}

console.log(`\nscraped ${rows.length} card rows across ${SETS.length} sets`)

// Heuristic: a sleeper is a card that has been graded at least once
// (so it's on the radar) but has a very small Grade 10 pop. We weight
// down Wanted/Foil/base variants because those tend to be common bases.
const FLAGSHIP_VARIANTS = new Set([
  'Manga', 'Red Manga', 'Alternate Art', 'Alternate Art Manga',
  'SP', 'SP Gold', 'SP Silver', 'Secret Rare',
])

function isFlagshipPrint(r) {
  if (r.variants.length === 0) return false
  return r.variants.some((v) => FLAGSHIP_VARIANTS.has(v) || /Anniversary|Champion|Super Pre-Release|Bandai Fest/.test(v))
}

const sleeperCandidates = rows
  .filter((r) => r.grade_total != null && r.grade_total >= 1 && r.grade_total <= 6)
  .filter(isFlagshipPrint)
  .sort((a, b) => (a.grade_total ?? 999) - (b.grade_total ?? 999))

const wellSupplied = rows
  .filter((r) => r.grade_10 != null && r.grade_10 >= 100)
  .sort((a, b) => (b.grade_10 ?? 0) - (a.grade_10 ?? 0))

const mangaUniverse = rows
  .filter((r) => r.variants.some((v) => /Manga/.test(v)))
  .sort((a, b) => (a.grade_10 ?? 999) - (b.grade_10 ?? 999))

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  SLEEPER CANDIDATES  (flagship variants, total graded ≤ 6)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
for (const r of sleeperCandidates.slice(0, 25)) {
  const c = cardByCode.get(r.code.toUpperCase())
  const rarity = c?.rarity ?? '?'
  console.log(
    `  total=${String(r.grade_total).padStart(2)}  10=${String(r.grade_10 ?? '-').padStart(2)}  ` +
    `${rarity.padEnd(4)} ${r.code.padEnd(9)} ${r.name.slice(0, 80)}`
  )
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  THE MANGA UNIVERSE  (every Manga variant we tracked)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
for (const r of mangaUniverse.slice(0, 25)) {
  const c = cardByCode.get(r.code.toUpperCase())
  const rarity = c?.rarity ?? '?'
  console.log(
    `  total=${String(r.grade_total ?? '-').padStart(3)}  10=${String(r.grade_10 ?? '-').padStart(3)}  ` +
    `${rarity.padEnd(4)} ${r.code.padEnd(9)} ${r.name.slice(0, 80)}`
  )
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  WELL-SUPPLIED  (Grade 10 pop ≥ 100, probably no breakout)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
for (const r of wellSupplied.slice(0, 10)) {
  const c = cardByCode.get(r.code.toUpperCase())
  const rarity = c?.rarity ?? '?'
  console.log(
    `  10=${String(r.grade_10).padStart(4)}  total=${String(r.grade_total).padStart(4)}  ` +
    `${rarity.padEnd(4)} ${r.code.padEnd(9)} ${r.name.slice(0, 80)}`
  )
}
