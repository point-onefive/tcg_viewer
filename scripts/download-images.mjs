/**
 * Downloads all card images for cards listed in data/cards.json.
 *
 * Two modes:
 *   --zip  (default)  Download the pre-built zip from GitHub releases (761MB, fastest, safest)
 *   --cdn             Download images one-by-one from Bandai CDN with throttling (slow, ~40min)
 *
 * After downloading, images land in public/cards/{CARD_ID}.png
 * Upload to R2 with: wrangler r2 object put-bulk --bucket=<your-bucket> public/cards/
 *
 * Usage:
 *   node scripts/download-images.mjs          # uses zip method
 *   node scripts/download-images.mjs --cdn    # uses CDN method
 */

import { createWriteStream, mkdirSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { pipeline } from 'stream/promises'
import { createGunzip } from 'zlib'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CARDS_DIR = join(ROOT, 'public', 'cards')
const DATA_DIR = join(ROOT, 'data')

const ZIP_URL = 'https://github.com/coko7/vegapull-records/releases/download/2025-04-27/english-images-2025-04-27.zip'
const ZIP_PATH = join(DATA_DIR, 'english-images.zip')

// Throttle: requests per second when using --cdn mode
const CDN_DELAY_MS = 500 // 2 req/s - well under any rate limit

async function downloadZip() {
  console.log('Downloading image zip (~761MB) from GitHub releases...')
  console.log(`Destination: ${ZIP_PATH}`)
  console.log('This is a one-time download. Grab a coffee.')
  console.log()

  // Use curl with progress bar
  await execAsync(
    `curl -L --progress-bar -o "${ZIP_PATH}" "${ZIP_URL}"`,
    { stdio: 'inherit', maxBuffer: 10 * 1024 * 1024 }
  )

  console.log('\nExtracting...')
  mkdirSync(CARDS_DIR, { recursive: true })

  // unzip and flatten (all images are in a flat directory in the zip)
  await execAsync(`unzip -o -j "${ZIP_PATH}" "*.png" -d "${CARDS_DIR}"`)

  console.log(`\nImages extracted to ${CARDS_DIR}`)
  console.log('Next step: upload to R2 with:')
  console.log(`  wrangler r2 object put-bulk --bucket=<your-bucket> --prefix=cards/ ${CARDS_DIR}`)
}

async function fetchJSON(path) {
  const { readFileSync } = await import('fs')
  return JSON.parse(readFileSync(path, 'utf8'))
}

async function downloadFromCDN() {
  if (!existsSync(join(DATA_DIR, 'cards.json'))) {
    console.error('data/cards.json not found. Run: node scripts/fetch-card-data.mjs first')
    process.exit(1)
  }

  const cards = await fetchJSON(join(DATA_DIR, 'cards.json'))
  mkdirSync(CARDS_DIR, { recursive: true })

  console.log(`Downloading ${cards.length} images from Bandai CDN at 2 req/s...`)
  console.log(`Estimated time: ~${Math.ceil((cards.length * CDN_DELAY_MS) / 60000)} minutes`)
  console.log()

  let downloaded = 0
  let skipped = 0
  let failed = []

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const dest = join(CARDS_DIR, `${card.id}.png`)

    // Skip already downloaded
    if (existsSync(dest)) {
      skipped++
      continue
    }

    try {
      const res = await fetch(card.img_full_url)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const arrayBuffer = await res.arrayBuffer()
      writeFileSync(dest, Buffer.from(arrayBuffer))
      downloaded++

      if (downloaded % 50 === 0) {
        console.log(`  ${downloaded}/${cards.length - skipped} downloaded...`)
      }
    } catch (err) {
      console.warn(`  FAILED ${card.id}: ${err.message}`)
      failed.push(card.id)
    }

    // Throttle
    await new Promise((r) => setTimeout(r, CDN_DELAY_MS))
  }

  console.log(`\nDone! ${downloaded} downloaded, ${skipped} skipped, ${failed.length} failed`)
  if (failed.length > 0) {
    console.warn('Failed:', failed.join(', '))
  }
  console.log(`\nImages in: ${CARDS_DIR}`)
  console.log('Next step: upload to R2 with:')
  console.log(`  wrangler r2 object put-bulk --bucket=<your-bucket> --prefix=cards/ ${CARDS_DIR}`)
}

const useCDN = process.argv.includes('--cdn')
if (useCDN) {
  downloadFromCDN().catch((err) => { console.error(err); process.exit(1) })
} else {
  downloadZip().catch((err) => { console.error(err); process.exit(1) })
}
