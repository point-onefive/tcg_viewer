/**
 * Converts data/gundam-cards-raw.json into src/lib/cards-gundam.json
 * in the app's canonical Card shape.
 *
 * Key behaviours:
 * - Uses canonical set names (hand-mapped from pack code prefix)
 * - Collapses variant suffixes (_p1, _p2, _r1) into a base card with variants[]
 * - Maps Gundam-specific stats (Lv/COST/AP/HP/Link) onto Card fields when reasonable
 * - Bakes R2 image URLs (cards/gundam/{id}.webp)
 *
 * Usage: node scripts/generate-gundam-data.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'gundam-cards-raw.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-gundam.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-gundam.json')

const R2_PUBLIC = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const R2_PREFIX = 'cards/gundam'

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-gundam-data.mjs first`)
  process.exit(1)
}

const SET_META = {
  // Starter Decks
  ST01: { name: 'Heroic Beginnings',       date: '2025-01-24', order: 101 },
  ST02: { name: 'Wings of Advance',        date: '2025-01-24', order: 102 },
  ST03: { name: "Zeon's Rush",             date: '2025-04-25', order: 103 },
  ST04: { name: 'SEED Strike',             date: '2025-04-25', order: 104 },
  ST05: { name: 'Iron Bloom',              date: '2025-07-25', order: 105 },
  ST06: { name: 'Clan Unity',              date: '2025-07-25', order: 106 },
  ST07: { name: 'Celestial Drive',         date: '2025-10-24', order: 107 },
  ST08: { name: 'Flash of Radiance',       date: '2025-10-24', order: 108 },
  ST09: { name: 'Destiny Ignition',        date: '2026-01-30', order: 109 },
  // Booster Packs
  GD01: { name: 'Newtype Rising',          date: '2025-01-24', order: 201 },
  GD02: { name: 'Dual Impact',             date: '2025-04-25', order: 202 },
  GD03: { name: 'Steel Requiem',           date: '2025-07-25', order: 203 },
  GD04: { name: 'Phantom Aria',            date: '2025-10-24', order: 204 },
  // Buckets
  EB01: { name: 'Edition Beta',            date: '2024-10-01', order: 301 },
  // Promo/Other prefixes (set code inferred from pack label below if needed)
}

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
console.log(`Loaded ${raw.length} raw Gundam cards`)

/**
 * Parse variant suffix from Bandai card id.
 *   GD01-001_p1 -> { base: 'GD01-001', suffix: 'p1' }
 *   GD01-001    -> { base: 'GD01-001', suffix: null }
 */
function parseId(id) {
  const m = id.match(/^([A-Z]{2,3}\d{2}-\d{3})(?:_([a-z]\d+))?$/)
  if (!m) return { base: id, suffix: null }
  return { base: m[1], suffix: m[2] || null }
}

function variantLabel(suffix) {
  if (!suffix) return null
  if (/^p\d+$/i.test(suffix)) return 'Parallel'
  if (/^r\d+$/i.test(suffix)) return 'Alt Art'
  return suffix.toUpperCase()
}

function numOrNull(s) {
  if (s == null || s === '') return null
  const n = Number(String(s).trim())
  return Number.isFinite(n) ? n : null
}

function imageUrlFor(id) {
  return `${R2_PUBLIC}/${R2_PREFIX}/${id}.webp`
}

function setCodeFor(id) {
  const m = id.match(/^([A-Z]{2,3}\d{2})-/)
  return m ? m[1] : 'OTHER'
}

function setNameFor(id, sourcePackLabel) {
  const code = setCodeFor(id)
  if (SET_META[code]) return SET_META[code].name
  // Fall back to the pack label from the search page, with the bracketed code stripped.
  return sourcePackLabel ? sourcePackLabel.replace(/\s*\[[^\]]+\]\s*$/, '').trim() : code
}

function colorsFrom(s) {
  if (!s) return []
  return s.split(/[/,]/).map((x) => x.trim()).filter(Boolean)
}

// ------------------------------ collapse variants ---------------------------
const byBase = new Map() // baseId -> { primaryRecord, variants[] }

for (const r of raw) {
  const { base, suffix } = parseId(r.id)
  if (!byBase.has(base)) byBase.set(base, { primary: null, variants: [] })
  const entry = byBase.get(base)
  if (!suffix) {
    entry.primary = r
  } else {
    entry.variants.push({
      id: r.id,
      label: variantLabel(suffix),
      imageUrl: imageUrlFor(r.id),
      rarity: r.rarity,
    })
  }
}

const cards = []
for (const [baseId, { primary, variants }] of byBase) {
  // If there's no base-art entry, promote the first variant as the "primary"
  // so every base card renders something. Rare (hasn't happened in OP in practice).
  const p = primary ?? raw.find((r) => r.id === (variants[0]?.id ?? '')) ?? null
  if (!p) continue

  const setCode = setCodeFor(baseId)
  const setMeta = SET_META[setCode]

  cards.push({
    id: baseId,
    code: baseId,
    name: p.name || baseId,
    setCode,
    setName: setNameFor(baseId, p.sourcePackLabel),
    releaseDate: setMeta?.date,
    releaseOrder: setMeta?.order ?? 999,
    cardType: p.type || undefined,          // UNIT / PILOT / COMMAND / BASE
    rarity: p.rarity || undefined,          // C / U / R / SR / LR / P
    colors: colorsFrom(p.color),
    cost: numOrNull(p.cost),
    power: numOrNull(p.ap),                 // AP in Gundam terms
    counter: numOrNull(p.hp),               // HP lives here; not a perfect fit but groups "stats"
    attributes: p.zone ? colorsFrom(p.zone) : [],
    types: p.trait ? p.trait.split(/\)\s*\(/).map((t) => t.replace(/^[(]|[)]$/g, '').trim()).filter(Boolean) : [],
    effect: p.effect || undefined,
    trigger: undefined,
    imageSmall: imageUrlFor(baseId),
    imageLarge: imageUrlFor(baseId),
    variants: variants.length ? variants.map((v) => ({ id: v.id, label: v.label || 'Variant', imageUrl: v.imageUrl })) : undefined,
  })
}

cards.sort((a, b) => {
  if (a.releaseOrder !== b.releaseOrder) return a.releaseOrder - b.releaseOrder
  return a.id.localeCompare(b.id)
})

// ------------------------------ sets ---------------------------------------
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

console.log(`\nWrote ${cards.length} Gundam cards across ${sets.length} sets`)
console.log(`  ${OUT_CARDS}`)
console.log(`  ${OUT_SETS}`)
