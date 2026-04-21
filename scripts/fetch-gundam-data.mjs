/**
 * Scrapes Gundam Card Game cards from the official Bandai site.
 * Source: https://www.gundam-gcg.com/en/cards/
 *
 * Strategy:
 *   1. GET the search page to discover all package codes (ST01-ST09, GD01-GD04, etc.)
 *   2. For each package, POST /en/cards/index.php?package={code} to list all card IDs
 *   3. For each card ID, GET /en/cards/detail.php?detailSearch={id} to extract metadata
 *
 * Output: data/gundam-cards-raw.json (feeds into generate-gundam-data.mjs)
 *
 * Usage: node scripts/fetch-gundam-data.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const OUT = join(DATA_DIR, 'gundam-cards-raw.json')

const BASE = 'https://www.gundam-gcg.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url, init = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...init.headers }, ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

async function fetchPackList() {
  const html = await fetchText(`${BASE}/en/cards/`, { method: 'GET' })
  const re = /data-val="(\d+)"[^>]*>([^<]+)<\/a>/g
  const packs = new Map()
  let m
  while ((m = re.exec(html))) {
    const [, code, label] = m
    packs.set(code, label.trim())
  }
  // Dedupe + return sorted by numeric code
  return Array.from(packs, ([code, label]) => ({ code, label }))
    .sort((a, b) => Number(a.code) - Number(b.code))
}

async function fetchCardIdsForPack(packCode) {
  const body = new URLSearchParams({ search: 'true', package: packCode, freeword: '' }).toString()
  const html = await fetchText(`${BASE}/en/cards/index.php`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })
  // Card IDs look like: detail.php?detailSearch=GD01-001_p1  (or no _p suffix)
  const re = /detailSearch=([A-Z]{2,3}\d{2}-\d{3}(?:_[pr]\d+)?)/g
  const ids = new Set()
  let m
  while ((m = re.exec(html))) ids.add(m[1])
  return Array.from(ids)
}

function extractField(html, label) {
  // Matches <dt class="dataTit">LABEL</dt> ... <dd class="dataTxt...">VALUE</dd>
  const re = new RegExp(
    `<dt[^>]*class="dataTit"[^>]*>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*</dt>[\\s\\S]*?<dd[^>]*class="dataTxt[^"]*"[^>]*>([\\s\\S]*?)</dd>`
  )
  const m = html.match(re)
  return m ? cleanText(m[1]) : ''
}

function cleanText(s) {
  return s
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#039;/g, "'")
    .replace(/\u00a0/g, ' ')
    .replace(/\s+\n/g, '\n')
    .trim()
}

async function fetchCardDetail(id) {
  const html = await fetchText(`${BASE}/en/cards/detail.php?detailSearch=${id}`)
  const name = (html.match(/<h1[^>]*class="cardName"[^>]*>([^<]+)<\/h1>/) || [])[1]?.trim() || ''
  const rarity = (html.match(/<div[^>]*class="rarity"[^>]*>([^<]+)<\/div>/) || [])[1]?.trim() || ''
  const blockIcon = (html.match(/<div[^>]*class="blockIcon"[^>]*>([^<]+)<\/div>/) || [])[1]?.trim() || ''
  const imgMatch = html.match(/<img\s+src=\s*"([^"]+cards\/card\/[^"]+\.webp)[^"]*"[^>]*alt="[^"]*"\s*>/)
  const imgPath = imgMatch ? imgMatch[1].replace(/^\.\.\//, '/en/') : ''

  const record = {
    id,
    name,
    rarity,
    blockIcon,
    // Absolute image URL (webp, ~65KB each)
    imageUrl: imgPath ? `${BASE}${imgPath.replace(/\?.*$/, '').replace(/^\/en\//, '/en/')}` : '',
    level: extractField(html, 'Lv\\.'),
    cost: extractField(html, 'COST'),
    color: extractField(html, 'COLOR'),
    type: extractField(html, 'TYPE'),
    zone: extractField(html, 'Zone'),
    trait: extractField(html, 'Trait'),
    link: extractField(html, 'Link'),
    ap: extractField(html, 'AP'),
    hp: extractField(html, 'HP'),
    sourceTitle: extractField(html, 'Source Title'),
    effect: extractCardText(html),
    pack: extractField(html, 'Where to get it'),
  }
  return record
}

function extractCardText(html) {
  // Card effect is in <div class="cardDataRow overview"><div class="dataTxt isRegular">...</div></div>
  const m = html.match(/<div[^>]*class="cardDataRow overview"[^>]*>[\s\S]*?<div[^>]*class="dataTxt isRegular"[^>]*>([\s\S]*?)<\/div>/)
  return m ? cleanText(m[1]) : ''
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  // Resume support: if OUT exists, skip IDs already fetched
  let existing = []
  if (existsSync(OUT)) {
    try {
      existing = JSON.parse(readFileSync(OUT, 'utf8'))
      console.log(`Resuming: ${existing.length} cards already fetched`)
    } catch {
      existing = []
    }
  }
  const already = new Set(existing.map((c) => c.id))

  console.log('Fetching pack list...')
  const packs = await fetchPackList()
  console.log(`Found ${packs.length} packs`)

  // Collect every card ID across all packs
  const idToPack = new Map()
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i]
    process.stdout.write(`[${i + 1}/${packs.length}] ${p.label} (${p.code})... `)
    try {
      const ids = await fetchCardIdsForPack(p.code)
      for (const id of ids) if (!idToPack.has(id)) idToPack.set(id, p.label)
      console.log(`${ids.length} ids`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
    await sleep(250)
  }

  const allIds = Array.from(idToPack.keys()).sort()
  console.log(`\nTotal unique card IDs: ${allIds.length}`)
  console.log(`Already cached: ${already.size}`)
  console.log(`To fetch: ${allIds.length - already.size}\n`)

  const records = [...existing]
  let failed = 0
  for (let i = 0; i < allIds.length; i++) {
    const id = allIds[i]
    if (already.has(id)) continue
    process.stdout.write(`[${i + 1}/${allIds.length}] ${id} ... `)
    try {
      const detail = await fetchCardDetail(id)
      detail.sourcePackLabel = idToPack.get(id)
      records.push(detail)
      console.log(`${detail.name || '(no name)'} [${detail.rarity}]`)
      // Save every 25 cards so a crash doesn't lose progress
      if (records.length % 25 === 0) {
        writeFileSync(OUT, JSON.stringify(records, null, 2))
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed++
    }
    await sleep(250)
  }

  writeFileSync(OUT, JSON.stringify(records, null, 2))
  console.log(`\nDone. ${records.length} cards written to ${OUT} (${failed} failed)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
