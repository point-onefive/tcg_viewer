/**
 * Downloads card images for one or every language we ingest.
 *
 * Two source modes:
 *   --zip            One-shot zip of EN images (~761 MB, fastest first-time).
 *                    Only useful for the EN catalogue; other languages are
 *                    CDN-only.
 *   --cdn            Per-card fetches from Bandai's regional CDN. Throttled
 *                    to 2 req/s. Pass --language=<lang> (en|jp|asia-en|tc|tw|all)
 *                    to control which region(s) to download.
 *
 * Output layout (under public/cards/):
 *
 *   public/cards/<printId>.png              # EN canonical (legacy, also written
 *                                             on first --language=en run)
 *   public/cards/jp/<printId>.png           # JP, if scraped
 *   public/cards/asia-en/<printId>.png      # Asia-EN, if scraped
 *   public/cards/tc/<printId>.png           # Traditional Chinese (HK/Macau)
 *   public/cards/tw/<printId>.png           # Traditional Chinese (Taiwan)
 *
 * Why a flat EN dir + per-language sub-dirs: the rest of the codebase
 * still hits `pub-...r2.dev/cards/<printId>.png` for the primary image,
 * and rewriting every reader would be wasteful. The per-language
 * subdirectories slot in on top.
 *
 * Source data: this script ALWAYS reads from data/by-language/<lang>.json
 * when --language=<lang> is set. For --language=en it also falls back to
 * data/cards.json so the original pre-Phase-7 single-language flow still
 * works.
 *
 * Examples:
 *   node scripts/download-images.mjs                       # zip mode, EN only (legacy)
 *   node scripts/download-images.mjs --cdn --language=jp   # JP -> public/cards/jp/
 *   node scripts/download-images.mjs --cdn --language=all  # sweep every region
 */

import { createWriteStream, mkdirSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CARDS_DIR = join(ROOT, 'public', 'cards')
const DATA_DIR = join(ROOT, 'data')
const BY_LANG_DIR = join(DATA_DIR, 'by-language')

const ZIP_URL = 'https://github.com/coko7/vegapull-records/releases/download/2025-04-27/english-images-2025-04-27.zip'
const ZIP_PATH = join(DATA_DIR, 'english-images.zip')

const CDN_DELAY_MS = 500

// Map --language= value to (source-file id, target subdir under public/cards).
// `null` subdir means "use the flat EN root", which is the legacy layout
// every existing R2 key uses.
const LANGUAGE_LAYOUTS = {
  en:        { sourceFile: 'en',      subDir: null      },
  jp:        { sourceFile: 'jp',      subDir: 'jp'      },
  'asia-en': { sourceFile: 'asia-en', subDir: 'asia-en' },
  tc:        { sourceFile: 'asia-tc', subDir: 'tc'      },
  tw:        { sourceFile: 'asia-tw', subDir: 'tw'      },
}

function parseArgs() {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, ...rest] = a.replace(/^--/, '').split('=')
      return [k, rest.length ? rest.join('=') : true]
    })
  )
  return {
    useCDN: !!args.cdn,
    useZip: !args.cdn,
    language: args.language || 'en',
  }
}

async function downloadZip() {
  console.log('Downloading image zip (~761MB) from GitHub releases...')
  console.log(`Destination: ${ZIP_PATH}`)
  console.log('This is a one-time download. Grab a coffee.')
  console.log()

  await execAsync(
    `curl -L --progress-bar -o "${ZIP_PATH}" "${ZIP_URL}"`,
    { stdio: 'inherit', maxBuffer: 10 * 1024 * 1024 }
  )

  console.log('\nExtracting...')
  mkdirSync(CARDS_DIR, { recursive: true })

  await execAsync(`unzip -o -j "${ZIP_PATH}" "*.png" -d "${CARDS_DIR}"`)

  console.log(`\nImages extracted to ${CARDS_DIR}`)
  console.log('Next step: upload to R2 with:')
  console.log(`  node scripts/upload-to-r2.mjs`)
}

function loadCards(language) {
  const layout = LANGUAGE_LAYOUTS[language]
  if (!layout) return []
  const file = join(BY_LANG_DIR, `${layout.sourceFile}.json`)
  if (existsSync(file)) {
    const rows = JSON.parse(readFileSync(file, 'utf8'))
    // Filter rows without an image URL or with placeholder/dummy URLs.
    return rows.filter((c) => c.img_full_url && !/dummy\.gif$/.test(c.img_full_url))
  }
  // Legacy fallback: pre-Phase-7, EN lived in data/cards.json
  if (language === 'en') {
    const legacy = join(DATA_DIR, 'cards.json')
    if (existsSync(legacy)) {
      const rows = JSON.parse(readFileSync(legacy, 'utf8'))
      return rows.filter((c) => c.img_full_url && !/dummy\.gif$/.test(c.img_full_url))
    }
  }
  return []
}

async function downloadOne(language) {
  const layout = LANGUAGE_LAYOUTS[language]
  if (!layout) {
    console.error(`Unknown language: ${language}. Allowed: ${[...Object.keys(LANGUAGE_LAYOUTS), 'all'].join(', ')}`)
    process.exit(1)
  }
  const cards = loadCards(language)
  if (cards.length === 0) {
    console.warn(`[${language}] No source data found. Run:  node scripts/fetch-card-data.mjs --language=${layout.sourceFile}`)
    return
  }

  const targetDir = layout.subDir ? join(CARDS_DIR, layout.subDir) : CARDS_DIR
  mkdirSync(targetDir, { recursive: true })

  console.log(`\n[${language}] Downloading ${cards.length} images at 2 req/s...`)
  console.log(`[${language}] Target: ${targetDir}`)
  console.log(`[${language}] Estimated time: ~${Math.ceil((cards.length * CDN_DELAY_MS) / 60000)} minutes`)

  let downloaded = 0
  let skipped = 0
  const failed = []

  for (let i = 0; i < cards.length; i++) {
    const card = cards[i]
    const dest = join(targetDir, `${card.id}.png`)

    if (existsSync(dest)) {
      skipped++
      continue
    }

    if (!card.img_full_url) {
      failed.push(card.id)
      continue
    }

    try {
      const res = await fetch(card.img_full_url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const arrayBuffer = await res.arrayBuffer()
      writeFileSync(dest, Buffer.from(arrayBuffer))
      downloaded++

      if (downloaded % 50 === 0) {
        console.log(`  [${language}] ${downloaded}/${cards.length - skipped} downloaded...`)
      }
    } catch (err) {
      console.warn(`  [${language}] FAILED ${card.id}: ${err.message}`)
      failed.push(card.id)
    }

    await new Promise((r) => setTimeout(r, CDN_DELAY_MS))
  }

  console.log(`\n[${language}] Done! ${downloaded} downloaded, ${skipped} skipped, ${failed.length} failed`)
  if (failed.length > 0) {
    console.warn(`[${language}] Failed: ${failed.slice(0, 20).join(', ')}${failed.length > 20 ? '...' : ''}`)
  }
}

async function main() {
  const { useCDN, useZip, language } = parseArgs()

  if (useZip) {
    return downloadZip()
  }

  if (language === 'all') {
    for (const lang of Object.keys(LANGUAGE_LAYOUTS)) {
      await downloadOne(lang)
    }
    return
  }

  return downloadOne(language)
}

main().catch((err) => { console.error(err); process.exit(1) })
