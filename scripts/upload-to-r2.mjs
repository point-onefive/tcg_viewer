/**
 * Uploads all card images from public/cards/ to Cloudflare R2.
 * Uses the Cloudflare REST API with the API token from .env.local.
 *
 * Uploads with concurrency=20 for speed without hammering the API.
 *
 * Usage: node scripts/upload-to-r2.mjs
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const IMAGES_DIR = join(ROOT, 'public', 'cards')

// Load .env.local
function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) {
    console.error('.env.local not found')
    process.exit(1)
  }
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) env[k.trim()] = v.join('=').trim()
  }
  return env
}

const env = loadEnv()
const ACCOUNT_ID = env.CLOUDFLARE_ACCOUNT_ID
const TOKEN = env.CLOUDFLARE_API_TOKEN
const BUCKET = env.R2_BUCKET

if (!ACCOUNT_ID || !TOKEN || !BUCKET) {
  console.error('Missing CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN, or R2_BUCKET in .env.local')
  process.exit(1)
}

if (!existsSync(IMAGES_DIR)) {
  console.error(`Images dir not found: ${IMAGES_DIR}`)
  console.error('Run: node scripts/download-images.mjs first')
  process.exit(1)
}

const BASE_URL = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects`

async function uploadFile(filename, retries = 4) {
  const filepath = join(IMAGES_DIR, filename)
  const key = `cards/${filename}`
  const body = readFileSync(filepath)

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(1000 * 2 ** attempt, 16000)
      await new Promise(r => setTimeout(r, delay))
    }

    const res = await fetch(`${BASE_URL}/${key}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${TOKEN}`,
        'Content-Type': 'image/png',
      },
      body,
    })

    if (res.ok) return
    if (res.status === 429 || res.status === 502 || res.status === 503) {
      if (attempt === retries) throw new Error(`HTTP ${res.status} after ${retries + 1} attempts`)
      continue // retry
    }
    const text = await res.text()
    throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
  }
}

async function runWithConcurrency(tasks, concurrency) {
  const results = { ok: 0, failed: [] }
  let index = 0

  async function worker() {
    while (index < tasks.length) {
      const i = index++
      const task = tasks[i]
      try {
        await task()
        results.ok++
        if (results.ok % 100 === 0) {
          process.stdout.write(`  ${results.ok}/${tasks.length} uploaded...\n`)
        }
      } catch (err) {
        results.failed.push({ i, err: err.message })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker))
  return results
}

async function main() {
  const allFiles = readdirSync(IMAGES_DIR).filter(f => f.endsWith('.png'))

  // Check which files already exist in R2 via HEAD - skip them to resume safely
  // For speed: skip the HEAD check and use a local marker file instead
  const DONE_FILE = join(ROOT, 'data', 'uploaded.json')
  const done = new Set(existsSync(DONE_FILE) ? JSON.parse(readFileSync(DONE_FILE, 'utf8')) : [])

  const files = allFiles.filter(f => !done.has(f))
  console.log(`${done.size} already uploaded, ${files.length} remaining of ${allFiles.length} total`)
  console.log(`Uploading with concurrency=5 + exponential backoff...`)
  console.log()

  const tasks = files.map(f => async () => {
    await uploadFile(f)
    done.add(f)
  })

  const start = Date.now()
  const { ok, failed } = await runWithConcurrency(tasks, 5)
  const elapsed = ((Date.now() - start) / 1000).toFixed(1)

  // Save progress
  writeFileSync(DONE_FILE, JSON.stringify([...done], null, 0))

  console.log(`\nDone in ${elapsed}s: ${ok} uploaded, ${failed.length} failed`)
  if (failed.length > 0) {
    console.warn('Failed uploads:')
    failed.slice(0, 10).forEach(({ i, err }) => console.warn(`  ${files[i]}: ${err}`))
    if (failed.length > 10) console.warn(`  ...and ${failed.length - 10} more`)
    console.warn('\nRe-run this script to retry failures.')
  } else {
    console.log(`\nAll images live at: ${env.R2_PUBLIC_URL}/cards/{CARD_ID}.png`)
  }
}

main().catch(err => { console.error(err); process.exit(1) })
