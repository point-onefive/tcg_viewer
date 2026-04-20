/**
 * Fetches all One Piece TCG card data from the vegapull-records GitHub dataset.
 * Source: https://github.com/coko7/vegapull-records
 * Data is scraped from the official Bandai site (en.onepiece-cardgame.com).
 *
 * Output: data/cards.json  - array of all cards, all packs merged
 *         data/packs.json  - pack metadata
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

// Full coverage: pull every pack the dataset exposes. This includes retail
// boosters, starters, extras, premium boosters, AND the promo / Premium Bandai
// exclusive buckets (Promotion Card, Other Product Card, gift collections,
// best collection, memorial collection, etc.).
//
// If a specific pack turns out to be empty or broken upstream, add its id here.
const EXCLUDE_PACK_IDS = new Set([])

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

  const packs = allPacks.filter((p) => !EXCLUDE_PACK_IDS.has(p.id))

  console.log(`Found ${packs.length} packs to fetch (of ${allPacks.length} total)`)
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
        // Clean image URL without the cache-buster - we'll host these on R2
        img_path: `cards/${c.id}.png`,
        // Keep full URL as fallback during development
        img_full_url: c.img_full_url,
        // Source pack metadata so the generator can bucket promos / exclusives
        // into meaningful set labels even when the card ID prefix is ambiguous.
        source_pack_id: pack.id,
        source_pack_prefix: pack.title_parts?.prefix ?? null,
        source_pack_label: pack.title_parts?.label ?? null,
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
