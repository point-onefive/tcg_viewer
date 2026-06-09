/**
 * Applies the OCR artist extractions (data/pokemon-artist-ocr.json,
 * produced by scripts/ocr-pokemon-artists.py) to the bundle + raw cache.
 *
 * Only `exact` and `fuzzy` matches (snapped to the known-artist
 * vocabulary) are applied automatically. `new` extractions are OCR
 * strings that matched no known artist - mostly credit text mangled
 * with flavor text - and stay in the report for manual review.
 *
 * Skips any card that already gained an artist from a later API pass.
 *
 * Usage: node scripts/apply-pokemon-artist-ocr.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BUNDLE = join(ROOT, 'src', 'lib', 'cards-pokemon.json')
const RAW = join(ROOT, 'data', 'pokemon-cards-raw.json')
const OCR = join(ROOT, 'data', 'pokemon-artist-ocr.json')

const results = JSON.parse(readFileSync(OCR, 'utf8')).results
const safe = results.filter((r) => r.artist && (r.kind === 'exact' || r.kind === 'fuzzy'))
console.log(`OCR results: ${results.length} · applying ${safe.length} exact/fuzzy matches`)

const artistById = new Map(safe.map((r) => [r.id, r.artist]))

const cards = JSON.parse(readFileSync(BUNDLE, 'utf8'))
let applied = 0
for (const c of cards) {
  const a = artistById.get(c.id)
  if (a && !c.artist) { c.artist = a; applied++ }
}
writeFileSync(BUNDLE, JSON.stringify(cards, null, 2))
console.log(`Applied ${applied} artists to bundle.`)

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
