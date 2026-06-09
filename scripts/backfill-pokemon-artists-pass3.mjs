/**
 * Pass 3 of the artist backfill: live pokemontcg.io lookups for cards
 * still missing after the TCGdex passes.
 *
 * Why this works when our own raw cache (also pokemontcg.io) didn't:
 * Trainer Gallery / Galarian Gallery subsets live under their own set
 * ids upstream (swsh9tg, swsh12pt5gg, …) while our bundle keys them
 * under the parent set (swsh9-TG01). The bulk fetch that built the raw
 * cache predates some artist data too, so we also retry the plain id.
 *
 * Usage: node scripts/backfill-pokemon-artists-pass3.mjs --apply
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BUNDLE = join(ROOT, 'src', 'lib', 'cards-pokemon.json')
const RAW = join(ROOT, 'data', 'pokemon-cards-raw.json')
const REPORT = join(ROOT, 'data', 'pokemon-artist-backfill.json')

const APPLY = process.argv.includes('--apply')

const report = JSON.parse(readFileSync(REPORT, 'utf8'))
const todo = report.stillMissing
console.log(`Pass 3 (pokemontcg.io live): ${todo.length} cards`)

/** Candidate pokemontcg.io ids for one of our bundle ids. */
function candidateIds(id) {
  const out = [id]
  let m = id.match(/^(swsh\d+)-(TG\d+)$/i)
  if (m) out.unshift(`${m[1]}tg-${m[2]}`)
  m = id.match(/^(swsh12pt5)-(GG\d+)$/i)
  if (m) out.unshift(`${m[1]}gg-${m[2]}`)
  return out
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const filled = []
const stillMissing = []
let processed = 0

for (const item of todo) {
  processed++
  let artist = null
  for (const cid of candidateIds(item.id)) {
    try {
      const res = await fetch(`https://api.pokemontcg.io/v2/cards/${cid}`)
      if (!res.ok) { await sleep(150) ; continue }
      const d = await res.json()
      if (d?.data?.artist) { artist = d.data.artist; break }
    } catch { /* next candidate */ }
    await sleep(150)
  }
  if (artist) filled.push({ id: item.id, name: item.name, set: item.set, artist })
  else stillMissing.push(item)
  if (processed % 25 === 0) process.stdout.write(`  ${processed}/${todo.length} (filled=${filled.length})\r`)
  await sleep(150)
}

console.log(`\nPass 3: filled ${filled.length}, still missing ${stillMissing.length}`)

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
