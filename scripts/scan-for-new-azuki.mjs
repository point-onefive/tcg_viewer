#!/usr/bin/env node
/**
 * Scan tcg.azuki.com for net-new Azuki TCG prints not yet in
 * src/lib/cards-azuki.json and write a report to data/scan-report-azuki.{json,md}.
 *
 * Mirrors the Gundam `scan-for-new-gundam.mjs` pattern:
 *   - Read-only. Never modifies the bundle.
 *   - Diffs the live gallery API against our deployed cards-azuki.json.
 *   - Reports net-new base card IDs AND net-new variant (parallel) IDs separately.
 *
 * Usage:
 *   npm run azuki:scan
 *   node scripts/scan-for-new-azuki.mjs
 *
 * After running, read data/scan-report-azuki.md for a human summary, then run
 * `npm run azuki:fetch && npm run azuki:generate` to ingest approved prints.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const URL = 'https://tcg.azuki.com/api/cards'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

mkdirSync(DATA_DIR, { recursive: true })

/** A parallel print is a base id plus a trailing letter suffix. */
function isVariantId(id) {
  return /^[A-Z]{2,4}\d*-\d+[A-Za-z]+\d*$/.test(id)
}

// ── Load deployed bundle ─────────────────────────────────────────────────────
const bundlePath = join(ROOT, 'src', 'lib', 'cards-azuki.json')
let bundle = []
try {
  bundle = JSON.parse(readFileSync(bundlePath, 'utf-8'))
} catch {
  console.log('No cards-azuki.json yet - treating every live print as net-new.')
}
const bundleBaseIds = new Set(bundle.map((c) => c.id))
const bundleVariantIds = new Set(bundle.flatMap((c) => (c.variants ?? []).map((v) => v.id)))
const allBundleIds = new Set([...bundleBaseIds, ...bundleVariantIds])
console.log(`Deployed bundle: ${bundle.length} base cards, ${bundleVariantIds.size} variants`)

// ── Fetch live catalog ───────────────────────────────────────────────────────
console.log(`\nFetching live catalog from ${URL} …`)
const res = await fetch(URL, { headers: { 'User-Agent': UA, Accept: 'application/json' } })
if (!res.ok) {
  console.error(`HTTP ${res.status} ${URL}`)
  process.exit(1)
}
const payload = await res.json()
const liveCards = Array.isArray(payload) ? payload : payload.cards ?? []
const liveIds = new Set(liveCards.map((c) => c.id).filter(Boolean))
console.log(`  ${liveIds.size} live prints`)

// ── Diff ─────────────────────────────────────────────────────────────────────
const newBaseIds = []
const newVariantIds = []
for (const id of liveIds) {
  if (allBundleIds.has(id)) continue
  if (isVariantId(id)) newVariantIds.push(id)
  else newBaseIds.push(id)
}
newBaseIds.sort()
newVariantIds.sort()

// ── Report ───────────────────────────────────────────────────────────────────
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
  console.log(`\n  New variants:`)
  for (const id of newVariantIds) console.log(`    + ${id}`)
}

// ── Write report files ─────────────────────────────────────────────────────────
const report = {
  scannedAt,
  bundleBaseCount: bundle.length,
  bundleVariantCount: bundleVariantIds.size,
  liveCount: liveIds.size,
  newBaseIds,
  newVariantIds,
}
writeFileSync(join(DATA_DIR, 'scan-report-azuki.json'), JSON.stringify(report, null, 2))

const md = `# Azuki TCG — Scan Report
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
${newBaseIds.length > 0 ? `## Net-new base cards (${newBaseIds.length})\nTo ingest: \`npm run azuki:fetch && npm run azuki:generate\`\n\n${newBaseIds.map((id) => `- \`${id}\``).join('\n')}\n` : ''}
${newVariantIds.length > 0 ? `## Net-new variants (${newVariantIds.length})\nThese are parallel / foil prints of existing base cards.\nTo ingest: \`npm run azuki:fetch && npm run azuki:generate\`\n\n${newVariantIds.map((id) => `- \`${id}\``).join('\n')}\n` : ''}`
writeFileSync(join(DATA_DIR, 'scan-report-azuki.md'), md)
console.log(`\nReports written:`)
console.log(`  data/scan-report-azuki.json`)
console.log(`  data/scan-report-azuki.md`)
console.log('━━━ done ━━━')
