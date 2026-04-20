/**
 * Fetches all One Piece TCG card data from the vegapull-records GitHub dataset.
 * Source: https://github.com/coko7/vegapull-records
 * Data is scraped from the official Bandai site (en.onepiece-cardgame.com).
 *
 * Output: data/cards.json  — array of all cards, all packs merged
 *         data/packs.json  — pack metadata
 *
 * Usage: node scripts/fetch-card-data.mjs
 */

import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')

const BASE_URL = 'https://raw.githubusercontent.com/coko7/vegapull-records/main/data/english'
const PACKS_URL = `${BASE_URL}/packs.json`

// Packs to include — main boosters + starters + extras
// Excludes promo (569901) and "Other Product Card" (569801) which are inconsistent
const INCLUDE_PREFIXES = ['BOOSTER PACK', 'STARTER DECK', 'EXTRA BOOSTER', 'PREMIUM BOOSTER', 'ULTRA DECK', 'STARTER DECK EX']

async function fetchJSON(url) {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`)
  return res.json()
}

/** Small delay to be polite to GitHub's raw CDN */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  console.log('Fetching pack list...')
  const allPacks = await fetchJSON(PACKS_URL)

  const packs = allPacks.filter((p) => {
    if (!p.title_parts.prefix) return false
    return INCLUDE_PREFIXES.includes(p.title_parts.prefix)
  })

  console.log(`Found ${packs.length} packs to fetch`)
  writeFileSync(join(DATA_DIR, 'packs.json'), JSON.stringify(packs, null, 2))

  const allCards = []
  let failed = []

  for (let i = 0; i < packs.length; i++) {
    const pack = packs[i]
    const url = `${BASE_URL}/cards_${pack.id}.json`
    process.stdout.write(`[${i + 1}/${packs.length}] ${pack.title_parts.label} (${pack.id})... `)

    try {
      const cards = await fetchJSON(url)
      // Normalise image URL: strip cache-busting query param, keep clean path
      const normalised = cards.map((c) => ({
        ...c,
        // Clean image URL without the cache-buster — we'll host these on R2
        img_path: `cards/${c.id}.png`,
        // Keep full URL as fallback during development
        img_full_url: c.img_full_url,
      }))
      allCards.push(...normalised)
      console.log(`${cards.length} cards`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed.push(pack)
    }

    // Be polite: 200ms between requests
    if (i < packs.length - 1) await sleep(200)
  }

  writeFileSync(join(DATA_DIR, 'cards.json'), JSON.stringify(allCards, null, 2))

  console.log(`\nDone! ${allCards.length} total cards written to data/cards.json`)

  if (failed.length > 0) {
    console.warn(`\nFailed packs (${failed.length}):`)
    failed.forEach((p) => console.warn(`  - ${p.title_parts.label} (${p.id})`))
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
