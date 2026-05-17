/**
 * Tiny smoke test for the eBay client. Doesn't touch the DB. Runs three
 * canned queries to verify auth, search, filtering, and aggregation work
 * end-to-end with the current credentials.
 *
 *   node scripts/market/_smoke-ebay.mjs
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

const APP  = process.env.EBAY_APP_ID
const CERT = process.env.EBAY_CERT_ID
const MKT  = process.env.EBAY_MARKETPLACE || 'EBAY_US'

const basic = Buffer.from(`${APP}:${CERT}`).toString('base64')
const tokenResp = await fetch('https://api.ebay.com/identity/v1/oauth2/token', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/x-www-form-urlencoded',
    Authorization: `Basic ${basic}`,
  },
  body: 'grant_type=client_credentials&scope=https://api.ebay.com/oauth/api_scope',
})
const { access_token } = await tokenResp.json()
console.log(`token: ${access_token.slice(0, 24)}...`)

const QUERIES = [
  { label: 'OP05-119 Luffy Manga PSA 10', query: 'OP05-119 PSA 10', excludes: ['japanese', 'jp'] },
  { label: 'One Piece OP-15 Booster Box', query: 'One Piece OP-15 Booster Box English', excludes: ['single', 'singles'] },
  { label: 'P-001 Luffy promo (raw)',     query: 'P-001 Monkey D Luffy', excludes: ['psa', 'cgc', 'bgs', 'graded'] },
]

for (const { label, query, excludes } of QUERIES) {
  const r = await fetch(`https://api.ebay.com/buy/browse/v1/item_summary/search?q=${encodeURIComponent(query)}&limit=50`, {
    headers: {
      Authorization: `Bearer ${access_token}`,
      'X-EBAY-C-MARKETPLACE-ID': MKT,
    },
  })
  const d = await r.json()
  const raw = d.itemSummaries ?? []
  const ex = excludes.map((e) => e.toLowerCase())
  const kept = raw.filter((it) => {
    const t = (it.title ?? '').toLowerCase()
    return !ex.some((e) => t.includes(e))
  })
  const prices = kept.map((it) => parseFloat(it.price?.value ?? '0')).filter((p) => p > 0)
  prices.sort((a, b) => a - b)
  const median = prices.length ? prices[prices.length >> 1] : null
  console.log(
    `${label.padEnd(38)} total=${String(d.total ?? raw.length).padStart(5)} ` +
    `kept=${String(kept.length).padStart(3)} floor=${prices[0] != null ? `$${prices[0]}` : '-'} ` +
    `median=${median != null ? `$${median.toFixed(2)}` : '-'}`
  )
}
