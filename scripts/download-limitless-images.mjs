/**
 * Download the Limitless-supplied WebP images and convert them to
 * PNG so they live alongside the Bandai-pulled PNGs in `public/cards/`.
 *
 * Reads any row in data/cards.json with `source === 'limitless'` and
 * `img_full_url` pointing at the Limitless CDN. Skips downloads when
 * the destination PNG already exists (resumable).
 *
 * Why convert: the existing bundle URLs are hard-coded to `.png`
 * (see generate-card-data.mjs: `${IMAGE_BASE}/${id}.png`). Rather
 * than introduce per-variant URL overrides, we normalise the file
 * format at ingest. PNGs are slightly bigger on disk but the gallery
 * already serves PNGs for everything else, so this keeps R2 keys,
 * cache rules, and the download-images.mjs zip workflow uniform.
 *
 * Requires `dwebp` (libwebp) on $PATH -- already present on dev
 * machines that have run other ingestion scripts. Falls back to
 * `magick`/`convert` (ImageMagick) if dwebp is missing.
 *
 * Throttle: 300ms between requests. Total ~40s for 123 images.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const CARDS_PATH = join(ROOT, 'data', 'cards.json')
const CARDS_DIR = join(ROOT, 'public', 'cards')
const TMP_DIR = join(ROOT, 'data', 'limitless', 'webp')

const THROTTLE_MS = 300
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function which(cmd) {
  try { execSync(`command -v ${cmd}`, { stdio: 'pipe' }); return true } catch { return false }
}

const haveDwebp = which('dwebp')
const haveMagick = which('magick')
const haveConvert = which('convert')
if (!haveDwebp && !haveMagick && !haveConvert) {
  console.error('Need dwebp (libwebp) or magick (ImageMagick). Install with:')
  console.error('  brew install webp        # gets dwebp')
  console.error('  brew install imagemagick # gets magick / convert')
  process.exit(1)
}

function convertWebpToPng(srcWebp, destPng) {
  if (haveDwebp) {
    execSync(`dwebp -quiet "${srcWebp}" -o "${destPng}"`)
  } else if (haveMagick) {
    execSync(`magick "${srcWebp}" "${destPng}"`)
  } else {
    execSync(`convert "${srcWebp}" "${destPng}"`)
  }
}

async function main() {
  if (!existsSync(CARDS_DIR)) mkdirSync(CARDS_DIR, { recursive: true })
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true })

  const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf8'))
  const todo = cards.filter((c) => c.source === 'limitless' && c.img_full_url)
  console.log(`${todo.length} limitless cards in data/cards.json`)

  let downloaded = 0
  let skipped = 0
  let failed = []

  for (let i = 0; i < todo.length; i++) {
    const c = todo[i]
    const destPng = join(CARDS_DIR, `${c.id}.png`)
    if (existsSync(destPng)) { skipped++; continue }

    const tmpWebp = join(TMP_DIR, `${c.id}.webp`)
    try {
      const res = await fetch(c.img_full_url, { headers: { 'User-Agent': 'Mozilla/5.0' } })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const buf = Buffer.from(await res.arrayBuffer())
      writeFileSync(tmpWebp, buf)

      convertWebpToPng(tmpWebp, destPng)
      unlinkSync(tmpWebp)
      downloaded++
      if (downloaded % 20 === 0) {
        console.log(`  [${downloaded}/${todo.length - skipped}] last: ${c.id}`)
      }
    } catch (err) {
      console.warn(`  FAIL ${c.id}: ${err.message}`)
      failed.push({ id: c.id, err: err.message })
    }
    await sleep(THROTTLE_MS)
  }

  console.log(`\nDone. downloaded=${downloaded} skipped=${skipped} failed=${failed.length}`)
  if (failed.length) {
    console.log('Failures:')
    for (const f of failed) console.log(`  ${f.id}: ${f.err}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
