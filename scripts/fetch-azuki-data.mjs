/**
 * Fetches the Azuki TCG card catalog from the official gallery API.
 * Source: https://tcg.azuki.com/api/cards
 *
 * The gallery is a Next.js SPA that loads its full card list from a single
 * public JSON endpoint, so a single bulk GET is all we need (no per-card
 * crawling). We fetch politely once and cache the raw payload.
 *
 * Output: data/azuki-cards-raw.json (feeds into generate-azuki-data.mjs)
 *
 * Usage: node scripts/fetch-azuki-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const OUT = join(DATA_DIR, 'azuki-cards-raw.json')

const URL = 'https://tcg.azuki.com/api/cards'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

console.log(`Fetching ${URL} …`)
const res = await fetch(URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
if (!res.ok) {
  console.error(`HTTP ${res.status} ${URL}`)
  process.exit(1)
}
const payload = await res.json()
const cards = Array.isArray(payload) ? payload : payload.cards ?? []
if (!cards.length) {
  console.error('No cards found in response - the API shape may have changed.')
  process.exit(1)
}

mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(OUT, JSON.stringify(cards, null, 2))

console.log(`Done. ${cards.length} cards written to ${OUT}`)
