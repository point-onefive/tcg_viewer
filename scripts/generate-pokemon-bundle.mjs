/**
 * Converts data/pokemon-cards-raw.json into the canonical Card shape at
 *   src/lib/cards-pokemon.json
 *   src/lib/sets-pokemon.json
 *
 * Pokémon API quirks vs other collections:
 *  - Each API card is unique (one image per id); no parallel stacking needed.
 *  - "types" (Grass/Fire/Water/...) map to our `colors` filter.
 *  - Set id already embeds the set code (e.g. "sv1-1"). We use set.id as setCode.
 *  - releaseOrder is set from chronological set order via releaseDate.
 *
 * Usage: node scripts/generate-pokemon-bundle.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'pokemon-cards-raw.json')
const RAW_SETS = join(ROOT, 'data', 'pokemon-sets-raw.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-pokemon.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-pokemon.json')

const R2_PUBLIC = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const R2_PREFIX = 'cards/pokemon'

if (!existsSync(RAW) || !existsSync(RAW_SETS)) {
  console.error(`Missing ${RAW} or ${RAW_SETS}. Run: node scripts/fetch-pokemon-data.mjs first`)
  process.exit(1)
}

const rawCards = JSON.parse(readFileSync(RAW, 'utf8'))
const rawSets = JSON.parse(readFileSync(RAW_SETS, 'utf8'))

// Chronological release order across included sets. 600+ base to keep Pokémon
// sorted after the existing namespaces (One Piece 1-99, Digimon 400s, etc.).
rawSets.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''))
const orderForSet = new Map()
rawSets.forEach((s, i) => orderForSet.set(s.id, 600 + i))

function r2Url(id) {
  return `${R2_PUBLIC}/${R2_PREFIX}/${id}.webp`
}

function normalizeDate(d) {
  // API returns "2023/03/31" - convert to "2023-03-31" for consistent sort.
  return d ? d.replace(/\//g, '-') : undefined
}

const cards = rawCards.map((c) => {
  const setId = c.set?.id || c.id.split('-')[0]
  const setName = c.set?.name || setId
  const releaseDate = normalizeDate(c.set?.releaseDate)
  const releaseOrder = orderForSet.get(setId) ?? 999

  // Concat rules + attacks + abilities into an effect blob.
  const parts = []
  if (Array.isArray(c.rules) && c.rules.length) parts.push(c.rules.join('\n\n'))
  if (Array.isArray(c.abilities)) {
    for (const a of c.abilities) {
      parts.push(`[${a.type || 'Ability'}] ${a.name}\n${a.text || ''}`.trim())
    }
  }
  if (Array.isArray(c.attacks)) {
    for (const a of c.attacks) {
      const cost = Array.isArray(a.cost) && a.cost.length ? ` (${a.cost.join(', ')})` : ''
      const dmg = a.damage ? ` — ${a.damage}` : ''
      parts.push(`${a.name}${cost}${dmg}${a.text ? `\n${a.text}` : ''}`.trim())
    }
  }
  const effect = parts.length ? parts.join('\n\n') : undefined

  return {
    id: c.id,
    code: c.id,
    name: c.name,
    setCode: setId,
    setName,
    releaseDate,
    releaseOrder,
    cardType: c.supertype || undefined, // Pokémon | Trainer | Energy
    rarity: c.rarity || undefined,
    colors: Array.isArray(c.types) ? c.types : [],
    cost: null,
    power: c.hp ? Number(c.hp) : null,
    counter: null,
    attributes: Array.isArray(c.subtypes) ? c.subtypes : [],
    types: Array.isArray(c.subtypes) ? c.subtypes : [],
    effect,
    trigger: undefined,
    imageSmall: r2Url(c.id),
    imageLarge: r2Url(c.id),
    variants: undefined,
  }
})

cards.sort((a, b) => {
  if (a.releaseOrder !== b.releaseOrder) return a.releaseOrder - b.releaseOrder
  return a.id.localeCompare(b.id, undefined, { numeric: true })
})

const setsMap = new Map()
for (const c of cards) {
  if (!setsMap.has(c.setCode)) {
    setsMap.set(c.setCode, {
      setCode: c.setCode,
      setName: c.setName,
      releaseDate: c.releaseDate,
      releaseOrder: c.releaseOrder,
      cardCount: 0,
    })
  }
  setsMap.get(c.setCode).cardCount += 1
}
const sets = Array.from(setsMap.values()).sort((a, b) => a.releaseOrder - b.releaseOrder)

writeFileSync(OUT_CARDS, JSON.stringify(cards, null, 2))
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))

console.log(`Wrote ${cards.length} Pokémon cards across ${sets.length} sets`)
console.log(`  ${OUT_CARDS}`)
console.log(`  ${OUT_SETS}`)
