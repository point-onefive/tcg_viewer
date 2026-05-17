/**
 * Quick query against the real DB to confirm signals are computable from
 * what's in there now. Pure read, no writes.
 */

import { config } from 'dotenv'
import pkg from 'pg'

const { Client } = pkg
config({ path: '.env.local' })

const c = new Client({ connectionString: process.env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await c.connect()

console.log('\n=== TOP SLEEPER CANDIDATES (low pop @ grade 10, recent eBay activity) ===')
const sleepers = await c.query(`
  with pc as (
    select distinct on (watchlist_id) watchlist_id, grade_10, grade_total
    from psa_pop_snapshots
    order by watchlist_id, captured_at desc
  ),
  eb as (
    select distinct on (watchlist_id) watchlist_id, active_count, lowest_bin, median_ask
    from ebay_market_snapshots
    order by watchlist_id, captured_at desc
  )
  select
    w.display_name,
    w.character,
    w.set_code,
    pc.grade_10  as pop_10,
    pc.grade_total as pop_total,
    eb.active_count as ebay_active,
    eb.lowest_bin  as ebay_floor,
    eb.median_ask  as ebay_median
  from watchlist w
  join pc on pc.watchlist_id = w.id
  left join eb on eb.watchlist_id = w.id
  where pc.grade_10 is not null
    and pc.grade_10 <= 10
    and w.kind = 'graded_single'
  order by pc.grade_10 asc, w.priority desc
  limit 20
`)
for (const r of sleepers.rows) {
  console.log(
    `  pop_10=${String(r.pop_10).padStart(3)}  ` +
    `pop_total=${String(r.pop_total ?? '-').padStart(4)}  ` +
    `ebay_floor=${r.ebay_floor != null ? `$${String(r.ebay_floor).padStart(7)}` : '   -    '}  ` +
    `${(r.set_code ?? '-').padEnd(6)} ${r.display_name}`
  )
}

console.log('\n=== TOP eBay FLOORS (highest current PSA 10 ask) ===')
const tops = await c.query(`
  select
    w.display_name,
    w.set_code,
    e.lowest_bin,
    e.median_ask,
    e.active_count
  from watchlist w
  join lateral (
    select * from ebay_market_snapshots
    where watchlist_id = w.id
    order by captured_at desc
    limit 1
  ) e on true
  where w.kind = 'graded_single'
    and e.lowest_bin is not null
  order by e.median_ask desc
  limit 15
`)
for (const r of tops.rows) {
  console.log(
    `  median=$${String(r.median_ask).padStart(8)}  floor=$${String(r.lowest_bin).padStart(7)}  ` +
    `active=${String(r.active_count).padStart(3)}  ${(r.set_code ?? '-').padEnd(6)} ${r.display_name}`
  )
}

console.log('\n=== DB INVENTORY ===')
const counts = await c.query(`
  select 'watchlist' as t, count(*)::int as n from watchlist
  union all select 'psa_pop_snapshots',     count(*)::int from psa_pop_snapshots
  union all select 'ebay_market_snapshots', count(*)::int from ebay_market_snapshots
  union all select 'ebay_listings',         count(*)::int from ebay_listings
  union all select 'worker_runs',           count(*)::int from worker_runs
`)
for (const r of counts.rows) console.log(`  ${r.t.padEnd(24)} ${r.n}`)

await c.end()
