/**
 * Converts data/azuki-cards-raw.json into src/lib/cards-azuki.json
 * in the app's canonical Card shape (plus src/lib/sets-azuki.json).
 *
 * Key behaviours:
 * - Groups cards into sets by id prefix (AZK01, STT01-04, AZP, IKZ)
 * - Collapses parallel prints (letter-suffixed ids like AZK01-028A,
 *   STT01-001AX1) into a base card with a variants[] array, mirroring the
 *   Gundam/One Piece pattern
 * - Maps Azuki stats (IKZ cost / attack / element / category) onto Card fields
 * - Bakes R2 image URLs (cards/azuki/{id}.jpg)
 *
 * Usage: node scripts/generate-azuki-data.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'azuki-cards-raw.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-azuki.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-azuki.json')

const R2_PUBLIC = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const R2_PREFIX = 'cards/azuki'

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-azuki-data.mjs first`)
  process.exit(1)
}

// Set code -> display name + sort order. Booster set leads, then the four
// starter decks, then promos and tokens.
const SET_META = {
  AZK01: { name: 'Booster Set 1', order: 101 },
  STT01: { name: 'Starter Deck 1', order: 201 },
  STT02: { name: 'Starter Deck 2', order: 202 },
  STT03: { name: 'Starter Deck 3', order: 203 },
  STT04: { name: 'Starter Deck 4', order: 204 },
  AZP: { name: 'Promo', order: 301 },
  IKZ: { name: 'IKZ Tokens', order: 302 },
}

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
console.log(`Loaded ${raw.length} raw Azuki cards`)

/**
 * Split an Azuki card id into its base and parallel suffix.
 *   AZK01-028A    -> { base: 'AZK01-028', suffix: 'A' }
 *   STT01-001AX1  -> { base: 'STT01-001', suffix: 'AX1' }
 *   AZK01-001     -> { base: 'AZK01-001', suffix: null }
 */
function parseId(id) {
  const m = id.match(/^([A-Z]{2,4}\d*-\d+)([A-Za-z0-9]*)$/)
  if (!m) return { base: id, suffix: null }
  return { base: m[1], suffix: m[2] || null }
}

/** Human-friendly label for a parallel print suffix. */
function variantLabel(suffix) {
  if (!suffix) return null
  if (suffix === 'A') return 'Foil'
  if (suffix.startsWith('AX')) return 'Alt Art'
  if (suffix === 'AC') return 'Special'
  if (suffix === 'ASN') return 'Signature'
  return 'Parallel'
}

function setCodeFor(id) {
  return id.split('-')[0]
}

function numOrNull(v) {
  if (v == null || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function imageUrlFor(id) {
  return `${R2_PUBLIC}/${R2_PREFIX}/${id}.jpg`
}

// ------------------------------ collapse variants ---------------------------
const byBase = new Map() // baseId -> { primary, variants[] }

for (const r of raw) {
  const { base, suffix } = parseId(r.id)
  if (!byBase.has(base)) byBase.set(base, { primary: null, variants: [] })
  const entry = byBase.get(base)
  if (!suffix) {
    entry.primary = r
  } else {
    entry.variants.push({
      id: r.id,
      label: variantLabel(suffix) || 'Variant',
      imageUrl: imageUrlFor(r.id),
      rarity: r.rarity || undefined,
    })
  }
}

const cards = []
for (const [baseId, { primary, variants }] of byBase) {
  // If a base-art print is missing, promote the first variant so every base
  // card still renders something.
  const p = primary ?? raw.find((r) => r.id === (variants[0]?.id ?? '')) ?? null
  if (!p) continue

  const setCode = setCodeFor(baseId)
  const setMeta = SET_META[setCode]

  cards.push({
    id: baseId,
    code: baseId,
    name: p.name || baseId,
    setCode,
    setName: setMeta?.name ?? setCode,
    releaseOrder: setMeta?.order ?? 999,
    cardType: p.category || undefined, // Entity / Spell / Leader / Gate / Weapon / IKZ
    rarity: p.rarity || undefined, // C / UC / R / SR / L / G / IKZ (+ star tiers)
    colors: p.element ? [p.element] : [], // Fire / Water / Earth / Lightning / Neutral
    cost: numOrNull(p.ikzCost),
    power: numOrNull(p.attack),
    counter: null,
    attributes: Array.isArray(p.abilities) ? p.abilities.filter(Boolean) : [],
    types: Array.isArray(p.subtypes) ? p.subtypes.filter(Boolean) : [],
    effect: p.cardText || undefined,
    trigger: undefined,
    imageSmall: imageUrlFor(baseId),
    imageLarge: imageUrlFor(baseId),
    variants: variants.length
      ? variants.map((v) => ({ id: v.id, label: v.label, imageUrl: v.imageUrl, rarity: v.rarity }))
      : undefined,
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
      releaseOrder: c.releaseOrder ?? 999,
      cardCount: 0,
    })
  }
  setsMap.get(c.setCode).cardCount += 1
}
const sets = Array.from(setsMap.values()).sort((a, b) => a.releaseOrder - b.releaseOrder)

writeFileSync(OUT_CARDS, JSON.stringify(cards, null, 2))
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))

const variantCount = cards.reduce((n, c) => n + (c.variants?.length ?? 0), 0)
console.log(`\nWrote ${cards.length} Azuki base cards (+${variantCount} variants) across ${sets.length} sets`)
console.log(`  ${OUT_CARDS}`)
console.log(`  ${OUT_SETS}`)
