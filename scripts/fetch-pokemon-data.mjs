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

const allCards = []
let setIdx = 0
for (const s of sets) {
  setIdx += 1
  process.stdout.write(`  [${setIdx}/${sets.length}] ${s.id} (${s.name})... `)
  const cards = await fetchCardsForSet(s.id)
  console.log(`${cards.length} cards`)
  allCards.push(...cards)
  await sleep(100)
}

writeFileSync(OUT, JSON.stringify(allCards, null, 2))
console.log(`\nWrote ${allCards.length} cards across ${sets.length} sets`)
console.log(`  ${OUT}`)
console.log(`  ${OUT_SETS}`)
