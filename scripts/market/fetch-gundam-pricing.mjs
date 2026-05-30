#!/usr/bin/env node
/**
 * Fetches eBay active listing data for all Gundam Card Game singles and
 * writes src/lib/pricing-gundam.json in the same CardPricing shape that
 * the One Piece pipeline produces.
 *
 * Source:   eBay Browse API (free tier) — production credentials from .env.local
 * Coverage: All base-card IDs in src/lib/cards-gundam.json
 * Output:   src/lib/pricing-gundam.json
 *
 * Run:      node scripts/market/fetch-gundam-pricing.mjs
 *
 * Rate:     300ms between requests → ~3-4 min for 656 cards
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')

// ── Env ──────────────────────────────────────────────────────────────────────
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

// ── Auth ─────────────────────────────────────────────────────────────────────
let _token = null
let _tokenExpiry = 0

async function ensureToken() {
  if (_token && Date.now() < _tokenExpiry - 60000) return _token
  const auth = Buffer.from(`${APP_ID}:${CERT_ID}`).toString('base64')
  const r = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'https://api.ebay.com/oauth/api_scope',
    }),
  })
  const body = await r.text()
  if (!r.ok) throw new Error(`OAuth failed (${r.status}): ${body.slice(0, 200)}`)
  const data = JSON.parse(body)
  _token = data.access_token
  _tokenExpiry = Date.now() + data.expires_in * 1000
  return _token
}

// ── eBay Browse search ────────────────────────────────────────────────────────

/**
 * Build an eBay search query for a card or variant.
 * - Base cards:  `"GD01-001" Gundam Card Game`
 * - _p1 (LR+):  `"GD01-001" Gundam Card Game parallel`
 * - _r1 (Alt):  `"GD01-001" Gundam Card Game alt art`
 * - Edition Beta specific _p2: `"GD01-001" Gundam Card Game "edition beta"`
 *
 * We search the BASE code (not the full variant id) because eBay sellers
 * rarely include the "_p1" suffix in their listing titles.
 */
function buildQuery(id, distribution) {
  const baseCode = id.replace(/_[a-z]\d+$/i, '')
  const suffix = id.match(/_([a-z]\d+)$/i)?.[1]
  if (!suffix) return `"${baseCode}" Gundam Card Game`

  const dist = (distribution || '').toLowerCase()
  if (dist.includes('edition beta')) return `"${baseCode}" Gundam Card Game "edition beta"`
  if (dist.includes('championship') || dist.includes('winner') || dist.includes('world')) {
    return `"${baseCode}" Gundam Card Game championship`
  }
  if (/^r\d+$/i.test(suffix)) return `"${baseCode}" Gundam Card Game alt art`
  // Default for _p1, _p2, _p3 etc.: add "parallel"
  return `"${baseCode}" Gundam Card Game parallel`
}

async function searchListings(id, distribution, limit = 50) {
  const token = await ensureToken()
  const q = buildQuery(id, distribution)
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
  url.searchParams.set('q', q)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('category_ids', '183454') // Trading Card Singles
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    },
  })
  if (!r.ok) return null
  return r.json()
}

// ── Price analysis ────────────────────────────────────────────────────────────

// Patterns that indicate a listing is NOT a plain NM single
const LOT_RE = /\b(lot|bundle|set|collection|x\d+|\d+x|graded|psa|bgs|cgc|sgc|tag|ace|sealed|box|booster)\b/i

function filterSingleListings(items) {
  return items.filter((it) => {
    const t = (it.title || '').toLowerCase()
    if (LOT_RE.test(t)) return false
    const price = parseFloat(it.price?.value || '0')
    // Exclude free / obviously-wrong prices
    if (price <= 0.01) return false
    return true
  })
}

function computeStats(items) {
  const prices = items
    .map((it) => parseFloat(it.price?.value || '0'))
    .filter((p) => p > 0 && p < 10000)
    .sort((a, b) => a - b)

  if (!prices.length) return null

  // Remove top 10% outliers (lot sales that slipped through)
  const cutoff = Math.floor(prices.length * 0.9)
  const trimmed = prices.slice(0, Math.max(1, cutoff))

  const median = trimmed[Math.floor(trimmed.length / 2)]
  const low = trimmed[0]
  const high = trimmed[trimmed.length - 1]

  return { market: parseFloat(median.toFixed(2)), low: parseFloat(low.toFixed(2)), high: parseFloat(high.toFixed(2)), count: prices.length }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const cards = JSON.parse(
  readFileSync(join(projectRoot, 'src/lib/cards-gundam.json'), 'utf-8')
)
const syncedAt = new Date().toISOString()
const outPath = join(projectRoot, 'src/lib/pricing-gundam.json')

// Resume: if output exists, skip entries already priced
let existing = { syncedAt: '', cards: {} }
if (existsSync(outPath)) {
  try {
    existing = JSON.parse(readFileSync(outPath, 'utf-8'))
    console.log(`Resuming — ${Object.keys(existing.cards).length} entries already priced`)
  } catch { /* start fresh */ }
}

// Build full list: base cards + all variants
const allEntries = []
for (const card of cards) {
  allEntries.push({ id: card.id, name: card.name, rarity: card.rarity, setCode: card.setCode, distribution: card.distribution, isVariant: false })
  for (const v of card.variants ?? []) {
    allEntries.push({ id: v.id, name: card.name + (v.label ? ` · ${v.label}` : ''), rarity: v.rarity ?? card.rarity, setCode: card.setCode, distribution: v.distribution ?? card.distribution, isVariant: true })
  }
}

console.log(`━━━ Gundam pricing pipeline ━━━`)
console.log(`Entries to price: ${allEntries.length} (${cards.length} base + ${allEntries.length - cards.length} variants)  marketplace: ${MARKETPLACE}`)
console.log(`Output: ${outPath}\n`)

const output = { ...existing }
let priced = 0
let skipped = 0
let noData = 0

for (let i = 0; i < allEntries.length; i++) {
  const entry = allEntries[i]
  const { id, name, rarity, setCode, distribution, isVariant } = entry

  // Resume: skip if already priced in existing output
  if (existing.cards[id]) {
    skipped++
    continue
  }

  try {
    const data = await searchListings(id, distribution, 50)
    const items = data?.itemSummaries ?? []
    const singles = filterSingleListings(items)
    const stats = computeStats(singles)
    const tag = isVariant ? '~' : ' '

    if (!stats) {
      noData++
      process.stdout.write(`  ✗${tag}${id.padEnd(16)} no usable listings (${items.length} raw)\n`)
      output.cards[id] = {
        tcgplayerId: 0,
        cardCode: id,
        name,
        rarity: rarity || null,
        setAbbr: setCode || null,
        syncedAt,
        source: 'ebay',
        raw: {},
        graded: [],
        ebayRaw: {},
        primaryMarket: null,
        primarySubtype: null,
        listings: 0,
        matchMethod: 'ebay_browse',
        matchConfidence: 0,
      }
    } else {
      priced++
      const pct = ((i + 1) / allEntries.length * 100).toFixed(0)
      process.stdout.write(
        `  ✓${tag}${id.padEnd(16)} [${(rarity||'?').padEnd(4)}]  ${singles.length}/${items.length} singles  $${stats.low}–$${stats.high}  median=$${stats.market}  (${pct}%)\n`
      )
      output.cards[id] = {
        tcgplayerId: 0,
        cardCode: id,
        name,
        rarity: rarity || null,
        setAbbr: setCode || null,
        syncedAt,
        source: 'ebay',
        raw: {
          Normal: { market: stats.market, low: stats.low, high: stats.high },
        },
        graded: [],
        ebayRaw: {
          raw: { avg1d: null, avg7d: null, avg30d: stats.market },
        },
        primaryMarket: stats.market,
        primarySubtype: 'Normal',
        listings: singles.length,
        matchMethod: 'ebay_browse',
        matchConfidence: isVariant ? 0.6 : 0.7,
      }
    }
  } catch (err) {
    console.error(`\n  ERROR on ${id}: ${err.message}`)
  }

  // Write incrementally every 50 entries
  if ((i + 1) % 50 === 0) {
    output.syncedAt = syncedAt
    writeFileSync(outPath, JSON.stringify(output, null, 2))
    console.log(`  ↳ checkpoint saved (${i + 1}/${allEntries.length})`)
  }

  await sleep(300)
}

// Final write
output.syncedAt = syncedAt
writeFileSync(outPath, JSON.stringify(output, null, 2))

const totalPriced = Object.values(output.cards).filter(c => c.primaryMarket).length
console.log(`\n━━━ Done ━━━`)
console.log(`  Total in bundle:   ${Object.keys(output.cards).length}`)
console.log(`  With market price: ${totalPriced}`)
console.log(`  New this run:      ${priced}`)
console.log(`  Skipped (resume):  ${skipped}`)
console.log(`  No data:           ${noData}`)
console.log(`  Written:           ${outPath}`)
