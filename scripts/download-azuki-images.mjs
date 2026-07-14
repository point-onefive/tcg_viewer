/**
 * Downloads Azuki TCG card images (.jpg) from the official CDN based on the
 * `image` URLs in data/azuki-cards-raw.json.
 *
 * Output: public/cards-azuki/{CARD_ID}.jpg
 *
 * Usage: node scripts/download-azuki-images.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'azuki-cards-raw.json')
const OUT = join(ROOT, 'public', 'cards-azuki')

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const CONCURRENCY = 5
const DELAY_MS = 150

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-azuki-data.mjs first`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const raw = JSON.parse(readFileSync(RAW, 'utf8'))
const jobs = raw
  .filter((c) => c.id && c.image)
  .map((c) => ({ id: c.id, url: c.image }))
console.log(`Need to download ${jobs.length} images`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function downloadOne(job) {
  const dest = join(OUT, `${job.id}.jpg`)
  if (existsSync(dest) && statSync(dest).size > 1024) return 'skip'
  const res = await fetch(job.url, { headers: { 'User-Agent': UA, Referer: 'https://tcg.azuki.com/gallery' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const buf = Buffer.from(await res.arrayBuffer())
  writeFileSync(dest, buf)
  return 'ok'
}

let done = 0
let skipped = 0
let failed = 0

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
