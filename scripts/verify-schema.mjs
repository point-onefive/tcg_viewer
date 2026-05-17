/**
 * Verify the market schema is applied to Supabase.
 *
 * Uses raw fetch + HTTP status against the REST API because supabase-js
 * silently returns null instead of an error for missing tables. A 404
 * means the table does not exist; 200 means it does.
 *
 * Usage:
 *   node scripts/verify-schema.mjs
 */

import { config } from 'dotenv'

// Next.js convention: read .env.local. dotenv default is .env only.
config({ path: '.env.local' })

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SECRET_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local')
  process.exit(1)
}

const EXPECTED = [
  'watchlist',
  'psa_pop_snapshots',
  'ebay_market_snapshots',
  'ebay_listings',
  'price_snapshots',
  'signals',
  'sealed_contents',
  'alerts_sent',
  'worker_runs',
  'pulse_latest',           // materialized view
]

async function probe(name) {
  const r = await fetch(`${URL}/rest/v1/${name}?select=*&limit=0`, {
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${KEY}`,
      Prefer: 'count=exact',
    },
  })
  return r.status
}

let ok = 0
let missing = 0
const missingNames = []

for (const name of EXPECTED) {
  const status = await probe(name)
  if (status === 200 || status === 206) {
    console.log(`  ok      ${name}`)
    ok++
  } else {
    console.log(`  MISSING ${name}  (HTTP ${status})`)
    missing++
    missingNames.push(name)
  }
}

console.log('')
if (missing === 0) {
  console.log(`Schema OK: ${ok}/${EXPECTED.length} expected objects present.`)
  process.exit(0)
} else {
  console.log(`Schema INCOMPLETE: ${ok} present, ${missing} missing.`)
  console.log(`Missing: ${missingNames.join(', ')}`)
  console.log('')
  console.log('Apply supabase/migrations/0001_init_market.sql via the Supabase SQL Editor.')
  process.exit(2)
}
