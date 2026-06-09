#!/usr/bin/env node
/**
 * Fetches TCGplayer-sourced market prices for every Lorcana card and writes
 * src/lib/pricing-lorcana.json in the shared CardPricing shape, plus a daily
 * snapshot appended to src/lib/price-history-lorcana.json.
 *
 * Source: Lorcast API (https://lorcast.com/docs/api) - community-maintained,
 * no key required, prices are TCGplayer USD (usd = nonfoil, usd_foil = foil).
 *
 * ID mapping: our bundle ids are "lor-<LorcanaJSON int id>". Lorcast keys
 * cards by (set code, collector number). We rebuild the join through the
 * LorcanaJSON payload (fetched live so this script has no dependency on the
 * gitignored data/ dir):
 *   - main-set prints (incl. Enchanted): setCode + number
 *   - promo prints (rarity "Special"):   the "N/P1"-style token in
 *     fullIdentifier maps to Lorcast's promo sets (P1, P2, D23, ...)
 *
 * Run:  node scripts/market/fetch-lorcana-pricing.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')

const LORCANAJSON_URL = 'https://lorcanajson.org/files/current/en/allCards.json'
const LORCAST = 'https://api.lorcast.com/v0'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, retries = 3) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'tcg_viewer pricing' } })
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`)
      if (!r.ok) return null
      return await r.json()
    } catch (err) {
      if (attempt >= retries) throw err
      await sleep(Math.min(2000 * 2 ** attempt, 15000))
    }
  }
}

// ── Build (set, number) -> our id join via LorcanaJSON ────────────────────────
console.log('━━━ Lorcana pricing pipeline (Lorcast / TCGplayer) ━━━')
console.log('Fetching LorcanaJSON for the id join…')
const lj = await getJson(LORCANAJSON_URL)
if (!lj?.cards?.length) {
  console.error('Could not fetch LorcanaJSON - aborting')
  process.exit(1)
}

const bundle = JSON.parse(readFileSync(join(projectRoot, 'src/lib/cards-lorcana.json'), 'utf-8'))
const bundleIds = new Set(bundle.map((c) => c.id))

// Key formats:  "1|12"  (main set 1, card 12)   "P1|4"  (promo set P1, #4)
const keyToOurId = new Map()
for (const c of lj.cards) {
  const ourId = `lor-${c.id}`
  if (!bundleIds.has(ourId)) continue
  if (c.rarity === 'Special') {
    // Promo print: find the "N/P1"-style token (digit(s) "/" letter-led code).
    const m = (c.fullIdentifier || '').match(/(\d+[a-z]?)\/([A-Za-z][A-Za-z0-9]*)/)
    if (m) keyToOurId.set(`${m[2].toUpperCase()}|${m[1].replace(/^0+/, '')}`, ourId)
  } else {
    keyToOurId.set(`${String(c.setCode).toUpperCase()}|${c.number}`, ourId)
  }
}
console.log(`Join keys built: ${keyToOurId.size} (bundle: ${bundle.length})`)

// ── Walk every Lorcast set ────────────────────────────────────────────────────
const setsResp = await getJson(`${LORCAST}/sets`)
const sets = setsResp?.results ?? []
console.log(`Lorcast sets: ${sets.length}`)

const syncedAt = new Date().toISOString()
const outPath = join(projectRoot, 'src/lib/pricing-lorcana.json')
const historyPath = join(projectRoot, 'src/lib/price-history-lorcana.json')
const cardMetaById = new Map(bundle.map((c) => [c.id, c]))

const output = { syncedAt, cards: {} }
let priced = 0
let unmatched = 0

for (const set of sets) {
  const cardsResp = await getJson(`${LORCAST}/sets/${set.code}/cards`)
  const setCards = Array.isArray(cardsResp) ? cardsResp : (cardsResp?.results ?? [])
  let setPriced = 0
  for (const c of setCards) {
    const num = String(c.collector_number || '').replace(/^0+/, '')
    const ourId = keyToOurId.get(`${String(set.code).toUpperCase()}|${num}`)
    if (!ourId) { unmatched++; continue }
    const usd = c.prices?.usd != null ? parseFloat(c.prices.usd) : null
    const usdFoil = c.prices?.usd_foil != null ? parseFloat(c.prices.usd_foil) : null
    if (usd === null && usdFoil === null) continue
    const raw = {}
    if (usd !== null) raw.Normal = { market: usd, low: null, high: null }
    if (usdFoil !== null) raw.Foil = { market: usdFoil, low: null, high: null }
    // Canonical print first: nonfoil when it exists, else foil (Enchanted
    // and most promos are foil-only).
    const primarySubtype = usd !== null ? 'Normal' : 'Foil'
    const meta = cardMetaById.get(ourId)
    output.cards[ourId] = {
      tcgplayerId: c.tcgplayer_id ?? 0,
      cardCode: meta?.code ?? ourId,
      name: meta?.name ?? c.name,
      rarity: meta?.rarity ?? c.rarity ?? null,
      setAbbr: meta?.setCode ?? null,
      syncedAt,
      source: 'tcgplayer',
      raw,
      graded: [],
      ebayRaw: {},
      primaryMarket: usd ?? usdFoil,
      primarySubtype,
      matchMethod: 'set_number_join',
      matchConfidence: 1,
    }
    priced++
    setPriced++
  }
  console.log(`  ${String(set.code).padEnd(4)} ${set.name.padEnd(28)} ${setPriced}/${setCards.length} priced`)
  await sleep(250)
}

writeFileSync(outPath, JSON.stringify(output))

// ── History snapshot ──────────────────────────────────────────────────────────
const nowMs = Date.now()
let history = { syncedAt, series: {} }
if (existsSync(historyPath)) {
  try { history = JSON.parse(readFileSync(historyPath, 'utf-8')) } catch { /* fresh */ }
}
let historyAdded = 0
for (const [id, entry] of Object.entries(output.cards)) {
  if (!entry.primaryMarket) continue
  const series = history.series[id] ?? []
  const last = series[series.length - 1]
  if (last && nowMs - last[0] < 12 * 60 * 60 * 1000) continue
  series.push([nowMs, entry.primaryMarket])
  history.series[id] = series
  historyAdded++
}
history.syncedAt = syncedAt
writeFileSync(historyPath, JSON.stringify(history))

console.log('\n━━━ Done ━━━')
console.log(`  Priced:           ${priced} / ${bundle.length} bundle cards`)
console.log(`  Unmatched Lorcast cards: ${unmatched}`)
console.log(`  History snapshots: +${historyAdded}`)
console.log(`  Written: ${outPath}`)
console.log(`  Written: ${historyPath}`)
