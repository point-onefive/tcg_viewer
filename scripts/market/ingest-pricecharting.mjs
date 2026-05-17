/**
 * PriceCharting ingester. PRIMARY source for graded population data.
 *
 * Strategy:
 *   PSA's free Public API only exposes cert lookups (no population data).
 *   PSA's pop pages are Cloudflare-protected. PriceCharting aggregates
 *   PSA + CGC population data, exposes it as a structured HTML table,
 *   serves over plain HTTP with no bot protection, and ships day-over-day
 *   price deltas for free. So PriceCharting is our pop + price source.
 *
 * What this script does:
 *   1. For each PriceCharting set we know about (PC_SETS below), fetches
 *      the set-level pop page (~600KB).
 *   2. Parses the pop table:
 *      columns = [Grade 6, Grade 7, Grade 8, Grade 9, Grade 10, Total]
 *      Each row is a card with its name + URL.
 *   3. For each parsed row, tries to match it to a watchlist item by
 *      `card_id` (e.g. "OP05-119") AND, when the row has a variant tag
 *      like "[Alternate Art Manga]", by `variant_id` too.
 *   4. Writes a row to `psa_pop_snapshots` per matched item. Multiple PC
 *      sets may contain the same card_id (because of reprints / promos /
 *      manga variants); we write a separate snapshot per (pc_set, card)
 *      pairing and store the PC URL in `raw` for traceability.
 *
 * Why we don't fetch per-card pages in this script (yet):
 *   The set pop pages give us *every* card in the set in one fetch.
 *   Per-card pages give us prices + sales history but cost ~1 fetch
 *   per card. We'd need them for the price_snapshots table. That's
 *   `scripts/market/ingest-pricecharting-prices.mjs` (next).
 *
 * Usage:
 *   node scripts/market/ingest-pricecharting.mjs              # full run
 *   node scripts/market/ingest-pricecharting.mjs --dry        # no writes
 *   node scripts/market/ingest-pricecharting.mjs --set=<slug> # one set
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import * as cheerio from 'cheerio'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

config({ path: '.env.local' })

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

// ─── env + clients ──────────────────────────────────────────────────────────

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SECRET_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY')
  process.exit(1)
}

const argv = parseArgs(process.argv.slice(2))
const DRY = argv.dry
const SET_FILTER = argv.set || null

const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── PriceCharting set catalog ──────────────────────────────────────────────
// Confirmed via HTTP 200 probes against /console/<slug>.
// Set codes are best-effort labels; PriceCharting groups by promotional
// release rather than by booster number, so several slugs do not map 1:1
// to OP-XX. The card-code match below handles that correctly regardless.

const PC_SETS = [
  { slug: 'one-piece-romance-dawn',                 label: 'OP-01 Romance Dawn' },
  { slug: 'one-piece-paramount-war',                label: 'OP-02 Paramount War' },
  { slug: 'one-piece-pillars-of-strength',          label: 'OP-03 Pillars of Strength' },
  { slug: 'one-piece-kingdoms-of-intrigue',         label: 'OP-04 Kingdoms of Intrigue' },
  { slug: 'one-piece-awakening-of-the-new-era',     label: 'OP-05 Awakening of the New Era' },
  { slug: 'one-piece-wings-of-the-captain',         label: 'OP-06 Wings of the Captain' },
  { slug: 'one-piece-500-years-in-the-future',      label: 'OP-07 500 Years in the Future' },
  { slug: 'one-piece-two-legends',                  label: 'OP-08 Two Legends' },
  { slug: 'one-piece-emperors-in-the-new-world',    label: 'OP-09 Emperors in the New World' },
  { slug: 'one-piece-royal-blood',                  label: 'OP-10 Royal Blood' },
  { slug: 'one-piece-fist-of-divine-speed',         label: 'OP-11 Fist of Divine Speed' },
  { slug: 'one-piece-legacy-of-the-master',         label: 'OP-12 Legacy of the Master' },
  { slug: 'one-piece-ultra-deck-the-three-captains',label: 'ST-10 Ultra Deck: Three Captains' },
  { slug: 'one-piece-carrying-on-his-will',         label: 'OP-13 Carrying on His Will' },
  { slug: 'one-piece-extra-booster-memorial-collection', label: 'EB-01 Memorial Collection' },
  { slug: 'one-piece-premium-booster',              label: 'PRB-01 Premium Booster' },
  { slug: 'one-piece-premium-booster-2',            label: 'PRB-02 Premium Booster 2' },
  { slug: 'one-piece-starter-deck-1-straw-hat-crew',label: 'ST-01 Straw Hat Crew' },
  { slug: 'one-piece-promo',                        label: 'Promo Cards' },
]

// ─── fetching ───────────────────────────────────────────────────────────────

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

async function fetchSetPop(slug) {
  const url = `https://www.pricecharting.com/pop/set/${slug}`
  const r = await fetch(url, {
    headers: { 'User-Agent': UA, 'Accept': 'text/html' },
  })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return { url, html: await r.text() }
}

// ─── parsing ────────────────────────────────────────────────────────────────

const CARD_CODE_RE = /(OP|EB|ST|PRB|P)\d{1,2}-?\d{1,3}|^P-\d{3}/i
const VARIANT_RE = /\[([^\]]+)\]/g

/**
 * Parse a PriceCharting pop page.
 * Returns rows: { name, card_code, variants[], grade_6, grade_7, grade_8,
 * grade_9, grade_10, grade_total, item_url }.
 */
function parsePopPage(html, setUrl) {
  const $ = cheerio.load(html)
  const rows = []

  // Each pop row is a <tr data-product="..."> containing TWO links to the
  // same pop item: an image link (empty text, in a td.image cell) and a
  // text link (with the card name). We want the text one. Filter out the
  // image-wrapping link by requiring non-empty text content.
  $('tr[data-product]').each((_, tr) => {
    const $tr = $(tr)
    let name = ''
    let href = ''
    $tr.find('a[href*="/pop/item/"]').each((_, a) => {
      const t = $(a).text().trim()
      if (t && !name) { name = t; href = $(a).attr('href') || '' }
    })
    if (!name) return

    const codeMatch = name.match(/\b(OP|EB|ST|PRB)\d{2}-\d{3}\b/) ||
                      name.match(/\bP-\d{3}\b/)
    if (!codeMatch) return
    const card_code = codeMatch[0]

    const variants = []
    let v
    const vRe = new RegExp(VARIANT_RE.source, 'gi')
    while ((v = vRe.exec(name)) !== null) variants.push(v[1].trim())

    // cheerio's .map().get() flattens out null/undefined entries (jQuery
    // compat), which would silently drop positional data when a grade has
    // "-" instead of a count. Use a manual loop to preserve positions.
    const cells = []
    $tr.find('td.pop-value').each((_, td) => {
      const txt = $(td).text().trim()
      if (txt === '-' || txt === '') { cells.push(null); return }
      const n = parseInt(txt.replace(/[,\s]/g, ''), 10)
      cells.push(Number.isFinite(n) ? n : null)
    })

    // Column layout (confirmed via header inspection):
    // [Grade 6, Grade 7, Grade 8, Grade 9, Grade 10, Total]
    if (cells.length < 6) return
    rows.push({
      name,
      card_code,
      variants,
      grade_6:     cells[0],
      grade_7:     cells[1],
      grade_8:     cells[2],
      grade_9:     cells[3],
      grade_10:    cells[4],
      grade_total: cells[5],
      item_url:    href.startsWith('http') ? href : `https://www.pricecharting.com${href}`,
      pc_set_url:  setUrl,
    })
  })

  return rows
}

// ─── watchlist matching ────────────────────────────────────────────────────

async function loadWatchlistIndex() {
  const { data, error } = await supabase
    .from('watchlist')
    .select('id, kind, card_id, variant_id, display_name, notes')
    .eq('enabled', true)
  if (error) throw new Error(`watchlist load: ${error.message}`)

  // Index by card_id for quick lookup. A given card_id may have multiple
  // watchlist entries (e.g. graded + raw versions).
  const byCardId = new Map()
  for (const row of data ?? []) {
    if (!row.card_id) continue
    if (!byCardId.has(row.card_id)) byCardId.set(row.card_id, [])
    byCardId.get(row.card_id).push(row)
  }
  return byCardId
}

/**
 * For a parsed PC row, find matching watchlist items.
 * Match strategy:
 *   1. Look up by card_code (normalized to our format: OP05-119).
 *   2. If multiple watchlist rows match (graded + raw), return them all
 *      so each gets its own snapshot (same pop, different intent).
 */
function matchToWatchlist(pcRow, index) {
  const cc = pcRow.card_code.toUpperCase()
  // Normalize "OP05119" → "OP05-119" if needed
  const normalized = cc.includes('-')
    ? cc
    : cc.replace(/^([A-Z]+)(\d{2})(\d{3})$/, '$1$2-$3')

  return index.get(normalized) ?? []
}

// ─── orchestration ─────────────────────────────────────────────────────────

async function main() {
  const startedAt = new Date()
  const sets = SET_FILTER ? PC_SETS.filter((s) => s.slug === SET_FILTER) : PC_SETS
  if (sets.length === 0) { console.error(`unknown set: ${SET_FILTER}`); process.exit(1) }

  console.log(`pricecharting ingester: ${sets.length} set(s), dry=${DRY}`)

  let runId = null
  let watchlistIndex = new Map()
  if (DRY) {
    console.log('  [dry] skipping DB load; will not attempt to match against watchlist')
  } else {
    watchlistIndex = await loadWatchlistIndex()
    console.log(`  watchlist index: ${watchlistIndex.size} unique card_ids`)
    if (watchlistIndex.size === 0) {
      console.log('  WARN: watchlist is empty. Snapshots will be parsed and discarded.')
      console.log('        Run: node scripts/market/seed-watchlist-op.mjs')
    }
    const { data, error } = await supabase
      .from('worker_runs')
      .insert({ source: 'pricecharting', started_at: startedAt.toISOString(), status: 'running' })
      .select('id').single()
    if (error) throw new Error(`worker_runs insert: ${error.message}`)
    runId = data.id
  }

  let setsProcessed = 0
  let rowsParsed = 0
  let snapshotsWritten = 0
  let unmatched = 0
  let errors = 0

  // Side product: a map of card_code → [{ pc_set, pc_url, variants }]. This
  // is everything the per-card price ingester needs to know to visit each
  // PC card page directly. Persisted under scripts/market/data/pc-urls.json
  // so subsequent ingester runs don't have to re-discover.
  const urlMap = new Map()

  for (const set of sets) {
    process.stdout.write(`\n→ ${set.label.padEnd(40)} (${set.slug})\n`)
    try {
      const { url, html } = await fetchSetPop(set.slug)
      const rows = parsePopPage(html, url)
      console.log(`  parsed ${rows.length} pop rows`)
      rowsParsed += rows.length

      // Side: build the card_code → PC URL map for downstream tools.
      for (const r of rows) {
        const key = r.card_code.toUpperCase()
        if (!urlMap.has(key)) urlMap.set(key, [])
        urlMap.get(key).push({
          pc_set: set.slug,
          pc_label: set.label,
          pc_name: r.name,
          pc_url: r.item_url,
          variants: r.variants,
        })
      }

      if (DRY) {
        // Show a few interesting examples in dry mode
        const interesting = rows
          .filter((r) => r.grade_total != null && r.grade_total > 0)
          .slice(0, 5)
        for (const r of interesting) {
          console.log(
            `    ${r.card_code.padEnd(8)} ${(r.name.slice(0, 50)).padEnd(50)} ` +
            `g7=${r.grade_7 ?? '-'} g8=${r.grade_8 ?? '-'} g9=${r.grade_9 ?? '-'} g10=${r.grade_10 ?? '-'} ` +
            `total=${r.grade_total ?? '-'}`
          )
        }
        continue
      }

      // Insert snapshots in batches.
      const batch = []
      for (const r of rows) {
        const matches = matchToWatchlist(r, watchlistIndex)
        if (matches.length === 0) { unmatched++; continue }
        for (const wl of matches) {
          batch.push({
            watchlist_id: wl.id,
            source: 'pricecharting_combined',
            grade_total: r.grade_total,
            grade_10:    r.grade_10,
            grade_9:     r.grade_9,
            grade_8:     r.grade_8,
            grade_7:     r.grade_7,
            grade_6:     r.grade_6,
            raw: {
              pc_set:     set.slug,
              pc_label:   set.label,
              pc_url:     r.item_url,
              pc_name:    r.name,
              pc_variants: r.variants,
            },
          })
        }
      }

      if (batch.length === 0) {
        console.log(`  ${rows.length} rows parsed, 0 matched watchlist items, 0 written`)
        continue
      }

      const BATCH = 200
      for (let i = 0; i < batch.length; i += BATCH) {
        const slice = batch.slice(i, i + BATCH)
        const { error } = await supabase.from('psa_pop_snapshots').insert(slice)
        if (error) {
          console.error(`  insert error: ${error.message}`)
          errors++
          continue
        }
        snapshotsWritten += slice.length
      }
      console.log(`  wrote ${batch.length} snapshots`)
      setsProcessed++

    } catch (err) {
      errors++
      console.error(`  ERR: ${err.message}`)
    }

    await sleep(800) // polite spacing between set requests
  }

  if (!DRY && runId != null) {
    await supabase
      .from('worker_runs')
      .update({
        finished_at: new Date().toISOString(),
        status: errors === 0 ? 'ok' : (setsProcessed > 0 ? 'partial' : 'failed'),
        items_processed: snapshotsWritten,
        api_calls: sets.length,
        errors,
        notes: `sets=${setsProcessed}/${sets.length} rows_parsed=${rowsParsed} ` +
               `snapshots=${snapshotsWritten} unmatched=${unmatched}`,
      })
      .eq('id', runId)
  }

  // Persist the URL map (always, even in dry mode - it's useful).
  if (urlMap.size > 0) {
    const dataDir = resolve(__dirname, 'data')
    mkdirSync(dataDir, { recursive: true })
    const out = Object.fromEntries(
      [...urlMap.entries()].sort(([a], [b]) => a.localeCompare(b))
    )
    const path = resolve(dataDir, 'pc-urls.json')
    writeFileSync(path, JSON.stringify(out, null, 2))
    console.log(`\nwrote URL map: ${urlMap.size} card codes → ${path}`)
  }

  console.log('')
  console.log(`done. sets=${setsProcessed}/${sets.length} rows_parsed=${rowsParsed} ` +
              `snapshots=${snapshotsWritten} unmatched=${unmatched} errors=${errors}`)
}

// ─── helpers ───────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)) }

function parseArgs(args) {
  const out = {}
  for (const a of args) {
    if (a === '--dry') out.dry = true
    else if (a.startsWith('--set=')) out.set = a.slice(6)
  }
  return out
}

main().catch((err) => {
  console.error('fatal:', err)
  process.exit(1)
})
