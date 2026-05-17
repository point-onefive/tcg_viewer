/**
 * Daily Telegram digest.
 *
 * Queries the latest pop + eBay snapshots in Supabase, identifies sleeper
 * candidates and mispricing flags, formats them into a single Markdown
 * message, and POSTs to the owner's Telegram chat via the bot.
 *
 * Designed to be cron-friendly: zero args, exits 0 on success, 1 on any
 * failure. GitHub Actions reads the exit code; success = green check.
 *
 * Sections in the digest:
 *   1. SLEEPER CANDIDATES — low total pop, recent eBay floor exists
 *   2. MISPRICING — large floor↔median spread (possible arbitrage OR a
 *      misidentified listing in the floor; both are alert-worthy)
 *   3. TOP MOVERS — items with the most active eBay listings (where the
 *      money is concentrated tonight)
 *   4. STALE DATA — anything we tried to ingest but failed (ops watch)
 *
 *   node scripts/market/send-telegram-digest.mjs
 *   node scripts/market/send-telegram-digest.mjs --dry   # print, do not send
 */

import { config } from 'dotenv'
import pkg from 'pg'

const { Client } = pkg
config({ path: '.env.local' })

const DRY    = process.argv.includes('--dry')
const DB_URL = process.env.SUPABASE_DB_URL
const BOT    = process.env.TELEGRAM_BOT_TOKEN
const CHAT   = process.env.TELEGRAM_OWNER_CHAT_ID

for (const [k, v] of [['SUPABASE_DB_URL', DB_URL], ['TELEGRAM_BOT_TOKEN', BOT], ['TELEGRAM_OWNER_CHAT_ID', CHAT]]) {
  if (!v) { console.error(`Missing ${k}`); process.exit(1) }
}

const client = new Client({ connectionString: DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

// ─── queries ────────────────────────────────────────────────────────────────

// Top sleepers: graded singles with very low total pop, where we can see
// an eBay floor (= card is liquid enough to actually flip). Lower pop
// first, then higher priority (manually flagged) as tiebreaker.
const sleepers = await client.query(`
  with pc as (
    select distinct on (watchlist_id)
      watchlist_id, grade_10, grade_total
    from psa_pop_snapshots
    order by watchlist_id, captured_at desc
  ),
  eb as (
    select distinct on (watchlist_id)
      watchlist_id, active_count, lowest_bin, median_ask
    from ebay_market_snapshots
    order by watchlist_id, captured_at desc
  )
  select
    w.display_name, w.character, w.set_code, w.kind,
    pc.grade_10, pc.grade_total,
    eb.active_count, eb.lowest_bin, eb.median_ask
  from watchlist w
  join pc on pc.watchlist_id = w.id
  left join eb on eb.watchlist_id = w.id
  where w.kind = 'graded_single'
    and pc.grade_10 is not null
    and pc.grade_10 <= 15
    and (eb.active_count is null or eb.active_count >= 1)
  order by pc.grade_10 asc, w.priority desc
  limit 8
`)

// Top mispricing: graded singles where lowest_bin << median_ask. Ratio of
// median / floor measures "how off is the cheapest listing". 3x is the
// floor; 5x+ is genuinely interesting.
const mispriced = await client.query(`
  with eb as (
    select distinct on (watchlist_id)
      watchlist_id, active_count, lowest_bin, median_ask
    from ebay_market_snapshots
    order by watchlist_id, captured_at desc
  )
  select
    w.display_name, w.set_code,
    eb.lowest_bin, eb.median_ask, eb.active_count,
    (eb.median_ask / nullif(eb.lowest_bin, 0)) as multiple
  from watchlist w
  join eb on eb.watchlist_id = w.id
  where w.kind = 'graded_single'
    and eb.lowest_bin > 5             -- ignore $1 misfile noise
    and eb.median_ask >= 50
    and eb.active_count >= 5
    and (eb.median_ask / nullif(eb.lowest_bin, 0)) >= 3
  order by multiple desc
  limit 8
`)

// Heaviest top-end markets: high median, lots of activity. Useful as a
// "what's hot right now" anchor in the digest.
const movers = await client.query(`
  with eb as (
    select distinct on (watchlist_id)
      watchlist_id, active_count, lowest_bin, median_ask
    from ebay_market_snapshots
    order by watchlist_id, captured_at desc
  )
  select
    w.display_name, w.set_code,
    eb.active_count, eb.lowest_bin, eb.median_ask
  from watchlist w
  join eb on eb.watchlist_id = w.id
  where w.kind = 'graded_single'
    and eb.median_ask is not null
  order by eb.median_ask desc
  limit 8
`)

// Ops health: last run per source, status, error count.
const runs = await client.query(`
  select distinct on (source)
    source, status, items_processed, api_calls, errors, started_at, finished_at
  from worker_runs
  order by source, started_at desc
`)

// ─── format ─────────────────────────────────────────────────────────────────

const fmtMoney = (n) => n == null ? '—' : `$${Number(n).toLocaleString(undefined, { maximumFractionDigits: 0 })}`
const escapeMd = (s) => String(s ?? '').replace(/[_*[\]()~`>#+=|{}.!-]/g, (m) => `\\${m}`)

const lines = []
lines.push(`*Card Wall · ${escapeMd(new Date().toISOString().slice(0, 10))} digest*`)
lines.push('')

lines.push('*Sleepers* \\(pop 10 ≤ 15, has eBay activity\\)')
if (sleepers.rows.length === 0) {
  lines.push('  _none tonight_')
} else {
  for (const r of sleepers.rows) {
    const pop = `pop10=${r.grade_10}${r.grade_total != null && r.grade_total !== r.grade_10 ? `/${r.grade_total}` : ''}`
    const floor = r.lowest_bin != null ? `floor ${escapeMd(fmtMoney(r.lowest_bin))}` : 'no listing'
    lines.push(`  • \`${escapeMd((r.set_code ?? '?').padEnd(5))}\` ${escapeMd(r.display_name)} — *${escapeMd(pop)}* · ${floor}`)
  }
}
lines.push('')

lines.push('*Mispricing flags* \\(median ≥ 3× floor\\)')
if (mispriced.rows.length === 0) {
  lines.push('  _none tonight_')
} else {
  for (const r of mispriced.rows) {
    const mult = escapeMd(Number(r.multiple).toFixed(1))
    lines.push(`  • \`${escapeMd((r.set_code ?? '?').padEnd(5))}\` ${escapeMd(r.display_name)} — *${mult}×* spread · floor ${escapeMd(fmtMoney(r.lowest_bin))} / median ${escapeMd(fmtMoney(r.median_ask))} \\(${r.active_count} active\\)`)
  }
}
lines.push('')

lines.push('*Top markets by median*')
for (const r of movers.rows) {
  lines.push(`  • \`${escapeMd((r.set_code ?? '?').padEnd(5))}\` ${escapeMd(r.display_name)} — median ${escapeMd(fmtMoney(r.median_ask))} · ${r.active_count} active`)
}
lines.push('')

lines.push('*Ops*')
for (const r of runs.rows) {
  const status = r.status === 'ok' ? '✓' : r.status === 'partial' ? '◐' : '✗'
  lines.push(`  ${status} \`${escapeMd(r.source)}\` — ${r.items_processed} items · ${r.api_calls} calls · ${r.errors} errors`)
}

// Defensive: also escape any remaining stray reserved chars in literal
// labels we emit. (Section headings already escape parens / leq / etc.)

const text = lines.join('\n')

// ─── send ───────────────────────────────────────────────────────────────────

if (DRY) {
  console.log('--- DIGEST (dry, would send) ---\n')
  console.log(text)
  console.log('\n--- end (', text.length, 'chars) ---')
  await client.end()
  process.exit(0)
}

const resp = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    chat_id: CHAT,
    text,
    parse_mode: 'MarkdownV2',
    disable_web_page_preview: true,
  }),
})
const result = await resp.json()
if (!result.ok) {
  console.error('telegram send failed:', JSON.stringify(result, null, 2))
  await client.end()
  process.exit(1)
}
console.log(`sent ok — message_id=${result.result.message_id}, ${text.length} chars`)
await client.end()
