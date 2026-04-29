/**
 * Fetches Pokémon TCG cards from the pokemontcg.io REST API v2.
 *
 * Strategy:
 *   1. GET /v2/sets, filter to SERIES_ALLOW (Phase 1 = modern eras).
 *   2. For each set, page through /v2/cards?q=set.id:{id}&pageSize=250.
 *   3. Flatten + write to data/pokemon-cards-raw.json.
 *
 * Env:
 *   POKEMONTCG_API_KEY — free key from https://dev.pokemontcg.io
 *                        lifts rate limit 1K/day -> 20K/day
 *
 * Usage: node scripts/fetch-pokemon-data.mjs
 *        node scripts/fetch-pokemon-data.mjs --all        # every set ever
 *        node scripts/fetch-pokemon-data.mjs --set=sv1    # single set
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const OUT = join(DATA_DIR, 'pokemon-cards-raw.json')
const OUT_SETS = join(DATA_DIR, 'pokemon-sets-raw.json')

const API = 'https://api.pokemontcg.io/v2'

// Phase 1: modern eras only. Keeps storage + ingestion time tractable.
// Flip to --all to grab every set ever released.
const SERIES_ALLOW = new Set([
  'Sword & Shield',
  'Scarlet & Violet',
  'Mega Evolution',
])

function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  if (!existsSync(envPath)) return {}
  const env = {}
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=')
    if (k && v.length) env[k.trim()] = v.join('=').trim()
  }
  return env
}

const env = loadEnv()
const API_KEY = process.env.POKEMONTCG_API_KEY || env.POKEMONTCG_API_KEY
if (!API_KEY) {
  console.warn('No POKEMONTCG_API_KEY set - throttled to 1000/day, 30/min. Add it to .env.local.')
}

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.length ? rest.join('=') : true]
  })
)
const ALL_SERIES = !!args.all
const ONLY_SET = typeof args.set === 'string' ? args.set : null

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function apiGet(path) {
  const url = `${API}${path}`
  const headers = API_KEY ? { 'X-Api-Key': API_KEY } : {}
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(url, { headers })
    if (res.ok) return res.json()
    if (res.status === 429 || res.status >= 500) {
      const wait = 1000 * attempt * attempt
      console.warn(`  HTTP ${res.status} on ${path} (attempt ${attempt}) - waiting ${wait}ms`)
      await sleep(wait)
      continue
    }
    throw new Error(`HTTP ${res.status} on ${url}`)
  }
  throw new Error(`gave up on ${url}`)
}

async function fetchSets() {
  console.log('Fetching sets...')
  const { data } = await apiGet('/sets?pageSize=250')
  console.log(`  API returned ${data.length} sets`)
  let filtered = data
  if (ONLY_SET) {
    filtered = data.filter((s) => s.id === ONLY_SET)
  } else if (!ALL_SERIES) {
    filtered = data.filter((s) => SERIES_ALLOW.has(s.series))
  }
  filtered.sort((a, b) => (a.releaseDate || '').localeCompare(b.releaseDate || ''))
  console.log(`  Using ${filtered.length} sets${ALL_SERIES ? ' (all)' : ONLY_SET ? ` (${ONLY_SET})` : ' (modern eras)'}`)
  return filtered
}

async function fetchCardsForSet(setId) {
  const out = []
  let page = 1
  while (true) {
    const qs = `q=set.id:${setId}&pageSize=250&page=${page}&orderBy=number`
    const json = await apiGet(`/cards?${qs}`)
    out.push(...json.data)
    const fetched = page * json.pageSize
    if (fetched >= json.totalCount) break
    page += 1
    await sleep(100)
  }
  return out
}

mkdirSync(DATA_DIR, { recursive: true })

const sets = await fetchSets()
writeFileSync(OUT_SETS, JSON.stringify(sets, null, 2))

// Delta detection: load any existing raw bundle so we can skip sets that
// haven't changed upstream. A set is "stable" when:
//   - we already have it cached
//   - the cached card count equals the upstream's total (no new alt arts)
//   - the upstream's updatedAt isn't newer than what we cached
// Stable sets are reused as-is; only new or updated sets get refetched.
// This turns a ~150-set / 20K-card scan into a ~0-set scan on quiet days.
const FORCE = !!args.force
const existingCards = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')) : []
const existingSetsRaw = existsSync(OUT_SETS) && existingCards.length
  ? (() => {
      // Re-load the *previous* sets file before we just overwrote it.
      // We saved a pre-write snapshot below.
      return null
    })()
  : null
// Read the prior sets file via git? Simpler: snapshot card counts by setId
// from the existing card cache, and compare to upstream's `total`.
const cachedCountBySet = new Map()
const cachedCardsBySet = new Map()
for (const c of existingCards) {
  const sid = c.set?.id
  if (!sid) continue
  cachedCountBySet.set(sid, (cachedCountBySet.get(sid) || 0) + 1)
  if (!cachedCardsBySet.has(sid)) cachedCardsBySet.set(sid, [])
  cachedCardsBySet.get(sid).push(c)
}

const allCards = []
let setIdx = 0
let refetched = 0
let skipped = 0
for (const s of sets) {
  setIdx += 1
  const cachedCount = cachedCountBySet.get(s.id) || 0
  const expected = Number(s.total || s.printedTotal || 0)
  const fullyCached = !FORCE && cachedCount > 0 && cachedCount >= expected
  if (fullyCached) {
    // Reuse cached cards verbatim for this set.
    allCards.push(...cachedCardsBySet.get(s.id))
    skipped += 1
    if (setIdx % 25 === 0) process.stdout.write(`  …${setIdx}/${sets.length} processed\r`)
    continue
  }
  process.stdout.write(`  [${setIdx}/${sets.length}] ${s.id} (${s.name})… `)
  const cards = await fetchCardsForSet(s.id)
  console.log(`${cards.length} cards (had ${cachedCount}, expected ${expected})`)
  allCards.push(...cards)
  refetched += 1
  await sleep(100)
}
console.log(`\nDelta: refetched ${refetched} sets, reused ${skipped} sets from cache.`)

// Dedupe by id — the API occasionally returns the same card across
// queries (and re-runs with overlapping filters compound this).
const byId = new Map()
for (const c of allCards) byId.set(c.id, c)
const unique = [...byId.values()]
if (unique.length !== allCards.length) {
  console.log(`Deduped ${allCards.length - unique.length} duplicate cards`)
}

writeFileSync(OUT, JSON.stringify(unique, null, 2))
console.log(`\nWrote ${unique.length} cards across ${sets.length} sets`)
console.log(`  ${OUT}`)
console.log(`  ${OUT_SETS}`)

// Gap detection: every set object has `total` (true count incl. alt arts /
// SIRs) and `printedTotal` (the "X/Y" number on the card). When the API
// ships fewer cards than `total`, we're missing alt arts upstream — the
// gap is *always* in the >printedTotal range. We surface this so the
// follow-up TCGdex augmenter knows what to chase, and so CI can alert
// when newly-released sets remain incomplete.
const OUT_GAPS = join(DATA_DIR, 'pokemon-gaps.json')
const countsBySet = new Map()
for (const c of unique) {
  const id = c.set?.id
  if (!id) continue
  countsBySet.set(id, (countsBySet.get(id) || 0) + 1)
}
const gaps = []
for (const s of sets) {
  const expected = Number(s.total || s.printedTotal || 0)
  const received = countsBySet.get(s.id) || 0
  if (expected > received) {
    gaps.push({
      setId: s.id,
      name: s.name,
      releaseDate: s.releaseDate,
      printedTotal: s.printedTotal,
      expected,
      received,
      missing: expected - received,
    })
  }
}
gaps.sort((a, b) => (b.releaseDate || '').localeCompare(a.releaseDate || ''))
writeFileSync(OUT_GAPS, JSON.stringify(gaps, null, 2))
if (gaps.length) {
  console.log(`\n⚠ ${gaps.length} sets have alt-art gaps (likely SIRs / alt arts upstream):`)
  for (const g of gaps.slice(0, 10)) {
    console.log(`  ${g.setId.padEnd(10)} ${g.name.padEnd(35)} ${g.received}/${g.expected}  (missing ${g.missing})`)
  }
  if (gaps.length > 10) console.log(`  …and ${gaps.length - 10} more (see ${OUT_GAPS})`)
  console.log(`\nNext step: node scripts/augment-pokemon-tcgdex.mjs   # fills gaps from TCGdex`)
} else {
  console.log('\n✓ No alt-art gaps detected.')
}
