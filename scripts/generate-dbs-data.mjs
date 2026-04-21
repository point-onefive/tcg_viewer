/**
 * Converts data/dbs-cards-raw.json into src/lib/cards-dbs.json + sets-dbs.json
 * in the app's canonical Card shape.
 *
 * Key behaviours:
 * - Uses canonical set names (hand-mapped from pack code)
 * - Collapses parallel suffixes (_p1, _p2, ...) into variants[] on the base card
 * - Leader-front image used as the primary imageSmall; leader-back stored as variant
 * - R2 image URLs baked in (cards/dbs/{filename}.webp)
 *
 * Usage: node scripts/generate-dbs-data.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'dbs-cards-raw.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-dbs.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-dbs.json')

const R2_PUBLIC = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const R2_PREFIX = 'cards/dbs'

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-dbs-data.mjs first`)
  process.exit(1)
}

// Keep release orders namespaced: OP=1-99, Gundam=100-299, DBS=300-399, Digimon=400+
const SET_META = {
  // Boosters
  FB01: { name: 'Awakened Pulse',         date: '2023-12-15', order: 301 },
  FB02: { name: 'Blazing Aura',           date: '2024-03-15', order: 302 },
  FB03: { name: 'Raging Roar',            date: '2024-06-21', order: 303 },
  FB04: { name: 'Ultra Limit',            date: '2024-09-27', order: 304 },
  FB05: { name: 'New Adventure',          date: '2024-12-13', order: 305 },
  FB06: { name: 'Rivals Clash',           date: '2025-03-14', order: 306 },
  FB07: { name: 'Wish for Shenron',       date: '2025-06-20', order: 307 },
  FB08: { name: "Saiyan's Pride",         date: '2025-09-26', order: 308 },
  FB09: { name: 'Dual Evolution',         date: '2025-12-19', order: 309 },
  // Starter Decks
  FS01: { name: 'Starter Deck Son Goku',  date: '2024-03-15', order: 331 },
  FS02: { name: 'Starter Deck Vegeta',    date: '2024-03-15', order: 332 },
  FS03: { name: 'Starter Deck Broly',     date: '2024-06-21', order: 333 },
  FS04: { name: 'Starter Deck Frieza',    date: '2024-09-27', order: 334 },
  FS05: { name: 'Starter Deck Bardock',   date: '2024-12-13', order: 335 },
  FS06: { name: 'Starter Deck Goku (Mini)', date: '2025-03-14', order: 336 },
  FS07: { name: 'Starter Deck Vegeta (Mini)', date: '2025-03-14', order: 337 },
  FS08: { name: 'Starter Deck Vegeta (Mini) SSJ3', date: '2025-06-20', order: 338 },
  FS09: { name: 'Starter Deck EX Shallot', date: '2025-09-26', order: 339 },
  FS10: { name: 'Starter Deck EX Giblet',  date: '2025-09-26', order: 340 },
  FS11: { name: 'Starter Deck EX The Phase of Evolution', date: '2025-12-19', order: 341 },
  FS12: { name: 'Starter Deck EX The Beat of Ki',         date: '2025-12-19', order: 342 },
  // Manga Boosters
  SB01: { name: 'Manga Booster 01',       date: '2024-10-25', order: 361 },
  SB02: { name: 'Manga Booster 02',       date: '2025-10-24', order: 362 },
}

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
console.log(`Loaded ${raw.length} raw DBS cards`)

function numOrNull(s) {
  if (s == null || s === '' || s === '-') return null
  const n = Number(String(s).replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function splitTraits(s) {
  if (!s) return []
  return s.split(/[\/,]/).map((x) => x.trim()).filter(Boolean)
}

function r2Url(filename) {
  return `${R2_PUBLIC}/${R2_PREFIX}/${filename}`
}

function setCodeFor(cardNo, fallback) {
  const m = cardNo.match(/^([A-Z]{1,3}\d{2})-/)
  if (m) return m[1]
  if (fallback) return fallback
  const m2 = cardNo.match(/^([A-Z]+)-/)
  return m2 ? m2[1] : 'OTHER'
}

function setNameFor(code, packLabel) {
  if (SET_META[code]) return SET_META[code].name
  if (packLabel) {
    return packLabel
      .replace(/\s*\[[^\]]+\]\s*$/, '')
      .replace(/^BOOSTER PACK\s*-?\s*/i, '')
      .replace(/-?$/, '')
      .trim() || code
  }
  return code
}

// Determine which images belong to this record's specific variant.
function imagesForRecord(r) {
  if (!Array.isArray(r.images) || r.images.length === 0) {
    // Fallback guess
    const suffix = r.parallel ? r.parallel : ''
    return [`${r.cardNo}${suffix}.webp`]
  }
  // If parallel, only filenames containing the _pN token belong to this record.
  if (r.parallel) {
    const tok = r.parallel // e.g. "_p1"
    const matching = r.images.filter((f) => f.includes(tok))
    return matching.length ? matching : r.images
  }
  // Non-parallel: filter OUT _p* variants so leaders don't pull their parallels
  return r.images.filter((f) => !/_p\d+\./i.test(f))
}

// Split leader front/back images from a filename list.
function pickFrontBack(images) {
  const front = images.find((f) => /_f(?:_p\d+)?\.webp$/i.test(f)) || null
  const back = images.find((f) => /_b(?:_p\d+)?\.webp$/i.test(f)) || null
  const plain = images.find((f) => !/_(f|b)(?:_p\d+)?\.webp$/i.test(f)) || null
  return { front, back, plain }
}

function primaryImage(r) {
  const imgs = imagesForRecord(r)
  const { front, plain } = pickFrontBack(imgs)
  return front || plain || imgs[0] || null
}

// ---------- collapse parallels -----------------
// Group by base cardNo. Parent = non-parallel record, children = _pN records.
const groups = new Map()
for (const r of raw) {
  const base = r.cardNo
  if (!groups.has(base)) groups.set(base, { base: null, parallels: [] })
  const g = groups.get(base)
  if (r.parallel) g.parallels.push(r)
  else g.base = r
}

const cards = []
for (const [baseId, { base, parallels }] of groups) {
  const p = base || parallels[0]
  if (!p) continue

  const setCode = setCodeFor(baseId, p.setCode || p.sourcePackCode)
  const setMeta = SET_META[setCode]
  const primary = primaryImage(p)

  const variants = []
  // Leader back face as a variant so we can flip between sides
  if (!p.parallel) {
    const imgs = imagesForRecord(p)
    const { back } = pickFrontBack(imgs)
    if (back) variants.push({ id: `${baseId}_b`, label: 'Back', imageUrl: r2Url(back) })
  }
  // Each parallel adds one variant (front image, plus back if leader)
  for (const pr of parallels) {
    const prImgs = imagesForRecord(pr)
    const { front, back, plain } = pickFrontBack(prImgs)
    const label = /^_p\d+$/i.test(pr.parallel || '') ? `Parallel ${pr.parallel.replace(/^_/, '').toUpperCase()}` : 'Variant'
    const primaryP = front || plain || prImgs[0]
    if (primaryP) variants.push({ id: pr.id, label, imageUrl: r2Url(primaryP) })
    if (back && front) variants.push({ id: `${pr.id}_b`, label: `${label} Back`, imageUrl: r2Url(back) })
  }

  cards.push({
    id: baseId,
    code: baseId,
    name: p.name || baseId,
    setCode,
    setName: setNameFor(setCode, p.sourcePackLabel),
    releaseDate: setMeta?.date,
    releaseOrder: setMeta?.order ?? 999,
    cardType: p.cardType || undefined,
    rarity: p.rarity || undefined,
    colors: p.color ? [p.color] : [],
    cost: numOrNull(p.cost),
    power: numOrNull(p.powerFront),
    counter: numOrNull(p.comboPower),
    attributes: p.specifiedCost ? p.specifiedCost.split('/').filter(Boolean) : [],
    types: splitTraits(p.traitsFront),
    effect: p.effect || undefined,
    trigger: undefined,
    imageSmall: primary ? r2Url(primary) : '',
    imageLarge: primary ? r2Url(primary) : '',
    variants: variants.length ? variants : undefined,
  })
}

cards.sort((a, b) => {
  if (a.releaseOrder !== b.releaseOrder) return a.releaseOrder - b.releaseOrder
  return a.id.localeCompare(b.id)
})

const setsMap = new Map()
for (const c of cards) {
  if (!setsMap.has(c.setCode)) {
    setsMap.set(c.setCode, {
      setCode: c.setCode,
      setName: c.setName,
      releaseDate: c.releaseDate,
      releaseOrder: c.releaseOrder ?? 999,
      cardCount: 0,
    })
  }
  setsMap.get(c.setCode).cardCount += 1
}
const sets = Array.from(setsMap.values()).sort((a, b) => a.releaseOrder - b.releaseOrder)

writeFileSync(OUT_CARDS, JSON.stringify(cards, null, 2))
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))

console.log(`\nWrote ${cards.length} DBS cards across ${sets.length} sets`)
console.log(`  ${OUT_CARDS}`)
console.log(`  ${OUT_SETS}`)
