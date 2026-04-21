/**
 * Converts data/digimon-cards-raw.json into src/lib/cards-digimon.json + sets-digimon.json
 * in the app's canonical Card shape.
 *
 * Key behaviours:
 * - Uses canonical set names from SET_META (or falls back to scraped label)
 * - Collapses parallels (IDs ending `_P1`, `_P2`, ...) into variants[] on the base card
 * - Release dates come from data/digimon-pack-dates.json (scraped per pack)
 * - R2 image URLs baked in (cards/digimon/{id}.png)
 *
 * Usage: node scripts/generate-digimon-data.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'digimon-cards-raw.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-digimon.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-digimon.json')

const R2_PUBLIC = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const R2_PREFIX = 'cards/digimon'

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-digimon-data.mjs first`)
  process.exit(1)
}

// Namespace: Digimon = 401+ (boosters), 451+ (starter/advanced), 481+ (extras), 491+ (promos)
// Ordered roughly by in-universe release order.
const SET_META = {
  // Boosters / main releases (chronological)
  BT01: { name: 'New Evolution',             order: 401 },
  BT02: { name: 'Ultimate Power',            order: 402 },
  BT03: { name: 'Union Impact',              order: 403 },
  BT0103: { name: 'Release Special Booster', order: 404 },
  BT04: { name: 'Great Legend',              order: 405 },
  BT05: { name: 'Battle of Omni',            order: 406 },
  BT06: { name: 'Double Diamond',            order: 407 },
  EX01: { name: 'Classic Collection',        order: 408 },
  BT07: { name: 'Next Adventure',            order: 409 },
  BT08: { name: 'New Awakening',             order: 410 },
  EX02: { name: 'Digital Hazard',            order: 411 },
  BT09: { name: 'X Record',                  order: 412 },
  BT10: { name: 'Xros Encounter',            order: 413 },
  EX03: { name: 'Draconic Roar',             order: 414 },
  BT11: { name: 'Dimensional Phase',         order: 415 },
  BT12: { name: 'Across Time',               order: 416 },
  EX04: { name: 'Alternative Being',         order: 417 },
  BT13: { name: 'Versus Royal Knights',      order: 418 },
  RB01: { name: 'Resurgence Booster',        order: 419 },
  BT14: { name: 'Blast Ace',                 order: 420 },
  EX05: { name: 'Animal Colosseum',          order: 421 },
  BT15: { name: 'Exceed Apocalypse',         order: 422 },
  BT16: { name: 'Beginning Observer',        order: 423 },
  EX06: { name: 'Infernal Ascension',        order: 424 },
  BT17: { name: 'Secret Crisis',             order: 425 },
  EX07: { name: 'Digimon Liberator',         order: 426 },
  BT1819: { name: 'Special Booster Ver.2.0', order: 427 },
  BT18:   { name: 'Special Booster Ver.2.0', order: 427 },
  EX08:   { name: 'Chain of Liberation',     order: 428 },
  BT1920: { name: 'Special Booster Ver.2.5', order: 429 },
  BT19:   { name: 'Special Booster Ver.2.5', order: 429 },
  BT20:   { name: 'Special Booster Ver.2.5', order: 429 },
  EX09:   { name: 'Versus Monsters',         order: 430 },
  BT21:   { name: 'World Convergence',       order: 431 },
  EX10:   { name: 'Sinister Order',          order: 432 },
  BT22:   { name: 'Cyber Eden',              order: 433 },
  BT23:   { name: "Hackers' Slumber",        order: 434 },
  EX11:   { name: 'Dawn of Liberator',       order: 435 },
  BT24:   { name: 'Time Stranger',           order: 436 },
  AD01:   { name: 'Digimon Generation',      order: 437 },

  // Starter / Advanced decks
  ST1:  { name: 'Gaia Red',                  order: 451 },
  ST2:  { name: 'Cocytus Blue',              order: 452 },
  ST3:  { name: "Heaven's Yellow",           order: 453 },
  ST4:  { name: 'Giga Green',                order: 454 },
  ST5:  { name: 'Machine Black',             order: 455 },
  ST6:  { name: 'Venomous Violet',           order: 456 },
  ST7:  { name: 'Gallantmon',                order: 457 },
  ST8:  { name: 'UlforceVeedramon',          order: 458 },
  ST9:  { name: 'Ultimate Ancient Dragon',   order: 459 },
  ST10: { name: 'Parallel World Tactician',  order: 460 },
  ST12: { name: 'Jesmon',                    order: 461 },
  ST13: { name: 'RagnaLoardmon',             order: 462 },
  ST14: { name: 'Beelzemon',                 order: 463 },
  ST15: { name: 'Dragon of Courage',         order: 464 },
  ST16: { name: 'Wolf of Friendship',        order: 465 },
  ST17: { name: 'Double Typhoon',            order: 466 },
  ST18: { name: 'Guardian Vortex',           order: 467 },
  ST19: { name: 'Fable Waltz',               order: 468 },
  ST20: { name: 'Protector of Light',        order: 469 },
  ST21: { name: 'Hero of Hope',              order: 470 },
  ST22: { name: 'Amethyst Mandala',          order: 471 },

  // Limited card packs
  LM6: { name: 'Billion Bullet',             order: 481 },
  LM7: { name: 'Another Knight',             order: 482 },
  LM06: { name: 'Billion Bullet',            order: 481 },
  LM07: { name: 'Another Knight',            order: 482 },
  LM:   { name: 'Limited Card Pack',         order: 480 },
  TOKEN:{ name: 'Tokens',                    order: 495 },

  // Promo bucket
  P: { name: 'Promo Cards',                  order: 491 },
}

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
console.log(`Loaded ${raw.length} raw Digimon cards`)

function numOrNull(s) {
  if (s == null || s === '' || s === '-') return null
  const n = Number(String(s).replace(/[^\d-]/g, ''))
  return Number.isFinite(n) ? n : null
}

function r2Url(id) {
  return `${R2_PUBLIC}/${R2_PREFIX}/${id}.png`
}

function parseId(id) {
  // BT24-001       -> { base: 'BT24-001', suffix: null }
  // BT24-102_P1    -> { base: 'BT24-102', suffix: 'P1' }
  // P-001          -> { base: 'P-001',    suffix: null }
  // BT24-TOKEN     -> { base: 'BT24-TOKEN', suffix: null }
  const m = id.match(/^(.+?)_P(\d+)$/i)
  if (m) return { base: m[1], suffix: `P${m[2]}` }
  return { base: id, suffix: null }
}

function setCodeFor(id) {
  // Promo IDs are P-001 etc.
  if (/^P-\d+/i.test(id)) return 'P'
  // Limited Card Pack: LM-001 etc.
  if (/^LM-\d+/i.test(id)) return 'LM'
  // Tokens
  if (/^TOKEN/i.test(id)) return 'TOKEN'
  const m = id.match(/^([A-Z]+\d+)-/)
  return m ? m[1] : 'OTHER'
}

// Look up SET_META tolerating either zero-padded or stripped forms.
function metaFor(code) {
  if (SET_META[code]) return SET_META[code]
  // Try padded (BT1 -> BT01) and stripped (BT01 -> BT1)
  const padded = code.replace(/^([A-Z]+)(\d)$/, (_, p, n) => `${p}0${n}`)
  if (SET_META[padded]) return SET_META[padded]
  const stripped = code.replace(/^([A-Z]+)0(\d+)$/, '$1$2')
  if (SET_META[stripped]) return SET_META[stripped]
  return null
}

function setNameFor(code, sourcePackLabel) {
  const m = metaFor(code)
  if (m) return m.name
  if (sourcePackLabel) {
    return sourcePackLabel
      .replace(/\s*\[[^\]]+\]\s*$/, '')
      .replace(/^Booster\s+/i, '')
      .replace(/^Extra Booster\s+/i, '')
      .replace(/^Theme Booster\s+/i, '')
      .replace(/^Starter Deck\s+/i, '')
      .replace(/^Advanced Booster\s+/i, '')
      .replace(/^Advanced Deck\s+/i, '')
      .replace(/^Limited Card Pack\s+/i, '')
      .replace(/^RESURGENCE BOOSTER\s*/i, 'Resurgence Booster')
      .trim() || code
  }
  return code
}

// ---------- collapse parallels -----------------
const groups = new Map() // baseId -> { base, parallels[] }
for (const r of raw) {
  const { base, suffix } = parseId(r.id)
  if (!groups.has(base)) groups.set(base, { base: null, parallels: [] })
  const g = groups.get(base)
  if (suffix) g.parallels.push({ ...r, suffix })
  else g.base = r
}

function composeEffect(p) {
  const parts = []
  if (p.effect) parts.push(p.effect)
  if (p.inheritedEffect) parts.push(`[Inherited]\n${p.inheritedEffect}`)
  if (p.securityEffect) parts.push(`[Security]\n${p.securityEffect}`)
  if (p.specialDigivolutionCondition) parts.push(`[Special Digivolution]\n${p.specialDigivolutionCondition}`)
  if (p.specialPlayCondition) parts.push(`[Special Play]\n${p.specialPlayCondition}`)
  if (p.linkCondition) parts.push(`[Link Condition]\n${p.linkCondition}`)
  if (p.linkDp) parts.push(`[Link DP] ${p.linkDp}`)
  if (p.linkEffect) parts.push(`[Link Effect]\n${p.linkEffect}`)
  return parts.length ? parts.join('\n\n') : undefined
}

const cards = []
for (const [baseId, { base, parallels }] of groups) {
  const p = base || parallels[0]
  if (!p) continue
  const setCode = setCodeFor(baseId)
  const setMeta = metaFor(setCode)
  const variants = parallels
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((pr) => ({
      id: pr.id,
      label: pr.suffix ? `Parallel ${pr.suffix}` : 'Variant',
      imageUrl: r2Url(pr.id),
    }))

  cards.push({
    id: baseId,
    code: baseId,
    name: p.name || baseId,
    setCode,
    setName: setNameFor(setCode, p.sourcePackLabel),
    releaseDate: p.releaseDate || setMeta?.date,
    releaseOrder: setMeta?.order ?? 999,
    cardType: p.cardType || undefined,
    rarity: p.rarity || undefined,
    colors: Array.isArray(p.colors) ? p.colors : [],
    cost: numOrNull(p.cost),
    power: numOrNull(p.dp),
    counter: null,
    attributes: p.attribute ? [p.attribute] : [],
    types: p.typeRow ? p.typeRow.split(/\//).map((s) => s.trim()).filter(Boolean) : [],
    effect: composeEffect(p),
    trigger: undefined,
    imageSmall: r2Url(baseId),
    imageLarge: r2Url(baseId),
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
  const s = setsMap.get(c.setCode)
  s.cardCount += 1
  // Prefer the earliest release date per set
  if (c.releaseDate && (!s.releaseDate || c.releaseDate < s.releaseDate)) {
    s.releaseDate = c.releaseDate
  }
}
const sets = Array.from(setsMap.values()).sort((a, b) => a.releaseOrder - b.releaseOrder)

writeFileSync(OUT_CARDS, JSON.stringify(cards, null, 2))
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))

console.log(`\nWrote ${cards.length} Digimon cards across ${sets.length} sets`)
console.log(`  ${OUT_CARDS}`)
console.log(`  ${OUT_SETS}`)
