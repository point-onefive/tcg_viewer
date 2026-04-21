/**
 * Downloads DBS Fusion World card images (.webp) from the official Bandai CDN
 * based on the image filenames captured in data/dbs-cards-raw.json.
 *
 * Each record has detail.images[] which is the list of webp filenames that
 * actually exist for that card (e.g. ["FB01-001_f.webp","FB01-001_b.webp"] for
 * leaders, ["FB09-005_p1.webp"] for a parallel battle card).
 *
 * Output: public/cards-dbs/{FILENAME}.webp
 *
 * Usage: node scripts/download-dbs-images.mjs
 */

import { readFileSync, existsSync, mkdirSync, statSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RAW = join(ROOT, 'data', 'dbs-cards-raw.json')
const OUT = join(ROOT, 'public', 'cards-dbs')

const BASE = 'https://www.dbs-cardgame.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
const CONCURRENCY = 5
const DELAY_MS = 150

if (!existsSync(RAW)) {
  console.error(`${RAW} not found. Run: node scripts/fetch-dbs-data.mjs first`)
  process.exit(1)
}

mkdirSync(OUT, { recursive: true })
const raw = JSON.parse(readFileSync(RAW, 'utf8'))

// Flatten: every unique image filename referenced by any card.
const filenames = new Set()
for (const c of raw) {
  if (Array.isArray(c.images)) {
    for (const f of c.images) if (f && !/noimage/i.test(f)) filenames.add(f)
  }
}
const list = Array.from(filenames).sort()
console.log(`Need to download ${list.length} images`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function downloadOne(filename) {
  const dest = join(OUT, filename)
  if (existsSync(dest) && statSync(dest).size > 1024) return 'skip'
  const url = `${BASE}/fw/images/cards/card/en/${filename}`
  const res = await fetch(url, { headers: { 'User-Agent': UA, Referer: `${BASE}/fw/en/cardlist/` } })
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
    const f = queue.shift()
    if (!f) return
    try {
      const r = await downloadOne(f)
      if (r === 'skip') skipped++
      else done++
      if ((done + skipped) % 25 === 0) {
        process.stdout.write(`  ${done + skipped}/${list.length} (ok=${done} skip=${skipped} fail=${failed})\r`)
      }
    } catch (err) {
      failed++
      console.log(`\n  FAILED ${f}: ${err.message}`)
    }
    await sleep(DELAY_MS)
  }
}

const queue = [...list]
const workers = Array.from({ length: CONCURRENCY }, () => worker(queue))
await Promise.all(workers)

console.log(`\nDone. ok=${done} skip=${skipped} fail=${failed}`)
