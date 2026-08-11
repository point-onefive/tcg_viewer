/**
 * R2 image audit: verifies that every R2-hosted image URL referenced by
 * the shipped card bundles actually resolves on the CDN.
 *
 * Read-only. No bundle is modified, nothing is uploaded. Prints a
 * summary per collection and writes the full missing-URL list to
 * data/r2-image-audit.json (data/ is gitignored).
 *
 * Why this exists: the generators bake R2 URLs into the bundles at
 * generate time, but the image download + `r2:upload` steps are
 * separate. When those steps are skipped (or partially fail) for a
 * batch of prints, the bundle ships URLs that 404. The wall and
 * lightbox fall back to Bandai's regional CDNs where possible, but
 * prints without an alternate source render as empty frames. Run this
 * after any catalog refresh, and before events that will drive traffic.
 *
 * Usage:
 *   node scripts/audit-r2-images.mjs                 # all collections
 *   node scripts/audit-r2-images.mjs one-piece       # one collection
 *   node scripts/audit-r2-images.mjs pokemon lorcana # subset
 *
 * The public r2.dev endpoint rate-limits aggressively, so the sweep
 * runs at low concurrency with backoff. A full run over every
 * collection takes several minutes.
 */

import { createRequire } from 'module'
import { writeFileSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const require = createRequire(import.meta.url)
const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const R2_HOST = 'pub-6d5072ccd26a467db70791436c203abb.r2.dev'
const COLLECTIONS = ['one-piece', 'pokemon', 'dbs', 'digimon', 'gundam', 'lorcana']
const CONCURRENCY = 6
const MAX_RETRIES = 6

const requested = process.argv.slice(2)
const targets = requested.length
  ? COLLECTIONS.filter((c) => requested.includes(c))
  : COLLECTIONS

if (requested.length && targets.length !== requested.length) {
  const unknown = requested.filter((c) => !COLLECTIONS.includes(c))
  console.error(`Unknown collection(s): ${unknown.join(', ')}`)
  console.error(`Valid: ${COLLECTIONS.join(', ')}`)
  process.exit(1)
}

function isR2(url) {
  return typeof url === 'string' && url.includes(R2_HOST)
}

/** Collect every R2 URL a card entry can surface in the UI. */
function collectUrls(entry, out) {
  for (const key of ['imageUrl', 'imageSmall', 'imageLarge']) {
    if (isR2(entry[key])) out.add(entry[key])
  }
  for (const u of Object.values(entry.imagesByLanguage ?? {})) {
    if (isR2(u)) out.add(u)
  }
  for (const v of entry.variants ?? []) collectUrls(v, out)
}

async function headWithBackoff(url) {
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url, { method: 'HEAD' })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 800 * (attempt + 1)))
        continue
      }
      return res.status
    } catch {
      await new Promise((r) => setTimeout(r, 500))
    }
  }
  return 'unreachable'
}

async function sweep(urls, label) {
  const missing = []
  let done = 0
  let cursor = 0
  const list = [...urls]

  async function worker() {
    while (cursor < list.length) {
      const url = list[cursor++]
      const status = await headWithBackoff(url)
      if (status !== 200) missing.push({ status, url })
      done++
      if (done % 500 === 0) {
        console.log(`  ${label}: ${done}/${list.length} checked, ${missing.length} missing`)
      }
      await new Promise((r) => setTimeout(r, 60))
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  return missing.sort((a, b) => a.url.localeCompare(b.url))
}

const report = { auditedAt: new Date().toISOString(), collections: {} }
let totalMissing = 0

for (const collection of targets) {
  let bundle
  try {
    bundle = require(join(ROOT, 'src', 'lib', `cards-${collection}.json`))
  } catch {
    console.log(`- ${collection}: no bundle, skipped`)
    continue
  }
  const cards = Array.isArray(bundle) ? bundle : bundle.cards ?? Object.values(bundle)
  const urls = new Set()
  for (const card of cards) collectUrls(card, urls)

  console.log(`\n${collection}: checking ${urls.size} R2 urls`)
  const missing = await sweep(urls, collection)
  totalMissing += missing.length
  report.collections[collection] = {
    checked: urls.size,
    missing: missing.length,
    urls: missing,
  }
  console.log(`  ${collection}: ${missing.length} missing of ${urls.size}`)
  for (const { status, url } of missing.slice(0, 15)) {
    console.log(`    ${status} ${url.split('/').pop()}`)
  }
  if (missing.length > 15) console.log(`    ... ${missing.length - 15} more (see data/r2-image-audit.json)`)
}

mkdirSync(join(ROOT, 'data'), { recursive: true })
const outPath = join(ROOT, 'data', 'r2-image-audit.json')
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`\nTotal missing: ${totalMissing}. Full report: ${outPath}`)
process.exit(totalMissing > 0 ? 1 : 0)
