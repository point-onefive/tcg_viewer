/**
 * Converts data/cards.json (raw vegapull format) into src/lib/cards-generated.json
 * which is imported by data.ts for the actual gallery.
 *
 * Key behaviours:
 * - Uses canonical set names (hardcoded), ignoring pack metadata which is unreliable
 * - Collapses variant suffixes (_p1, _p2, _r1) - one tile per base card ID
 * - Preserves all gameplay metadata: cost, power, counter, effect, trigger, types, attributes
 *
 * Run after fetch-card-data.mjs.
 * Usage: node scripts/generate-card-data.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CARDS_JSON = join(ROOT, 'data', 'cards.json')
const PACKS_JSON = join(ROOT, 'data', 'packs.json')
const OUT_CARDS = join(ROOT, 'src', 'lib', 'cards-one-piece.json')
const OUT_SETS = join(ROOT, 'src', 'lib', 'sets-one-piece.json')

if (!existsSync(CARDS_JSON)) {
  console.error('data/cards.json not found. Run: node scripts/fetch-card-data.mjs first')
  process.exit(1)
}

const rawCards = JSON.parse(readFileSync(CARDS_JSON, 'utf8'))
const rawPacks = existsSync(PACKS_JSON) ? JSON.parse(readFileSync(PACKS_JSON, 'utf8')) : []

// Canonical set names keyed by setCode prefix.
// These are the OFFICIAL English names - do not use pack metadata for naming.
const SET_META = {
  'OP01': { name: 'Romance Dawn',              date: '2022-07-22', order: 1 },
  'OP02': { name: 'Paramount War',             date: '2022-12-02', order: 2 },
  'OP03': { name: 'Pillars of Strength',       date: '2023-03-10', order: 3 },
  'OP04': { name: 'Kingdoms of Intrigue',      date: '2023-07-28', order: 4 },
  'OP05': { name: 'Awakening of the New Era',  date: '2023-08-25', order: 5 },
  'OP06': { name: 'Wings of the Captain',      date: '2023-11-10', order: 6 },
  'OP07': { name: '500 Years in the Future',   date: '2024-02-09', order: 7 },
  'OP08': { name: 'Two Legends',               date: '2024-05-24', order: 8 },
  'OP09': { name: 'Emperors in the New World', date: '2024-08-30', order: 9 },
  'OP10': { name: 'Royal Blood',               date: '2024-11-08', order: 10 },
  'OP11': { name: 'A Fist of Divine Speed',    date: '2025-03-07', order: 11 },
  'OP12': { name: 'Legacy of the Master',      date: '2025-06-13', order: 12 },
  'OP13': { name: 'Carrying On His Will',      date: '2025-09-12', order: 13 },
  'OP14': { name: "The Azure Sea's Seven",     date: '2025-12-05', order: 14 },
  'OP15': { name: "Adventure on Kami's Island",date: '2026-03-06', order: 15 },
  'ST01': { name: 'Starter - Straw Hat Crew',  date: '2022-07-08', order: 20 },
  'ST02': { name: 'Starter - Worst Generation',date: '2022-07-08', order: 21 },
  'ST03': { name: 'Starter - Seven Warlords',  date: '2022-07-08', order: 22 },
  'ST04': { name: 'Starter - Animal Kingdom',  date: '2022-12-02', order: 23 },
  'ST05': { name: 'Starter - Film Edition',    date: '2023-03-10', order: 24 },
  'ST06': { name: 'Starter - Absolute Justice',date: '2023-07-28', order: 25 },
  'ST07': { name: 'Starter - Big Mom Pirates', date: '2023-07-28', order: 26 },
  'ST08': { name: 'Starter - Monkey D. Luffy', date: '2023-07-28', order: 27 },
  'ST09': { name: 'Starter - Yamato',          date: '2023-08-25', order: 28 },
  'ST10': { name: 'Ultra Deck - Three Captains',date: '2023-11-10', order: 29 },
  'ST11': { name: 'Starter - Uta',             date: '2023-11-10', order: 30 },
  'ST12': { name: 'Starter - Zoro & Sanji',    date: '2024-02-09', order: 31 },
  'ST13': { name: 'Ultra Deck - Three Brothers',date: '2024-02-09', order: 32 },
  'ST14': { name: 'Starter - 3D2Y',            date: '2024-05-24', order: 33 },
  'ST15': { name: 'Starter - Red Edward Newgate',date: '2024-08-30', order: 34 },
  'ST16': { name: 'Starter - Green Uta',       date: '2024-11-08', order: 35 },
  'ST17': { name: 'Starter - Blue Doflamingo', date: '2024-11-08', order: 36 },
  'ST18': { name: 'Starter - Purple Luffy',    date: '2024-11-08', order: 37 },
  'ST19': { name: 'Starter - Black Smoker',    date: '2025-03-07', order: 38 },
  'ST20': { name: 'Starter - Yellow Katakuri', date: '2025-03-07', order: 39 },
  'ST21': { name: 'Starter EX - Gear 5',       date: '2025-03-07', order: 40 },
  'ST22': { name: 'Starter - Boa Hancock',     date: '2025-06-13', order: 41 },
  'ST23': { name: 'Starter - Blackbeard',      date: '2025-06-13', order: 42 },
  'ST24': { name: 'Starter - Green Jewelry Bonney', date: '2025-09-12', order: 43 },
  'ST25': { name: 'Starter - Blue Buggy',      date: '2025-09-12', order: 44 },
  'ST26': { name: 'Starter - Purple/Black Luffy', date: '2025-12-05', order: 45 },
  'ST27': { name: 'Starter - Black Marshall.D.Teach', date: '2025-12-05', order: 46 },
  'ST28': { name: 'Starter - Green/Yellow Yamato', date: '2026-03-06', order: 47 },
  'ST29': { name: 'Starter - Egghead',         date: '2026-03-06', order: 48 },
  'EB01': { name: 'Extra - Memorial Collection',date: '2024-01-26', order: 50 },
  'EB02': { name: 'Extra - Anime 25th Collection',date: '2025-01-24', order: 51 },
  'EB03': { name: 'Extra - One Piece Heroines',date: '2025-09-12', order: 52 },
  'EB04': { name: 'Extra Booster (OP14/OP15)', date: '2025-12-05', order: 53 },
  'PRB01':{ name: 'Premium - Card The Best',   date: '2024-09-27', order: 60 },
  'PRB02':{ name: 'Premium - Card The Best vol.2', date: '2025-12-05', order: 61 },
}

// Pack-id based bucketing for cards that don't fit the standard {SET}-{NUM}
// scheme. Keyed by source_pack_id from vegapull. These cover:
//   569901 - Promotion Card (event / judge / tournament promos, all `P-xxx` ids)
//   569801 - Other Product Card (Premium Bandai gift sets, Best Collection, 1st
//            Anniversary Set, Memorial Collection, etc.)
// Cards from these packs are grouped under a shared setCode so they appear as
// a single "Promo" or "Bandai Exclusives" section rather than fragmenting into
// one section per individual product.
const PACK_ID_GROUPS = {
  '569901': { setCode: 'PROMO',      name: 'Promo Cards',            order: 98 },
  '569801': { setCode: 'EXCLUSIVES', name: 'Premium Bandai Exclusives', order: 99 },
}

const RARITY_MAP = {
  'Common':      'C',
  'Uncommon':    'UC',
  'Rare':        'R',
  'SuperRare':   'SR',
  'SecretRare':  'SEC',
  'Leader':      'L',
  'Promo':       'P',
  'TreasureRare':'TR',
  'DoublePack':  'DP',
}

const IMAGE_BASE = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev/cards'

// Extract base card ID by stripping variant suffix: "OP01-006_p3" → "OP01-006"
function baseId(id) {
  return id.replace(/_[a-z]\d+$/i, '')
}

// Extract setCode prefix: "OP01-006" → "OP01"
function setCodeFromId(id) {
  return id.split('-')[0]
}

// Resolve the display set for a card. Cards from the promo / "other product"
// packs have ambiguous prefixes (e.g. `P-001`, `GIFT-001`, `BDC-001`), so we
// route them through PACK_ID_GROUPS when vegapull tells us which pack they
// came from. Everything else uses the standard setCode lookup.
function resolveSet(card) {
  const group = PACK_ID_GROUPS[card.source_pack_id]
  if (group) {
    return {
      setCode: group.setCode,
      name: group.name,
      date: '',
      order: group.order,
    }
  }
  const code = setCodeFromId(card.id)
  const meta = SET_META[code]
  if (meta) return { setCode: code, ...meta }
  // Unknown retail set code: use the code itself, pushed to the end.
  return { setCode: code, name: code, date: '', order: 900 }
}

// Extract variant label: "OP01-006_p3" → "p3", "OP01-006" → null
function variantLabel(id) {
  const m = id.match(/_([a-z]\d+)$/i)
  return m ? m[1] : null
}

// Group all raw cards by their base ID
const grouped = new Map()
for (const c of rawCards) {
  const base = baseId(c.id)
  if (!grouped.has(base)) grouped.set(base, [])
  grouped.get(base).push(c)
}

const cards = []

for (const [base, variants] of grouped) {
  // Find the canonical base card (no suffix), or fall back to first entry
  const canonical = variants.find(v => v.id === base) ?? variants[0]
  const set = resolveSet(canonical)

  // All non-base variants (alternate arts)
  const altVariants = variants
    .filter(v => v.id !== base)
    .map(v => ({
      id: v.id,
      label: variantLabel(v.id) ?? v.id,
      imageUrl: `${IMAGE_BASE}/${v.id}.png`,
    }))

  cards.push({
    id: base,
    code: base,
    name: canonical.name,
    setCode: set.setCode,
    setName: set.name,
    releaseDate: set.date,
    releaseOrder: set.order,
    cardType: canonical.category,
    rarity: RARITY_MAP[canonical.rarity] ?? canonical.rarity,
    colors: canonical.colors ?? [],
    cost: canonical.cost ?? null,
    power: canonical.power ?? null,
    counter: canonical.counter ?? null,
    attributes: canonical.attributes ?? [],
    types: canonical.types ?? [],
    effect: canonical.effect ? canonical.effect.replace(/<br>/g, '\n') : null,
    trigger: canonical.trigger ? canonical.trigger.replace(/<br>/g, '\n') : null,
    imageSmall: `${IMAGE_BASE}/${base}.png`,
    imageLarge: `${IMAGE_BASE}/${base}.png`,
    variants: altVariants.length > 0 ? altVariants : undefined,
  })
}

// Sort: by releaseOrder, then by card number within set
cards.sort((a, b) => {
  if (a.releaseOrder !== b.releaseOrder) return a.releaseOrder - b.releaseOrder
  return a.id.localeCompare(b.id)
})

// Build unique sets
const setMap = new Map()
for (const c of cards) {
  if (!setMap.has(c.setCode)) {
    setMap.set(c.setCode, {
      setCode: c.setCode,
      setName: c.setName,
      releaseDate: c.releaseDate,
      releaseOrder: c.releaseOrder,
      cardCount: 0,
    })
  }
  setMap.get(c.setCode).cardCount++
}
const sets = [...setMap.values()].sort((a, b) => a.releaseOrder - b.releaseOrder)

writeFileSync(OUT_CARDS, JSON.stringify(cards, null, 2))
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))

const withVariants = cards.filter(c => c.variants?.length > 0)
console.log(`Written ${cards.length} base cards (${withVariants.length} with alternate arts) to src/lib/cards-one-piece.json`)
console.log(`Written ${sets.length} sets to src/lib/sets-one-piece.json`)
