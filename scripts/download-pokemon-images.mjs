/**
 * Downloads Pokémon card images from pokemontcg.io and converts to webp
 * using the `cwebp` binary (install: brew install webp).
 *
 * Input:  data/pokemon-cards-raw.json  (cards with images.large / images.small)
 * Output: public/cards-pokemon/{id}.webp
 *
 * Per-image flow:
 *   1. fetch images.large (hires PNG, ~900KB)
 *   2. pipe through cwebp -q 82 -> {id}.webp (~350KB)
 *   3. discard PNG
 *
 * Usage: node scripts/download-pokemon-images.mjs
 *        node scripts/download-pokemon-images.mjs --quality=80 --concurrency=6
 */

import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'pokemon-cards-raw.json')
const OUT = join(ROOT, 'public', 'cards-pokemon')
const TMP = join(os.tmpdir(), 'pokemon-png-tmp')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.length ? rest.join('=') : true]
  })
)
const QUALITY = Number(args.quality ?? 82)
const CONCURRENCY = Number(args.concurrency ?? 5)
const DELAY_MS = Number(args.delay ?? 120)
const USE_SMALL = !!args.small // optional: download thumbnails instead of hires

const UA = 'Mozilla/5.0 (tcg_viewer pokemon fetch)'

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-pokemon-data.mjs first`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

// Skip cards already uploaded to R2: the upload marker is git-tracked and
// authoritative for "this image lives on the CDN". On a cold-cache CI run
// this avoids re-downloading 20K PNGs from pokemontcg.io just to re-upload
// the same webps to R2. Only genuinely new cards (alt arts, new sets) hit
// the network.
const UPLOAD_MARKER = join(ROOT, 'data', 'uploaded-cards-pokemon.json')
const alreadyOnR2 = existsSync(UPLOAD_MARKER)
  ? new Set(JSON.parse(readFileSync(UPLOAD_MARKER, 'utf8')).map((f) => f.replace(/\.webp$/, '')))
  : new Set()

const raw = JSON.parse(readFileSync(RAW, 'utf8'))
const jobs = raw
  .map((c) => ({
    id: c.id,
    url: USE_SMALL ? c.images?.small : (c.images?.large || c.images?.small),
  }))
  .filter((j) => j.id && j.url)
  .filter((j) => !alreadyOnR2.has(j.id)) // <- delta: only what's not on R2 yet

console.log(`Already on R2: ${alreadyOnR2.size}. Need to download ${jobs.length} new images (quality=${QUALITY}, concurrency=${CONCURRENCY})`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function convertPngToWebp(pngPath, webpPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cwebp', ['-q', String(QUALITY), '-quiet', pngPath, '-o', webpPath])
    let err = ''
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`cwebp exit ${code}: ${err.trim()}`))
    })
    proc.on('error', reject)
  })
}

async function downloadOne({ id, url }) {
  const dest = join(OUT, `${id}.webp`)
  if (existsSync(dest) && statSync(dest).size > 1024) return 'skip'
  const pngTmp = join(TMP, `${id.replace(/[^a-z0-9-]/gi, '_')}.png`)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(pngTmp, buf)
  try {
    await convertPngToWebp(pngTmp, dest)
  } finally {
    try { unlinkSync(pngTmp) } catch {}
  }
  return 'ok'
}

let done = 0, skipped = 0, failed = 0

async function worker(queue) {
  while (queue.length) {
    const job = queue.shift()
    if (!job) return
    try {
      const r = await downloadOne(job)
      if (r === 'skip') skipped++
      else done++
      if ((done + skipped) % 25 === 0) {
        process.stdout.write(`  ${done + skipped}/${jobs.length} (ok=${done} skip=${skipped} fail=${failed})\r`)
      }
    } catch (err) {
      failed++
      console.log(`\n  FAILED ${job.id}: ${err.message}`)
    }
    await sleep(DELAY_MS)
  }
}

const queue = [...jobs]
const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
await Promise.all(workers)

console.log(`\nDone. ok=${done} skip=${skipped} fail=${failed}`)
