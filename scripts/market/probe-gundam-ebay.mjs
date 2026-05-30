#!/usr/bin/env node
/**
 * Probe the eBay Browse API for Gundam Card Game singles coverage.
 *
 * Reads cards-gundam.json, samples a spread of cards across sets and
 * rarities, queries eBay active listings + sold (MI) for each, and
 * outputs a coverage report to ./probe-out/gundam-coverage.json.
 *
 * Read-only. Writes nothing to src/lib.
 *
 * Run: node scripts/market/probe-gundam-ebay.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')
const outDir = join(__dirname, 'probe-out')
mkdirSync(outDir, { recursive: true })

// ── env loader ──────────────────────────────────────────────────────────────
function loadEnv() {
  const txt = readFileSync(join(projectRoot, '.env.local'), 'utf-8')
  for (const raw of txt.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#')) continue
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
    if (m) process.env[m[1]] ??= m[2]
  }
}
loadEnv()

const APP_ID = process.env.EBAY_APP_ID
const CERT_ID = process.env.EBAY_CERT_ID
const MARKETPLACE = process.env.EBAY_MARKETPLACE || 'EBAY_US'
if (!APP_ID || !CERT_ID) {
  console.error('Missing EBAY_APP_ID / EBAY_CERT_ID in .env.local')
  process.exit(1)
}

// ── Auth ────────────────────────────────────────────────────────────────────
async function getToken(scope) {
  const auth = Buffer.from(`${APP_ID}:${CERT_ID}`).toString('base64')
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ grant_type: 'client_credentials', scope }),
  })
  const body = await r.text()
  if (!r.ok) throw new Error(`OAuth failed (${r.status}): ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

// ── Browse API ───────────────────────────────────────────────────────────────
const HEADERS = {}

async function browseSingle(cardId, token) {
  const q = `Gundam Card Game ${cardId}`
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', '10')
  url.searchParams.set('category_ids', '183454') // Trading Card Singles
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    },
  })
  if (!r.ok) return { ok: false, status: r.status }
  const data = await r.json()
  return { ok: true, total: data.total || 0, items: data.itemSummaries || [] }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ── Load cards ───────────────────────────────────────────────────────────────
const allCards = JSON.parse(
  readFileSync(join(projectRoot, 'src/lib/cards-gundam.json'), 'utf-8')
)

// Build a stratified sample: 2 cards per set × rarity tier
function buildSample(cards) {
  const seen = new Set()
  const out = []
  const bySet = {}
  for (const c of cards) {
    if (!bySet[c.setCode]) bySet[c.setCode] = {}
    if (!bySet[c.setCode][c.rarity]) bySet[c.setCode][c.rarity] = []
    bySet[c.setCode][c.rarity].push(c)
  }
  for (const [setCode, byRarity] of Object.entries(bySet)) {
    for (const [rarity, rarCards] of Object.entries(byRarity)) {
      for (const c of rarCards.slice(0, 2)) {
        if (!seen.has(c.id)) {
          seen.add(c.id)
          out.push({ id: c.id, name: c.name, setCode, rarity })
        }
      }
    }
  }
  return out
}

const sample = buildSample(allCards)
console.log(`━━━ Gundam eBay coverage probe ━━━`)
console.log(`Total bundle cards: ${allCards.length} (${allCards.filter(c => c.variants?.length).length} with variants)`)
console.log(`Sample size: ${sample.length} cards across ${new Set(sample.map(s => s.setCode)).size} sets\n`)

console.log('[1/2] Acquiring Browse API token...')
const browseAuth = await getToken('https://api.ebay.com/oauth/api_scope')
console.log(`      ok, expires_in=${browseAuth.expires_in}s\n`)

// ── Sample probes ────────────────────────────────────────────────────────────
console.log('[2/2] Sampling eBay listings per card...')
const results = []
let hits = 0
let zeroes = 0
let totalListings = 0
const pricePoints = []

for (let i = 0; i < sample.length; i++) {
  const card = sample[i]
  const res = await browseSingle(card.id, browseAuth.access_token)
  const found = res.ok && res.total > 0
  if (found) {
    hits++
    totalListings += res.total
    const prices = (res.items || [])
      .map(it => parseFloat(it.price?.value || '0'))
      .filter(p => p > 0)
    pricePoints.push(...prices)
    const minP = Math.min(...prices)
    const maxP = Math.max(...prices)
    results.push({ ...card, listingCount: res.total, priceMin: minP.toFixed(2), priceMax: maxP.toFixed(2), sampleTitles: res.items.slice(0, 2).map(it => it.title?.slice(0, 80)) })
    process.stdout.write(`  ✓ ${card.id.padEnd(12)} ${res.total.toString().padStart(4)} listings  $${minP.toFixed(2)}–$${maxP.toFixed(2)}\n`)
  } else {
    zeroes++
    results.push({ ...card, listingCount: 0 })
    process.stdout.write(`  ✗ ${card.id.padEnd(12)} 0 listings\n`)
  }
  if (i < sample.length - 1) await sleep(300)
}

// ── Summary ───────────────────────────────────────────────────────────────────
const hitRate = ((hits / sample.length) * 100).toFixed(1)
const medianPrice = pricePoints.length
  ? pricePoints.sort((a, b) => a - b)[Math.floor(pricePoints.length / 2)].toFixed(2)
  : 'n/a'

console.log(`\n━━━ Results ━━━`)
console.log(`Cards sampled:     ${sample.length}`)
console.log(`Cards with hits:   ${hits} (${hitRate}%)`)
console.log(`Cards with zero:   ${zeroes}`)
console.log(`Total listings:    ${totalListings}`)
console.log(`Median list price: $${medianPrice}`)
console.log(`Price range:       $${Math.min(...pricePoints).toFixed(2)} – $${Math.max(...pricePoints).toFixed(2)}`)

const report = {
  probedAt: new Date().toISOString(),
  bundleCardCount: allCards.length,
  sampleSize: sample.length,
  hits,
  zeroes,
  hitRate: parseFloat(hitRate),
  totalListings,
  medianListPrice: parseFloat(medianPrice) || null,
  priceRange: {
    min: pricePoints.length ? Math.min(...pricePoints) : null,
    max: pricePoints.length ? Math.max(...pricePoints) : null,
  },
  results,
}

const outPath = join(outDir, 'gundam-coverage.json')
writeFileSync(outPath, JSON.stringify(report, null, 2))
console.log(`\nFull report saved → scripts/market/probe-out/gundam-coverage.json`)
console.log('━━━ done ━━━')
