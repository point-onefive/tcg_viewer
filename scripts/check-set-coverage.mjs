/**
 * Simple coverage checker: compares the set names we ship on the site
 * (src/lib/sets-{tcg}.json) against the latest set list from each TCG's
 * upstream source. Flags anything upstream that we don't have yet.
 *
 * Read-only. No data files are written, no images downloaded.
 *
 * Usage:
 *   node scripts/check-set-coverage.mjs              # all TCGs
 *   node scripts/check-set-coverage.mjs pokemon      # one TCG
 *   node scripts/check-set-coverage.mjs digimon dbs  # subset
 */

import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

// Mirror SERIES_ALLOW from scripts/fetch-pokemon-data.mjs so we only flag
// sets within the eras the site actually ingests.
const POKEMON_SERIES_ALLOW = new Set([
  'Sword & Shield',
  'Scarlet & Violet',
  'Mega Evolution',
])

function loadEnv() {
  const envPath = join(ROOT, '.env.local')
  try {
    const env = {}
    for (const line of readFileSync(envPath, 'utf8').split('\n')) {
      const [k, ...v] = line.split('=')
      if (k && v.length) env[k.trim()] = v.join('=').trim()
    }
    return env
  } catch {
    return {}
  }
}

async function fetchText(url, init = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...(init.headers || {}) }, ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

async function fetchJSON(url, init = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...(init.headers || {}) }, ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.json()
}

function loadLocalSets(file) {
  const path = join(ROOT, 'src', 'lib', file)
  return JSON.parse(readFileSync(path, 'utf8'))
}

function norm(s) {
  // Lowercase, strip punctuation/whitespace, then strip leading zeros from any
  // digit run so BT01 / BT1 / op-01 / OP1 all collapse to the same key.
  return String(s || '')
    .toLowerCase()
    .replace(/[\s\-_:.()\[\]'"]+/g, '')
    .replace(/(\D)0+(\d)/g, '$1$2')
    .replace(/^0+(\d)/, '$1')
    .trim()
}

// ---------- Upstream fetchers ----------

async function upstreamOnePiece() {
  const packs = await fetchJSON(
    'https://raw.githubusercontent.com/coko7/vegapull-records/main/data/english/packs.json'
  )
  return packs.map((p) => ({
    code: p.id,
    name: p.title_parts?.label || p.title || p.id,
  }))
}

async function upstreamPokemon() {
  const env = loadEnv()
  const key = process.env.POKEMONTCG_API_KEY || env.POKEMONTCG_API_KEY
  const headers = key ? { 'X-Api-Key': key } : {}
  const data = await fetchJSON('https://api.pokemontcg.io/v2/sets?pageSize=250', { headers })
  return data.data
    .filter((s) => POKEMON_SERIES_ALLOW.has(s.series))
    .map((s) => ({ code: s.id, name: s.name, releaseDate: s.releaseDate, series: s.series }))
}

async function upstreamDigimon() {
  const html = await fetchText('https://world.digimoncard.com/cardlist/')
  const sel = html.match(/<select[^>]*name="category"[^>]*>([\s\S]*?)<\/select>/)
  if (!sel) throw new Error('digimon: category select not found')
  const out = []
  const re = /<option\s+value="(\d+)"[^>]*>([^<]+)<\/option>/g
  let m
  while ((m = re.exec(sel[1]))) {
    if (m[1] === '0') continue
    const raw = m[2].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').trim()
    const codeMatch = raw.match(/\[([^\]]+)\]\s*$/)
    const code = codeMatch ? codeMatch[1].replace(/-/g, '') : null
    const name = raw.replace(/\s*\[[^\]]+\]\s*$/, '').trim()
    out.push({ code, name, rawLabel: raw })
  }
  return out
}

async function upstreamDbs() {
  const html = await fetchText('https://www.dbs-cardgame.com/fw/en/cardlist/')
  const re = /data-val="(\d{6})"[^>]*>([^<]+?)<\/a>/g
  const out = []
  const seen = new Set()
  let m
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    const raw = m[2].replace(/&nbsp;/g, ' ').trim()
    const codeMatch = raw.match(/\[([A-Z0-9]+)\]\s*$/)
    const code = codeMatch ? codeMatch[1] : null
    const name = raw.replace(/\s*\[[A-Z0-9]+\]\s*$/, '').trim()
    out.push({ code, name, rawLabel: raw })
  }
  return out
}

async function upstreamGundam() {
  const html = await fetchText('https://www.gundam-gcg.com/en/cards/')
  // <option value="..." data-val="N">LABEL [CODE]</option>  OR  <a data-val="N">LABEL</a>
  const re = /data-val="(\d+)"[^>]*>([^<]+)<\/(?:a|option)>/g
  const seen = new Map()
  let m
  while ((m = re.exec(html))) {
    if (seen.has(m[1])) continue
    const raw = m[2].replace(/&nbsp;/g, ' ').trim()
    if (!raw || raw === '----------') continue
    seen.set(m[1], raw)
  }
  const out = []
  for (const [, raw] of seen) {
    const codeMatch = raw.match(/\[([A-Z0-9]+)\]\s*$/) || raw.match(/^([A-Z]{2}\d{2})\b/)
    const code = codeMatch ? codeMatch[1] : null
    const name = raw.replace(/\s*\[[A-Z0-9]+\]\s*$/, '').trim()
    out.push({ code, name, rawLabel: raw })
  }
  return out
}

// ---------- Comparison ----------

// Upstream entries that match these codes/names are ignored: they are promo
// or aggregate buckets that don't correspond to a real numbered set release.
// Add to these lists if a new bucket appears that we don't intend to ingest.
const TCGS = {
  'one-piece': {
    label: 'One Piece',
    local: 'sets-one-piece.json',
    fetch: upstreamOnePiece,
    ignoreCodes: ['569901', '569801'], // PROMO + Premium Bandai Exclusives buckets
    ignoreNames: [],
  },
  pokemon: {
    label: 'Pokemon',
    local: 'sets-pokemon.json',
    fetch: upstreamPokemon,
    ignoreCodes: [],
    ignoreNames: [],
  },
  digimon: {
    label: 'Digimon',
    local: 'sets-digimon.json',
    fetch: upstreamDigimon,
    ignoreCodes: ['BT0103'], // Release Special Booster Ver.1.0/1.5 (re-releases)
    ignoreNames: [
      'SPECIAL LIMITED SET',
      'Other Products',
      'Premium Bandai',
      'Store Events',
      'Large-Scale Tournaments',
      'Promo Cards (P-Numbered)',
      'Other Promos',
      'Limited Card Pack BILLION BULLET',
      'Limited Card Pack ANOTHER KNIGHT',
    ],
  },
  dbs: {
    label: 'DBS Fusion',
    local: 'sets-dbs.json',
    fetch: upstreamDbs,
    ignoreCodes: [],
    ignoreNames: ['Release Event Pack'],
  },
  gundam: {
    label: 'Gundam',
    local: 'sets-gundam.json',
    fetch: upstreamGundam,
    ignoreCodes: [],
    ignoreNames: ['Other Product Card', 'Edition Beta', 'Basic Cards', 'Promotion card'],
  },
}

function diff(local, upstream, cfg) {
  // Index local sets under both code and name so an upstream entry can match
  // either field (upstream sources are inconsistent: some give pure codes,
  // some give pure names, some give 'Name [CODE]').
  const localIndex = new Map()
  for (const s of local) {
    if (s.setCode) localIndex.set(norm(s.setCode), s)
    if (s.setName) localIndex.set(norm(s.setName), s)
  }
  const ignoreSet = new Set(
    [...(cfg?.ignoreCodes || []), ...(cfg?.ignoreNames || [])].map(norm)
  )
  const matched = []
  const missing = []
  const ignored = []
  for (const u of upstream) {
    const keys = [u.code, u.name].filter(Boolean).map(norm)
    if (keys.some((k) => ignoreSet.has(k))) {
      ignored.push(u)
      continue
    }
    const hit = keys.map((k) => localIndex.get(k)).find(Boolean)
    if (hit) matched.push({ upstream: u, local: hit })
    else missing.push(u)
  }
  const upstreamKeys = new Set(
    upstream.flatMap((u) => [u.code && norm(u.code), u.name && norm(u.name)].filter(Boolean))
  )
  const orphaned = local.filter(
    (s) => !upstreamKeys.has(norm(s.setCode)) && !upstreamKeys.has(norm(s.setName))
  )
  return { missing, matched, orphaned, ignored }
}

function printReport(label, local, upstream, result, showOrphaned) {
  console.log(`\n=== ${label} ===`)
  console.log(`  local sets:    ${local.length}`)
  console.log(`  upstream sets: ${upstream.length}`)
  console.log(`  matched:       ${result.matched.length}`)
  console.log(`  MISSING on site: ${result.missing.length}`)
  for (const u of result.missing) {
    const code = u.code ? `[${u.code}] ` : ''
    const date = u.releaseDate ? ` (${u.releaseDate})` : ''
    console.log(`    - ${code}${u.name}${date}`)
  }
  if (showOrphaned && result.orphaned.length) {
    console.log(`  Local-only (not seen upstream): ${result.orphaned.length}`)
    for (const s of result.orphaned) {
      console.log(`    - [${s.setCode}] ${s.setName}`)
    }
  }
}

async function main() {
  const flags = process.argv.slice(2).filter((a) => a.startsWith('-'))
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const showOrphaned = flags.includes('--orphans') || flags.includes('--all')
  const asJson = flags.includes('--json')
  const asMarkdown = flags.includes('--markdown')
  const targets = args.length ? args : Object.keys(TCGS)

  const report = []
  for (const key of targets) {
    const cfg = TCGS[key]
    if (!cfg) {
      console.warn(`Unknown TCG: ${key} (valid: ${Object.keys(TCGS).join(', ')})`)
      continue
    }
    try {
      const [local, upstream] = await Promise.all([
        Promise.resolve(loadLocalSets(cfg.local)),
        cfg.fetch(),
      ])
      const result = diff(local, upstream, cfg)
      report.push({ key, label: cfg.label, ok: true, local, upstream, result })
    } catch (err) {
      report.push({ key, label: cfg.label, ok: false, error: err.message })
    }
  }

  const totalMissing = report.reduce((n, r) => n + (r.ok ? r.result.missing.length : 0), 0)
  const anyFailed = report.some((r) => !r.ok)

  if (asJson) {
    console.log(JSON.stringify({ totalMissing, anyFailed, report }, null, 2))
  } else if (asMarkdown) {
    console.log(renderMarkdown(report, totalMissing, anyFailed))
  } else {
    for (const r of report) {
      if (!r.ok) {
        console.error(`\n=== ${r.label} ===`)
        console.error(`  FAILED: ${r.error}`)
        continue
      }
      printReport(r.label, r.local, r.upstream, r.result, showOrphaned)
    }
    console.log(`\nTotal sets missing on site: ${totalMissing}`)
  }

  process.exit(totalMissing > 0 || anyFailed ? 1 : 0)
}

function renderMarkdown(report, totalMissing, anyFailed) {
  const lines = []
  lines.push(`## Set coverage check`)
  lines.push('')
  lines.push(`- Missing sets: **${totalMissing}**`)
  if (anyFailed) lines.push(`- Upstream fetch failures: yes (see below)`)
  lines.push('')
  for (const r of report) {
    if (!r.ok) {
      lines.push(`### ${r.label} — fetch failed`)
      lines.push('```')
      lines.push(r.error)
      lines.push('```')
      lines.push('')
      continue
    }
    if (r.result.missing.length === 0) continue
    lines.push(`### ${r.label} (${r.result.missing.length} missing)`)
    for (const u of r.result.missing) {
      const code = u.code ? `\`${u.code}\` ` : ''
      const date = u.releaseDate ? ` (${u.releaseDate})` : ''
      lines.push(`- ${code}${u.name}${date}`)
    }
    lines.push('')
  }
  if (totalMissing === 0 && !anyFailed) {
    lines.push('All upstream sets accounted for.')
  }
  return lines.join('\n')
}

main()
