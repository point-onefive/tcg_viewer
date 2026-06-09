/**
 * Fetches the Disney Lorcana card catalog from LorcanaJSON
 * (https://lorcanajson.org) - community-maintained data sourced from the
 * official Ravensburger Companion app.
 *
 * Writes data/lorcana-all-cards.json (the raw allCards.json payload:
 * { metadata, sets, cards }).
 *
 * The metadata.generatedOn field can be compared between runs to detect
 * upstream updates cheaply.
 *
 * Usage: node scripts/fetch-lorcana-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const OUT = join(DATA_DIR, 'lorcana-all-cards.json')

const URL = 'https://lorcanajson.org/files/current/en/allCards.json'

console.log(`Fetching ${URL} …`)
const res = await fetch(URL, { headers: { 'User-Agent': 'tcg_viewer lorcana fetch' } })
if (!res.ok) {
  console.error(`HTTP ${res.status}`)
  process.exit(1)
}
const payload = await res.json()
mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(payload))

console.log(`Wrote ${payload.cards?.length ?? 0} cards across ${Object.keys(payload.sets ?? {}).length} sets`)
console.log(`  generatedOn: ${payload.metadata?.generatedOn}`)
console.log(`  ${OUT}`)
