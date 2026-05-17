/**
 * Drops every market-intel object and re-applies the initial migration.
 * Safe to use while there is no real data yet. Will REFUSE if any of the
 * critical tables already have rows (you need to be deliberate after that).
 *
 *   node scripts/reset-market-schema.mjs
 *   node scripts/reset-market-schema.mjs --force   # bypass the row-count guard
 */

import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import pkg from 'pg'

const { Client } = pkg
config({ path: '.env.local' })

const URL = process.env.SUPABASE_DB_URL
if (!URL) { console.error('Missing SUPABASE_DB_URL'); process.exit(1) }

const FORCE = process.argv.includes('--force')
const client = new Client({ connectionString: URL, ssl: { rejectUnauthorized: false } })
await client.connect()

// Guard against accidentally torching real data.
const guard = await client.query(`
  select 'watchlist' as t, count(*)::int as n from watchlist
  union all select 'psa_pop_snapshots', count(*)::int from psa_pop_snapshots
  union all select 'ebay_market_snapshots', count(*)::int from ebay_market_snapshots
  union all select 'ebay_listings', count(*)::int from ebay_listings
  union all select 'price_snapshots', count(*)::int from price_snapshots
  union all select 'signals', count(*)::int from signals
`).catch(() => ({ rows: [] }))

const populated = guard.rows.filter((r) => r.n > 0)
if (populated.length > 0 && !FORCE) {
  console.error('REFUSING: existing rows present:')
  for (const r of populated) console.error(`  ${r.t}: ${r.n}`)
  console.error('Pass --force to drop anyway.')
  await client.end()
  process.exit(1)
}

console.log('dropping market-intel objects (cascade)...')

const dropSql = `
  drop materialized view if exists pulse_latest cascade;
  drop table if exists alerts_sent       cascade;
  drop table if exists sealed_contents   cascade;
  drop table if exists signals           cascade;
  drop table if exists price_snapshots   cascade;
  drop table if exists ebay_listings     cascade;
  drop table if exists ebay_market_snapshots cascade;
  drop table if exists psa_pop_snapshots cascade;
  drop table if exists worker_runs       cascade;
  drop table if exists watchlist         cascade;
  drop type  if exists signal_type       cascade;
  drop type  if exists collection_code   cascade;
  drop type  if exists tracked_kind      cascade;
`
await client.query(dropSql)
console.log('  done.')

console.log('re-applying 0001_init_market.sql...')
const file = resolve('supabase/migrations/0001_init_market.sql')
const sql = readFileSync(file, 'utf-8')
await client.query(sql)
console.log('  done.')

await client.end()
console.log('reset complete.')
