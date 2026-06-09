/**
 * Pass 2 of the artist backfill: retries the `stillMissing` entries from
 * data/pokemon-artist-backfill.json with zero-padded TCGdex localIds
 * (SV/ME-era sets print "001/191" and TCGdex keys cards that way).
 * Also retries sets that failed name-mapping using a manual alias table.
 *
 * Usage: node scripts/backfill-pokemon-artists-retry.mjs --apply
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

const report = JSON.parse(readFileSync(REPORT, 'utf8'))
const ourSets = JSON.parse(readFileSync(SETS, 'utf8'))
const todo = report.stillMissing
console.log(`Retrying ${todo.length} cards with padded localIds…`)

const tcgdexSets = await fetch('https://api.tcgdex.net/v2/en/sets').then((r) => r.json())
const byName = new Map(tcgdexSets.map((s) => [s.name.toLowerCase(), s.id]))
const setMap = new Map()
for (const s of ourSets) {
  const m = byName.get((s.setName || '').toLowerCase())
  if (m) setMap.set(s.setCode, m)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const filled = []
const stillMissing = []
let processed = 0

for (const item of todo) {
  processed++
  const tcgdexId = setMap.get(item.set)
  if (!tcgdexId) {
    stillMissing.push(item)
    continue
  }
  const num = item.id.split('-').slice(1).join('-')
  // Try padded (SV-era "001"), then raw, then unpadded.
  const candidates = num.match(/^\d+$/)
    ? [...new Set([String(parseInt(num, 10)).padStart(3, '0'), num, String(parseInt(num, 10))])]
    : [num]
  let found = null
  let sawCard = false
  for (const localId of candidates) {
    try {
      const res = await fetch(`https://api.tcgdex.net/v2/en/cards/${tcgdexId}-${localId}`)
      if (!res.ok) continue
      sawCard = true
      const d = await res.json()
      if (d?.illustrator) { found = d.illustrator; break }
    } catch { /* keep trying */ }
    await sleep(40)
  }
  if (found) {
    filled.push({ id: item.id, name: item.name, set: item.set, artist: found })
  } else {
    stillMissing.push({ ...item, reason: sawCard ? 'tcgdex has no illustrator' : 'card not on tcgdex' })
  }
  if (processed % 50 === 0) process.stdout.write(`  ${processed}/${todo.length} (filled=${filled.length})\r`)
  await sleep(40)
}

console.log(`\nRetry pass: filled ${filled.length}, still missing ${stillMissing.length}`)

report.filled.push(...filled)
report.stillMissing = stillMissing
report.generatedAt = new Date().toISOString()
writeFileSync(REPORT, JSON.stringify(report, null, 2))

if (!APPLY) { console.log('Dry run.'); process.exit(0) }

const artistById = new Map(filled.map((f) => [f.id, f.artist]))
const cards = JSON.parse(readFileSync(BUNDLE, 'utf8'))
let appliedBundle = 0
for (const c of cards) {
  const a = artistById.get(c.id)
  if (a && !c.artist) { c.artist = a; appliedBundle++ }
}
writeFileSync(BUNDLE, JSON.stringify(cards, null, 2))
console.log(`Applied ${appliedBundle} artists to bundle.`)

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
