#!/usr/bin/env node
/**
 * One-shot exploratory probe of the eBay APIs against "one piece" + PSA 10.
 *
 * Writes nothing. Pulls a single page from each available endpoint, prints a
 * summary, and saves the raw JSON to ./probe-out/ for offline inspection.
 *
 * Purpose: validate (before any pipeline work) that (a) our credentials
 * work, (b) Browse / Marketplace Insights actually return relevant rows for
 * the query we plan to use in production, and (c) the response shape gives
 * us the fields we need for character extraction + trend analysis.
 *
 * Run: node scripts/market/probe-ebay.mjs
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')
const outDir = join(__dirname, 'probe-out')
mkdirSync(outDir, { recursive: true })

// ── env loader (no dotenv dep) ──────────────────────────────────────────
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

// ── OAuth (client_credentials) ──────────────────────────────────────────
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
  if (!r.ok) throw new Error(`OAuth ${scope} failed (${r.status}): ${body.slice(0, 300)}`)
  return JSON.parse(body)
}

// ── Browse API search (active listings) ─────────────────────────────────
async function probeBrowse(token) {
  const url = new URL('https://api.ebay.com/buy/browse/v1/item_summary/search')
  url.searchParams.set('q', 'one piece psa 10')
  url.searchParams.set('limit', '50')
  // Trading Card Singles - eBay category for graded TCG cards.
  url.searchParams.set('category_ids', '183454')
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    },
  })
  const body = await r.text()
  if (!r.ok) return { ok: false, status: r.status, body: body.slice(0, 600) }
  return { ok: true, data: JSON.parse(body), raw: body }
}

// ── Marketplace Insights API (sold listings, last 90d) ──────────────────
async function probeMI(token) {
  const url = new URL(
    'https://api.ebay.com/buy/marketplace_insights/v1_beta/item_sales/search'
  )
  url.searchParams.set('q', 'one piece psa 10')
  url.searchParams.set('limit', '50')
  url.searchParams.set('category_ids', '183454')
  const r = await fetch(url.toString(), {
    headers: {
      Authorization: `Bearer ${token}`,
      'X-EBAY-C-MARKETPLACE-ID': MARKETPLACE,
    },
  })
  const body = await r.text()
  if (!r.ok) return { ok: false, status: r.status, body: body.slice(0, 600) }
  return { ok: true, data: JSON.parse(body), raw: body }
}

// ── Heuristics for after-the-fact analysis ─────────────────────────────
const CARD_CODE_RE = /\b(OP|ST|EB|PRB)\d{2}-\d{3}(_[a-z0-9]+)?\b/i
const PSA10_RE = /\bpsa\s*10\b|\bpsa10\b|\bgem\s*mint\s*10\b/i

function summarizeTitles(titles) {
  let withCode = 0
  let withPsa10 = 0
  const codeSet = new Set()
  for (const t of titles) {
    const m = t.match(CARD_CODE_RE)
    if (m) {
      withCode++
      codeSet.add(m[0].toUpperCase())
    }
    if (PSA10_RE.test(t)) withPsa10++
  }
  return { total: titles.length, withCode, withPsa10, uniqueCodes: codeSet.size, sampleCodes: [...codeSet].slice(0, 10) }
}

// ── Run ─────────────────────────────────────────────────────────────────
console.log('━━━ eBay reliability probe ━━━')
console.log(`marketplace=${MARKETPLACE}  app_id=${APP_ID}`)
console.log()

console.log('[1/3] Getting Browse API token (api_scope)...')
const browseAuth = await getToken('https://api.ebay.com/oauth/api_scope')
console.log(`      ok, expires_in=${browseAuth.expires_in}s`)
console.log()

console.log('[2/3] Browse search: "one piece psa 10" in category 183454')
const browse = await probeBrowse(browseAuth.access_token)
if (browse.ok) {
  const items = browse.data.itemSummaries || []
  const titles = items.map((i) => i.title || '')
  const heur = summarizeTitles(titles)
  console.log(`      ok, page=${items.length}  totalMatches≈${browse.data.total ?? '?'}`)
  console.log(`      title heuristics: PSA10 phrase=${heur.withPsa10}/${heur.total}  card_code=${heur.withCode}/${heur.total}  uniqueCodes=${heur.uniqueCodes}`)
  console.log(`      sample codes: ${heur.sampleCodes.join(', ') || '(none)'}`)
  console.log(`      price range: $${Math.min(...items.map((i) => +i.price?.value || 0))} - $${Math.max(...items.map((i) => +i.price?.value || 0))}`)
  console.log('      first 5 titles:')
  for (const t of titles.slice(0, 5)) console.log(`        - ${t.slice(0, 100)}`)
  writeFileSync(join(outDir, 'browse.json'), browse.raw)
  console.log(`      raw saved -> scripts/market/probe-out/browse.json`)
} else {
  console.log(`      FAILED (${browse.status})`)
  console.log(`      ${browse.body}`)
}
console.log()

console.log('[3/3] Marketplace Insights (sold, last 90d): "one piece psa 10"')
try {
  const miAuth = await getToken(
    'https://api.ebay.com/oauth/api_scope/buy.marketplace.insights'
  )
  console.log(`      MI token acquired, expires_in=${miAuth.expires_in}s`)
  const mi = await probeMI(miAuth.access_token)
  if (mi.ok) {
    const sales = mi.data.itemSales || []
    const titles = sales.map((s) => s.title || '')
    const heur = summarizeTitles(titles)
    console.log(`      ok, page=${sales.length}  totalMatches≈${mi.data.total ?? '?'}`)
    if (sales.length) {
      const dates = sales
        .map((s) => s.lastSoldDate)
        .filter(Boolean)
        .sort()
      console.log(`      sold-date span: ${dates[0]}  →  ${dates[dates.length - 1]}`)
      console.log(`      title heuristics: PSA10 phrase=${heur.withPsa10}/${heur.total}  card_code=${heur.withCode}/${heur.total}  uniqueCodes=${heur.uniqueCodes}`)
      console.log(`      sample codes: ${heur.sampleCodes.join(', ') || '(none)'}`)
      const prices = sales.map((s) => +s.lastSoldPrice?.value || 0)
      console.log(`      price range: $${Math.min(...prices)} - $${Math.max(...prices)}  median≈$${prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)]}`)
      console.log('      first 5 sold:')
      for (const s of sales.slice(0, 5)) {
        console.log(`        - $${s.lastSoldPrice?.value || '?'}  ${(s.title || '').slice(0, 90)}  [${s.lastSoldDate || ''}]`)
      }
    }
    writeFileSync(join(outDir, 'mi.json'), mi.raw)
    console.log(`      raw saved -> scripts/market/probe-out/mi.json`)
  } else {
    console.log(`      FAILED (${mi.status})`)
    console.log(`      ${mi.body}`)
    console.log(`      → MI access likely not yet granted to this app.`)
  }
} catch (e) {
  console.log(`      FAILED at token: ${e.message}`)
}

console.log()
console.log('━━━ done ━━━')
