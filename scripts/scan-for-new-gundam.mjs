#!/usr/bin/env node
/**
 * Scan gundam-gcg.com for net-new Gundam Card Game prints not yet in
 * src/lib/cards-gundam.json and write a report to data/scan-report-gundam.{json,md}.
 *
 * Mirrors the One Piece `scan-for-new-cards.mjs` pattern:
 *   - Read-only. Never modifies the bundle.
 *   - Diffs the live Bandai site against our deployed cards-gundam.json.
 *   - Reports net-new base card IDs AND net-new variant IDs separately.
 *
 * Usage:
 *   npm run gundam:scan
 *   node scripts/scan-for-new-gundam.mjs
 *
 * After running, read data/scan-report-gundam.md for a human summary,
 * then run `npm run gundam:fetch && npm run gundam:generate` to ingest
 * approved new prints.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const BASE = 'https://www.gundam-gcg.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

mkdirSync(DATA_DIR, { recursive: true })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url, init = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, ...init.headers },
    ...init,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

// ── Load deployed bundle ─────────────────────────────────────────────────────
const bundlePath = join(ROOT, 'src', 'lib', 'cards-gundam.json')
const bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'))
const bundleBaseIds = new Set(bundle.map((c) => c.id))
const bundleVariantIds = new Set(
  bundle.flatMap((c) => (c.variants ?? []).map((v) => v.id))
)
const allBundleIds = new Set([...bundleBaseIds, ...bundleVariantIds])
console.log(`Deployed bundle: ${bundle.length} base cards, ${bundleVariantIds.size} variants`)

// ── Fetch pack list ──────────────────────────────────────────────────────────
console.log('\nFetching pack list from gundam-gcg.com/en/cards/ …')
const indexHtml = await fetchText(`${BASE}/en/cards/`)
const packRe = /data-val="(\d+)"[^>]*>([^<]+)<\/a>/g
const packs = []
let m
while ((m = packRe.exec(indexHtml))) {
  const [, code, label] = m
  if (code) packs.push({ code, label: label.trim() })
}
// Deduplicate by code (the HTML repeats the list twice)
const seenCodes = new Set()
const uniquePacks = packs.filter((p) => {
  if (seenCodes.has(p.code)) return false
  seenCodes.add(p.code)
  return true
})
console.log(`  Found ${uniquePacks.length} packs`)

// ── Scan each pack for card IDs ──────────────────────────────────────────────
console.log('\nScanning card IDs per pack …')
const liveIds = new Set()
const perPack = []

for (const pack of uniquePacks) {
  const body = new URLSearchParams({ search: 'true', package: pack.code, freeword: '' }).toString()
  try {
    const html = await fetchText(`${BASE}/en/cards/index.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    const idRe = /detailSearch=([A-Z]{2,3}\d{2}-\d{3}(?:_[pr]\d+)?)/g
    const ids = new Set()
    let idMatch
    while ((idMatch = idRe.exec(html))) ids.add(idMatch[1])
    for (const id of ids) liveIds.add(id)
    perPack.push({ pack: pack.label, count: ids.size, ids: [...ids] })
    process.stdout.write(`  ✓ ${pack.label.slice(0, 40).padEnd(40)}  ${ids.size} cards\n`)
  } catch (err) {
    process.stdout.write(`  ✗ ${pack.label.slice(0, 40).padEnd(40)}  ERROR: ${err.message}\n`)
    perPack.push({ pack: pack.label, count: 0, ids: [], error: err.message })
  }
  await sleep(400)
}

// ── Diff ─────────────────────────────────────────────────────────────────────
const newBaseIds = []
const newVariantIds = []

for (const id of liveIds) {
  if (allBundleIds.has(id)) continue
  // Determine if it's a base card or a variant
  const isVariant = /_[pr]\d+$/.test(id)
  if (isVariant) newVariantIds.push(id)
  else newBaseIds.push(id)
}

newBaseIds.sort()
newVariantIds.sort()

// ── Report ────────────────────────────────────────────────────────────────────
const scannedAt = new Date().toISOString()

console.log(`\n━━━ Results ━━━`)
console.log(`  Live IDs on site:    ${liveIds.size}`)
console.log(`  Already in bundle:   ${[...liveIds].filter((id) => allBundleIds.has(id)).length}`)
console.log(`  Net-new base cards:  ${newBaseIds.length}`)
console.log(`  Net-new variants:    ${newVariantIds.length}`)

if (newBaseIds.length) {
  console.log(`\n  New base cards:`)
  for (const id of newBaseIds) console.log(`    + ${id}`)
}
if (newVariantIds.length) {
  console.log(`\n  New variants (first 20):`)
  for (const id of newVariantIds.slice(0, 20)) console.log(`    + ${id}`)
  if (newVariantIds.length > 20)
    console.log(`    … and ${newVariantIds.length - 20} more`)
}

// ── Write report files ────────────────────────────────────────────────────────
const report = {
  scannedAt,
  bundleBaseCount: bundle.length,
  bundleVariantCount: bundleVariantIds.size,
  liveCount: liveIds.size,
  newBaseIds,
  newVariantIds,
  perPack,
}
writeFileSync(join(DATA_DIR, 'scan-report-gundam.json'), JSON.stringify(report, null, 2))

// Markdown summary
const md = `# Gundam Card Game — Scan Report
**Scanned:** ${scannedAt}

## Summary
| | Count |
|---|---|
| Bundle base cards | ${bundle.length} |
| Bundle variants | ${bundleVariantIds.size} |
| Live IDs on site | ${liveIds.size} |
| Net-new base cards | ${newBaseIds.length} |
| Net-new variants | ${newVariantIds.length} |

${newBaseIds.length === 0 && newVariantIds.length === 0 ? '✅ Bundle is up to date — no new prints found.\n' : ''}
${newBaseIds.length > 0 ? `## Net-new base cards (${newBaseIds.length})\nTo ingest: \`npm run gundam:fetch && npm run gundam:generate\`\n\n${newBaseIds.map((id) => `- \`${id}\``).join('\n')}\n` : ''}
${newVariantIds.length > 0 ? `## Net-new variants (${newVariantIds.length})\nThese are alt art / parallel prints of existing base cards.\nTo ingest: \`npm run gundam:fetch && npm run gundam:generate\`\n\n${newVariantIds.map((id) => `- \`${id}\``).join('\n')}\n` : ''}
## Per-pack breakdown
${perPack.map((p) => `- **${p.pack}**: ${p.count} cards${p.error ? ` ⚠ ${p.error}` : ''}`).join('\n')}
`
writeFileSync(join(DATA_DIR, 'scan-report-gundam.md'), md)
console.log(`\nReports written:`)
console.log(`  data/scan-report-gundam.json`)
console.log(`  data/scan-report-gundam.md`)
console.log(`\nTo ingest new prints: npm run gundam:fetch && npm run gundam:generate`)
console.log('━━━ done ━━━')
