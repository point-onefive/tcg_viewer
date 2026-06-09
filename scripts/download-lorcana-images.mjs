/**
 * Downloads Lorcana card images (official Ravensburger CDN JPGs, ~1468x2048)
 * and converts to webp via `cwebp` (install: brew install webp).
 *
 * Input:  data/lorcana-all-cards.json  (LorcanaJSON payload with images.full)
 * Output: public/cards-lorcana/lor-{id}.webp
 *
 * Skips cards already uploaded to R2 (data/uploaded-cards-lorcana.json
 * marker, written by upload-to-r2.mjs) and files already on disk.
 *
 * Usage: node scripts/download-lorcana-images.mjs
 *        node scripts/download-lorcana-images.mjs --quality=80 --concurrency=6
 */

import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync, unlinkSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { spawn } from 'child_process'
import os from 'os'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'lorcana-all-cards.json')
const OUT = join(ROOT, 'public', 'cards-lorcana')
const TMP = join(os.tmpdir(), 'lorcana-jpg-tmp')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.length ? rest.join('=') : true]
  })
)
const QUALITY = Number(args.quality ?? 82)
const CONCURRENCY = Number(args.concurrency ?? 5)
const DELAY_MS = Number(args.delay ?? 120)

const UA = 'Mozilla/5.0 (tcg_viewer lorcana fetch)'

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-lorcana-data.mjs first`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
mkdirSync(TMP, { recursive: true })

const UPLOAD_MARKER = join(ROOT, 'data', 'uploaded-cards-lorcana.json')
const alreadyOnR2 = existsSync(UPLOAD_MARKER)
  ? new Set(JSON.parse(readFileSync(UPLOAD_MARKER, 'utf8')).map((f) => f.replace(/\.webp$/, '')))
  : new Set()

const payload = JSON.parse(readFileSync(RAW, 'utf8'))
const jobs = (payload.cards ?? [])
  .map((c) => ({ id: `lor-${c.id}`, url: c.images?.full || c.images?.thumbnail }))
  .filter((j) => j.url)
  .filter((j) => !alreadyOnR2.has(j.id))

console.log(`Already on R2: ${alreadyOnR2.size}. Need to download ${jobs.length} images (quality=${QUALITY}, concurrency=${CONCURRENCY})`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function convertToWebp(srcPath, webpPath) {
  return new Promise((resolve, reject) => {
    const proc = spawn('cwebp', ['-q', String(QUALITY), '-quiet', srcPath, '-o', webpPath])
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
  const tmp = join(TMP, `${id}.jpg`)
  const res = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  writeFileSync(tmp, Buffer.from(await res.arrayBuffer()))
  try {
    await convertToWebp(tmp, dest)
  } finally {
    try { unlinkSync(tmp) } catch {}
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
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)))

console.log(`\nDone. ok=${done} skip=${skipped} fail=${failed}`)
