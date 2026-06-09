#!/usr/bin/env node
/**
 * Fetches TCGplayer market prices for every Pokémon card in the bundle and
 * writes src/lib/pricing-pokemon.json in the same CardPricing shape the One
 * Piece / Gundam pipelines produce. Also appends a daily snapshot to
 * src/lib/price-history-pokemon.json for the lightbox sparkline.
 *
 * Source: pokemontcg.io v2 - the same API the catalog comes from. Every card
 * payload embeds a `tcgplayer.prices` block (real TCGplayer market data,
 * refreshed daily upstream), so pricing the whole catalog is ~220 set-page
 * requests, no scraping and no key strictly required.
 *
 *   POKEMONTCG_API_KEY in .env.local lifts the rate limit (30/min -> 'lots').
 *
 * ID mapping: the bundle merges TCGplayer subset sets into their parents
 * (swsh9tg-TG01 -> swsh9-TG01, swsh12pt5gg-GG01 -> swsh12pt5-GG01,
 * swsh45sv-SV001 -> swsh45-SV001). We fetch ALL API sets and remap ids that
 * miss the bundle by stripping the tg/gg/sv suffix from the set part.
 *
 * Run:  node scripts/market/fetch-pokemon-pricing.mjs
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(__dirname, '..', '..')

function loadEnv() {
  try {
    const txt = readFileSync(join(projectRoot, '.env.local'), 'utf-8')
    for (const raw of txt.split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
      if (m) process.env[m[1]] ??= m[2]
    }
  } catch { /* no .env.local - fine, key is optional */ }
}
loadEnv()

const API = 'https://api.pokemontcg.io/v2'
const API_KEY = process.env.POKEMONTCG_API_KEY
const HEADERS = API_KEY ? { 'X-Api-Key': API_KEY } : {}
// Unauthenticated tier is 30 req/min; keyed tier is far higher.
const THROTTLE_MS = API_KEY ? 300 : 2100

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getJson(url, retries = 4) {
  for (let attempt = 0; ; attempt++) {
    try {
      const r = await fetch(url, { headers: HEADERS })
      if (r.status === 429 || r.status >= 500) throw new Error(`HTTP ${r.status}`)
      if (!r.ok) return null
      return await r.json()
    } catch (err) {
      if (attempt >= retries) throw err
      await sleep(Math.min(2000 * 2 ** attempt, 30000))
    }
  }
}

// ── Bundle ids ────────────────────────────────────────────────────────────────
const cards = JSON.parse(readFileSync(join(projectRoot, 'src/lib/cards-pokemon.json'), 'utf-8'))
const ourIds = new Set(cards.map((c) => c.id))
const cardById = new Map(cards.map((c) => [c.id, c]))

/**
 * Map a pokemontcg.io card id onto our bundle id(s). Subset sets (Trainer
 * Gallery / Galarian Gallery / Shiny Vault) exist in the bundle BOTH under
 * their own set id (swsh9tg-TG01) and merged into the parent (swsh9-TG01),
 * so one API card can price two bundle entries.
 */
function resolveOurIds(apiId) {
  const out = []
  if (ourIds.has(apiId)) out.push(apiId)
  const remapped = apiId.replace(/^([a-z0-9]+?)(tg|gg|sv)-/i, '$1-')
  if (remapped !== apiId && ourIds.has(remapped)) out.push(remapped)
  return out
}

// ── Price extraction ──────────────────────────────────────────────────────────
// TCGplayer subtype keys in rough "canonical print first" order. primaryMarket
// uses the first subtype that has a market (falls back to mid).
const SUBTYPE_PRIORITY = [
  'holofoil', 'normal', 'reverseHolofoil',
  '1stEditionHolofoil', '1stEditionNormal',
  'unlimitedHolofoil', 'unlimited',
]
const SUBTYPE_LABEL = {
  holofoil: 'Holofoil',
  normal: 'Normal',
  reverseHolofoil: 'Reverse Holo',
  '1stEditionHolofoil': '1st Ed. Holofoil',
  '1stEditionNormal': '1st Ed. Normal',
  unlimitedHolofoil: 'Unlimited Holo',
  unlimited: 'Unlimited',
}

function toCardPricing(apiCard, ourId, syncedAt) {
  const prices = apiCard.tcgplayer?.prices
  if (!prices) return null
  const raw = {}
  let primaryMarket = null
  let primarySubtype = null
  const keys = [
    ...SUBTYPE_PRIORITY.filter((k) => prices[k]),
    ...Object.keys(prices).filter((k) => !SUBTYPE_PRIORITY.includes(k)),
  ]
  for (const k of keys) {
    const p = prices[k]
    if (!p) continue
    const market = p.market ?? p.mid ?? null
    raw[SUBTYPE_LABEL[k] ?? k] = {
      market,
      low: p.low ?? null,
      high: p.high ?? null,
    }
    if (primaryMarket === null && market !== null) {
      primaryMarket = market
      primarySubtype = SUBTYPE_LABEL[k] ?? k
    }
  }
  if (primaryMarket === null) return null
  const our = cardById.get(ourId)
  return {
    tcgplayerId: 0,
    cardCode: ourId,
    name: apiCard.name,
    rarity: our?.rarity ?? apiCard.rarity ?? null,
    setAbbr: our?.setCode ?? null,
    syncedAt,
    source: 'tcgplayer',
    raw,
    graded: [],
    ebayRaw: {},
    primaryMarket,
    primarySubtype,
    matchMethod: 'api_id',
    matchConfidence: 1,
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const syncedAt = new Date().toISOString()
const outPath = join(projectRoot, 'src/lib/pricing-pokemon.json')
const historyPath = join(projectRoot, 'src/lib/price-history-pokemon.json')

console.log('━━━ Pokémon pricing pipeline (pokemontcg.io / TCGplayer) ━━━')
console.log(`Bundle cards: ${cards.length}  api key: ${API_KEY ? 'yes' : 'NO (throttled)'}`)

const setsResp = await getJson(`${API}/sets?pageSize=250&select=id,name,total`)
const apiSets = setsResp?.data ?? []
console.log(`API sets: ${apiSets.length}`)

const output = { syncedAt, cards: {} }
let priced = 0
let unmatched = 0

for (let si = 0; si < apiSets.length; si++) {
  const set = apiSets[si]
  let page = 1
  for (;;) {
    const url = `${API}/cards?q=set.id:${set.id}&select=id,name,rarity,tcgplayer&pageSize=250&page=${page}`
    let resp
    try {
      resp = await getJson(url)
    } catch (err) {
      console.error(`  x ${set.id} p${page}: ${err.message} - skipping rest of set`)
      break
    }
    const batch = resp?.data ?? []
    for (const apiCard of batch) {
      const targets = resolveOurIds(apiCard.id)
      if (targets.length === 0) { unmatched++; continue }
      for (const ourId of targets) {
        const entry = toCardPricing(apiCard, ourId, syncedAt)
        if (entry) {
          output.cards[ourId] = entry
          priced++
        }
      }
    }
    if (batch.length < 250) break
    page++
    await sleep(THROTTLE_MS)
  }
  if ((si + 1) % 20 === 0 || si === apiSets.length - 1) {
    console.log(`  ${si + 1}/${apiSets.length} sets  (priced=${priced})`)
    writeFileSync(outPath, JSON.stringify(output))
  }
  await sleep(THROTTLE_MS)
}

writeFileSync(outPath, JSON.stringify(output))

// ── History snapshot (same pattern as Gundam) ─────────────────────────────────
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
console.log(`  Priced:            ${priced} / ${cards.length} bundle cards`)
console.log(`  Unmatched API ids: ${unmatched}`)
console.log(`  History snapshots: +${historyAdded}`)
console.log(`  Written: ${outPath}`)
console.log(`  Written: ${historyPath}`)
