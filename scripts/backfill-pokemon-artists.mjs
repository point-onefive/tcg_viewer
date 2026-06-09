/**
 * One-time backfill of missing `artist` fields in the Pokémon bundle.
 *
 * Phase 1 (this script, --tcgdex): for every card in
 * src/lib/cards-pokemon.json with no artist, look the card up on TCGdex
 * (https://tcgdex.dev) and take its `illustrator` field. TCGdex set ids
 * differ from pokemontcg.io ids (zero-padding, "." instead of "pt"), so
 * sets are matched by name against the TCGdex set index.
 *
 * Results are written to:
 *   - data/pokemon-artist-backfill.json   (full report: filled + still missing)
 *   - src/lib/cards-pokemon.json          (artist applied in place)
 *   - data/pokemon-cards-raw.json         (artist applied where the card exists,
 *                                          so future bundle regens keep it)
 *
 * Usage:
 *   node scripts/backfill-pokemon-artists.mjs            # dry run (report only)
 *   node scripts/backfill-pokemon-artists.mjs --apply    # write bundle + raw
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BUNDLE = join(ROOT, 'src', 'lib', 'cards-pokemon.json')
const SETS = join(ROOT, 'src', 'lib', 'sets-pokemon.json')
const RAW = join(ROOT, 'data', 'pokemon-cards-raw.json')
const REPORT = join(ROOT, 'data', 'pokemon-artist-backfill.json')

const APPLY = process.argv.includes('--apply')

const cards = JSON.parse(readFileSync(BUNDLE, 'utf8'))
const ourSets = JSON.parse(readFileSync(SETS, 'utf8'))
const missing = cards.filter((c) => !c.artist)
console.log(`Cards missing artist: ${missing.length}`)

// Map our set codes -> TCGdex set ids by name.
console.log('Fetching TCGdex set index…')
const tcgdexSets = await fetch('https://api.tcgdex.net/v2/en/sets').then((r) => r.json())
const byName = new Map(tcgdexSets.map((s) => [s.name.toLowerCase(), s.id]))
const setMap = new Map()
for (const s of ourSets) {
  const m = byName.get((s.setName || '').toLowerCase())
  if (m) setMap.set(s.setCode, m)
}
console.log(`Mapped ${setMap.size}/${ourSets.length} sets to TCGdex.`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const filled = []
const stillMissing = []
let processed = 0

// Group missing cards by set so unmapped sets are skipped wholesale.
const missingBySet = new Map()
for (const c of missing) {
  if (!missingBySet.has(c.setCode)) missingBySet.set(c.setCode, [])
  missingBySet.get(c.setCode).push(c)
}

for (const [setCode, setCards] of missingBySet) {
  const tcgdexId = setMap.get(setCode)
  if (!tcgdexId) {
    for (const c of setCards) stillMissing.push({ id: c.id, name: c.name, set: setCode, reason: 'no tcgdex set mapping' })
    processed += setCards.length
    continue
  }
  for (const c of setCards) {
    processed++
    // pokemontcg.io ids: "<set>-<number>" where number may be non-numeric
    // (e.g. "swsh45-SV086"). TCGdex localIds match the printed number.
    const num = c.id.split('-').slice(1).join('-')
    const localId = num.match(/^\d+$/) ? String(parseInt(num, 10)) : num
    try {
      const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${tcgdexId}-${localId}`)
      const d = res.ok ? await res.json() : null
      if (d?.illustrator) {
        filled.push({ id: c.id, name: c.name, set: setCode, artist: d.illustrator })
      } else {
        stillMissing.push({ id: c.id, name: c.name, set: setCode, reason: d ? 'tcgdex has no illustrator' : 'card not on tcgdex' })
      }
    } catch (e) {
      stillMissing.push({ id: c.id, name: c.name, set: setCode, reason: `fetch error: ${e.message}` })
    }
    if (processed % 50 === 0) process.stdout.write(`  ${processed}/${missing.length} (filled=${filled.length})\r`)
    await sleep(60)
  }
}

console.log(`\nTCGdex backfill: filled ${filled.length}, still missing ${stillMissing.length}`)

writeFileSync(REPORT, JSON.stringify({ generatedAt: new Date().toISOString(), filled, stillMissing }, null, 2))
console.log(`Report: ${REPORT}`)

if (!APPLY) {
  console.log('Dry run - bundle not modified. Re-run with --apply to write.')
  process.exit(0)
}

// Apply to bundle.
const artistById = new Map(filled.map((f) => [f.id, f.artist]))
let appliedBundle = 0
for (const c of cards) {
  const a = artistById.get(c.id)
  if (a && !c.artist) { c.artist = a; appliedBundle++ }
}
writeFileSync(BUNDLE, JSON.stringify(cards, null, 2))
console.log(`Applied ${appliedBundle} artists to bundle.`)

// Apply to raw (only where the card exists in the raw cache).
if (existsSync(RAW)) {
  const raw = JSON.parse(readFileSync(RAW, 'utf8'))
  let appliedRaw = 0
  for (const c of raw) {
    const a = artistById.get(c.id)
    if (a && !c.artist) { c.artist = a; appliedRaw++ }
  }
  writeFileSync(RAW, JSON.stringify(raw, null, 2))
  console.log(`Applied ${appliedRaw} artists to raw cache.`)
}
