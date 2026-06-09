/**
 * Converts data/lorcana-all-cards.json (LorcanaJSON payload) into the
 * canonical Card shape at:
 *   src/lib/cards-lorcana.json
 *   src/lib/sets-lorcana.json
 *
 * Lorcana quirks vs other collections:
 *  - Every print is its own card object (like Pokémon - no nested variants).
 *  - LorcanaJSON's integer `id` is the only globally-unique key; promo
 *    prints (rarity "Special") share setCode+number with main-set cards,
 *    so our card id is "lor-<intId>".
 *  - `color` is a single ink or a dash-joined pair ("Amber-Steel") for
 *    dual-ink cards; we split into our `colors` array.
 *  - strength/willpower map to power/counter; `lore` is appended to the
 *    effect text since our Card shape has no dedicated slot for it.
 *
 * Usage: node scripts/generate-lorcana-bundle.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'lorcana-all-cards.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-lorcana.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-lorcana.json')

const R2_PUBLIC = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const R2_PREFIX = 'cards/lorcana'

if (!existsSync(RAW)) {
  console.error(`Missing ${RAW}. Run: node scripts/fetch-lorcana-data.mjs first`)
  process.exit(1)
}

const payload = JSON.parse(readFileSync(RAW, 'utf8'))
const rawCards = payload.cards ?? []
const rawSets = payload.sets ?? {}

// Release order: chronological by set releaseDate, offset 800+ to stay
// clear of the other collections' ranges (One Piece 1-99, Digimon 400s,
// Pokémon 600s).
const setEntries = Object.entries(rawSets)
  .filter(([code]) => rawCards.some((c) => c.setCode === code)) // skip card-less future sets
  .sort((a, b) => (a[1].releaseDate || '9999').localeCompare(b[1].releaseDate || '9999'))
const orderForSet = new Map()
setEntries.forEach(([code], i) => orderForSet.set(code, 800 + i))

const r2Url = (id) => `${R2_PUBLIC}/${R2_PREFIX}/${id}.webp`

const cards = rawCards.map((c) => {
  const id = `lor-${c.id}`
  const setMeta = rawSets[c.setCode] ?? {}
  const colors = c.color ? c.color.split('-') : []

  // Effect text: abilities/fullText plus a Lore line for characters and
  // locations (lore is a core stat collectors search by).
  const parts = []
  if (c.fullText) parts.push(c.fullText)
  if (c.lore != null) parts.push(`Lore: ${c.lore}`)
  if (c.story) parts.push(`From: ${c.story}`)

  return {
    id,
    code: `${c.setCode}-${c.number}`,
    name: c.fullName || c.name,
    setCode: c.setCode,
    setName: setMeta.name || c.setCode,
    releaseDate: setMeta.releaseDate || undefined,
    releaseOrder: orderForSet.get(c.setCode) ?? 999,
    cardType: c.type || undefined, // Character | Action | Item | Location
    rarity: c.rarity || undefined,
    colors,
    cost: c.cost ?? null,
    power: c.strength ?? null,
    counter: c.willpower ?? null,
    attributes: Array.isArray(c.subtypes) ? c.subtypes : [],
    types: Array.isArray(c.subtypes) ? c.subtypes : [],
    effect: parts.length ? parts.join('\n\n') : undefined,
    trigger: undefined,
    artist: c.artistsText || undefined,
    imageSmall: r2Url(id),
    imageLarge: r2Url(id),
    variants: undefined,
  }
})

// Order: set release order, then collector number (numeric where possible),
// then the unique int id so promo prints land after main-set numbers.
const numKey = (code) => {
  const n = String(code).split('-').pop()
  return n.match(/^\d+$/) ? parseInt(n, 10) : 100000
}
cards.sort((a, b) => {
  if (a.releaseOrder !== b.releaseOrder) return a.releaseOrder - b.releaseOrder
  const na = numKey(a.code)
  const nb = numKey(b.code)
  if (na !== nb) return na - nb
  return a.id.localeCompare(b.id, undefined, { numeric: true })
})

const sets = setEntries.map(([code, meta]) => ({
  setCode: code,
  setName: meta.name || code,
  releaseDate: meta.releaseDate || undefined,
  releaseOrder: orderForSet.get(code),
  cardCount: cards.filter((c) => c.setCode === code).length,
}))

writeFileSync(OUT_CARDS, JSON.stringify(cards, null, 2))
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))
console.log(`Wrote ${cards.length} Lorcana cards across ${sets.length} sets`)
console.log(`  ${OUT_CARDS}`)
console.log(`  ${OUT_SETS}`)
