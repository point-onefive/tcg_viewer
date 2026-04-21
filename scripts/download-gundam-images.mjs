/**
 * Downloads Gundam card images (.webp) from the official Bandai CDN
 * based on the IDs in data/gundam-cards-raw.json.
 *
 * Output: public/cards-gundam/{CARD_ID}.webp
 *
 * Usage: node scripts/download-gundam-images.mjs
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'gundam-cards-raw.json')
const OUT = join(ROOT, 'public', 'cards-gundam')

const BASE = 'https://www.gundam-gcg.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const CONCURRENCY = 5
const DELAY_MS = 200

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-gundam-data.mjs first`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const raw = JSON.parse(readFileSync(RAW, 'utf8'))
const ids = raw.map((c) => c.id)
console.log(`Need to download ${ids.length} images`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function downloadOne(id) {
  const dest = join(OUT, `${id}.webp`)
  if (existsSync(dest) && statSync(dest).size > 1024) return 'skip'
  const url = `${BASE}/en/images/cards/card/${id}.webp`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `${BASE}/en/cards/` } })
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
    const id = queue.shift()
    if (!id) return
    try {
      const r = await downloadOne(id)
      if (r === 'skip') skipped++
      else done++
      if ((done + skipped) % 25 === 0) {
        process.stdout.write(`  ${done + skipped}/${ids.length} (ok=${done} skip=${skipped} fail=${failed})\r`)
      }
    } catch (err) {
      failed++
      console.log(`\n  FAILED ${id}: ${err.message}`)
    }
    await sleep(DELAY_MS)
  }
}

const queue = [...ids]
const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
await Promise.all(workers)

console.log(`\nDone. ok=${done} skip=${skipped} fail=${failed}`)
