/**
 * Augments data/pokemon-cards-raw.json with cards from TCGdex
 * (https://tcgdex.dev) — pokemontcg.io frequently lags on alt arts and
 * Special Illustration Rares for newly-released sets.
 *
 * For each set in our raw list, this script:
 *   1. Maps our pokemontcg.io set id (e.g. "me2pt5") to TCGdex's id ("me02.5")
 *      via name match — most reliable since the IDs use slightly different
 *      conventions (zero-padding, "pt" vs ".").
 *   2. Fetches TCGdex's full card list for that set.
 *   3. For any card that doesn't already exist in our raw bundle (by id),
 *      appends a synthetic entry matching the pokemontcg.io schema enough
 *      that the existing downloader + bundle generator pick it up.
 *
 * TCGdex image URLs follow `https://assets.tcgdex.net/en/.../{n}/high.webp`.
 * We hand the downloader the `.png` URL because it pipes through cwebp;
 * the high-res file at TCGdex is offered in webp directly so we use it
 * as-is and let cwebp re-encode (slight quality loss but consistent).
 *
 * Usage:
 *   node scripts/augment-pokemon-tcgdex.mjs                    # all sets
 *   node scripts/augment-pokemon-tcgdex.mjs --since=2024       # only sets released >= 2024
 *   node scripts/augment-pokemon-tcgdex.mjs --sets=me2pt5,me3  # explicit subset
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW_CARDS = join(ROOT, 'data', 'pokemon-cards-raw.json')
const RAW_SETS = join(ROOT, 'data', 'pokemon-sets-raw.json')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.length ? rest.join('=') : true]
  })
)
const SINCE = args.since ? String(args.since) : null
const SET_FILTER = args.sets ? new Set(String(args.sets).split(',')) : null

if (!existsSync(RAW_CARDS) || !existsSync(RAW_SETS)) {
  console.error('Run scripts/fetch-pokemon-data.mjs first.')
  process.exit(1)
}

const ourCards = JSON.parse(readFileSync(RAW_CARDS, 'utf8'))
const ourSets = JSON.parse(readFileSync(RAW_SETS, 'utf8'))

// Index existing card ids for fast dedupe. We normalize id keys because
// TCGdex zero-pads localIds (`001`) while pokemontcg.io does not (`1`),
// and a non-normalized check creates duplicates for every base card.
const normalizeId = (id) => {
  // Strip leading zeros from the trailing numeric segment only:
  //   "sv1-001"   -> "sv1-1"
  //   "sv1-TG01"  -> "sv1-TG01"  (preserve non-numeric)
  const m = String(id).match(/^(.*-)(\d+)$/)
  if (!m) return String(id)
  return m[1] + String(parseInt(m[2], 10))
}
const existingIds = new Set(ourCards.map((c) => normalizeId(c.id)))

// Fetch TCGdex set index once and match by exact name. Names align very
// reliably across the two sources for English releases.
console.log('Fetching TCGdex set index…')
const tcgdexSets = await fetch('https://api.tcgdex.net/v2/en/sets').then((r) => r.json())
const byName = new Map()
for (const s of tcgdexSets) {
  byName.set(s.name.toLowerCase(), s)
}

// Build our (pokemontcg id) -> TCGdex set lookup.
const setMap = new Map()
for (const s of ourSets) {
  const match = byName.get((s.name || '').toLowerCase())
  if (match) setMap.set(s.id, match)
}
console.log(`Mapped ${setMap.size}/${ourSets.length} sets to TCGdex.`)

// Filter sets we'll actually pull from TCGdex.
const targets = ourSets.filter((s) => {
  if (!setMap.has(s.id)) return false
  if (SET_FILTER && !SET_FILTER.has(s.id)) return false
  if (SINCE) {
    const rd = s.releaseDate ? s.releaseDate.replace(/\//g, '-') : ''
    if (rd < SINCE) return false
  }
  return true
})
console.log(`Will check ${targets.length} sets for missing alt arts.\n`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let totalAdded = 0
const newCards = []

for (let i = 0; i < targets.length; i++) {
  const s = targets[i]
  const tcgdexSet = setMap.get(s.id)
  process.stdout.write(`  [${i + 1}/${targets.length}] ${s.id} (TCGdex: ${tcgdexSet.id})… `)

  let detail
  try {
    detail = await fetch(`https://api.tcgdex.net/v2/en/sets/${tcgdexSet.id}`).then((r) => r.json())
  } catch (e) {
    console.log(`fetch failed: ${e.message}`)
    continue
  }
  const cards = detail.cards || []

  let addedHere = 0
  for (const c of cards) {
    // Use unpadded localId to match pokemontcg.io's id convention.
    const localUnpadded = String(c.localId).match(/^\d+$/)
      ? String(parseInt(c.localId, 10))
      : String(c.localId)
    const ourId = `${s.id}-${localUnpadded}`
    if (existingIds.has(normalizeId(ourId))) continue
    // Skip cards TCGdex doesn't have art for yet — useless without an image.
    if (!c.image) continue

    // Synthesize a minimal pokemontcg.io-compatible card row. The bundle
    // generator only reads a handful of fields; everything else is optional.
    const synth = {
      id: ourId,
      name: c.name,
      number: String(c.localId),
      set: {
        id: s.id,
        name: s.name,
        releaseDate: s.releaseDate,
      },
      images: {
        large: `${c.image}/high.png`,
        small: `${c.image}/low.png`,
      },
      _source: 'tcgdex',
    }

    existingIds.add(normalizeId(ourId))
    newCards.push(synth)
    addedHere++
  }

  totalAdded += addedHere
  console.log(addedHere ? `+${addedHere} new` : 'up to date')
  await sleep(120) // be polite to TCGdex
}

if (newCards.length === 0) {
  console.log('\nNothing to augment — all sets already have full coverage.')
} else {
  const merged = [...ourCards, ...newCards]
  writeFileSync(RAW_CARDS, JSON.stringify(merged, null, 2))
  console.log(`\nAdded ${totalAdded} cards from TCGdex. Raw bundle now has ${merged.length} entries.`)
}

// Emit a residual-gap report: any set still short after TCGdex augmentation.
// CI can fail loudly on this for recently-released sets.
const RESIDUAL = join(ROOT, 'data', 'pokemon-residual-gaps.json')
const finalCounts = new Map()
const finalCards = JSON.parse(readFileSync(RAW_CARDS, 'utf8'))
for (const c of finalCards) {
  const id = c.set?.id
  if (!id) continue
  finalCounts.set(id, (finalCounts.get(id) || 0) + 1)
}
const residual = []
for (const s of ourSets) {
  const expected = Number(s.total || s.printedTotal || 0)
  const received = finalCounts.get(s.id) || 0
  if (expected > received) {
    residual.push({
      setId: s.id,
      name: s.name,
      releaseDate: s.releaseDate,
      expected,
      received,
      missing: expected - received,
      tcgdexMapped: setMap.has(s.id),
    })
  }
}
residual.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
writeFileSync(RESIDUAL, JSON.stringify(residual, null, 2))
if (residual.length) {
  console.log(`\n⚠ ${residual.length} sets still incomplete after TCGdex augmentation:`)
  for (const g of residual.slice(0, 10)) {
    const flag = g.tcgdexMapped ? '' : ' (no TCGdex mapping)'
    console.log(`  ${g.setId.padEnd(10)} ${g.name.padEnd(35)} ${g.received}/${g.expected}${flag}`)
  }
  if (residual.length > 10) console.log(`  …and ${residual.length - 10} more (see ${RESIDUAL})`)
} else {
  console.log('\n✓ All sets have full alt-art coverage.')
}
console.log('\nNext: node scripts/download-pokemon-images.mjs && node scripts/generate-pokemon-bundle.mjs')
