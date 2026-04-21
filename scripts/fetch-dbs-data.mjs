/**
 * Scrapes Dragon Ball Super - Fusion World cards from the official Bandai site.
 * Source: https://www.dbs-cardgame.com/fw/en/cardlist/
 *
 * Strategy:
 *   1. GET cardlist root, extract category numeric IDs + pack labels from the filter <ul>.
 *   2. For each pack: GET ?search=true&category[0]={numeric} -> all card tiles in one HTML.
 *   3. Each tile has data-src="detail.php?card_no=ID[&p=_pN]". Capture base + parallel suffix.
 *   4. For each unique (id, parallel) fetch detail.php?card_no=ID[&p=_pN] and parse fields.
 *
 * Output: data/dbs-cards-raw.json  (consumed by generate-dbs-data.mjs)
 *
 * Usage: node scripts/fetch-dbs-data.mjs
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const OUT = join(DATA_DIR, 'dbs-cards-raw.json')

const BASE = 'https://www.dbs-cardgame.com'
const LIST = `${BASE}/fw/en/cardlist/`
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url, init = {}) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, ...init.headers }, ...init })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`)
  return res.text()
}

async function fetchPackList() {
  const html = await fetchText(LIST)
  // <li><a ... data-val="NNNNNN" ...>NAME [CODE] </a></li>
  const re = /data-val="(\d{6})"[^>]*>([^<]+?)<\/a>/g
  const packs = []
  const seen = new Set()
  let m
  while ((m = re.exec(html))) {
    const numericId = m[1]
    const raw = m[2].replace(/&nbsp;/g, ' ').trim()
    if (seen.has(numericId)) continue
    seen.add(numericId)
    const codeMatch = raw.match(/\[([A-Z0-9]+)\]\s*$/)
    const code = codeMatch ? codeMatch[1] : null
    const label = raw.replace(/\s*\[[A-Z0-9]+\]\s*$/, '').trim()
    packs.push({ numericId, code, label, rawLabel: raw })
  }
  return packs
}

async function fetchCardIdsForPack(numericId) {
  const url = `${LIST}?search=true&category%5B0%5D=${numericId}`
  const html = await fetchText(url)
  // tiles reference detail.php?card_no=ID[&p=_pN]
  const re = /data-src="detail\.php\?card_no=([^"&]+)(?:&p=(_p\d+))?"/g
  const seen = new Set()
  const results = []
  let m
  while ((m = re.exec(html))) {
    const key = m[2] ? `${m[1]}|${m[2]}` : m[1]
    if (seen.has(key)) continue
    seen.add(key)
    results.push({ cardNo: m[1], parallel: m[2] || null })
  }
  return results
}

function cleanText(s) {
  return String(s || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

function extractDataCell(html, label) {
  const re = new RegExp(
    `<h6>\\s*${label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&')}\\s*</h6>[\\s\\S]*?<div[^>]*class="data[^"]*"[^>]*>([\\s\\S]*?)</div>`,
    'i'
  )
  const m = html.match(re)
  return m ? cleanText(m[1]) : ''
}

function extractAll(html, re) {
  const out = []
  let m
  while ((m = re.exec(html))) out.push(m[1])
  return out
}

async function fetchCardDetail(cardNo, parallel) {
  const url = `${LIST}detail.php?card_no=${cardNo}${parallel ? `&p=${parallel}` : ''}`
  const html = await fetchText(url)

  const cardNum = (html.match(/<div class="cardNo">([^<]+)<\/div>/) || [])[1]?.trim() || cardNo
  const rarity = (html.match(/<div class="rarity">([^<]+)<\/div>/) || [])[1]?.trim() || ''

  // Name - leader may have two cardName blocks (is-front / is-back). Prefer is-front, else first.
  const nameFront =
    (html.match(/<h1[^>]*class="cardName is-front"[^>]*>([^<]+)<\/h1>/) || [])[1]?.trim() ||
    (html.match(/<h1[^>]*class="cardName"[^>]*>([^<]+)<\/h1>/) || [])[1]?.trim() ||
    ''
  const nameBack =
    (html.match(/<h1[^>]*class="cardName is-back"[^>]*>([^<]+)<\/h1>/) || [])[1]?.trim() || ''

  const cardType = extractDataCell(html, 'Card type')
  const color = (html.match(/<div[^>]*class="colValue"[^>]*data-color="([^"]+)"/) || [])[1]?.trim() || ''
  const cost = extractDataCell(html, 'Cost')
  // Power (leader has front/back)
  const powerFront =
    (html.match(/<h6>\s*Power\s*<\/h6>[\s\S]*?<div[^>]*class="data(?:\s+is-front)?"[^>]*>([^<]+)<\/div>/i) || [])[1]?.trim() || ''
  const powerBack =
    (html.match(/<h6>\s*Power\s*<\/h6>[\s\S]*?is-back[^>]*>([^<]+)<\/div>/i) || [])[1]?.trim() || ''

  const comboPower = extractDataCell(html, 'Combo power')

  // Specified cost: block with costIconCol, extract distinct color tokens
  const scMatch = html.match(/<h6>\s*Specified cost\s*<\/h6>[\s\S]*?<div[^>]*class="data costIconCol"[^>]*>([\s\S]*?)<\/div>/i)
  const specifiedCost = scMatch
    ? extractAll(scMatch[1], /costIcon costIcon-(\w+)/g).join('/') || cleanText(scMatch[1])
    : ''

  // Skills (effect) - leader may have is-front/is-back variants.
  const effectBlocks = []
  const skillsMatch = html.match(/<h6>\s*Skills\s*<\/h6>([\s\S]*?)(?=<div class="cardDataCell">|<\/div>\s*<\/div>\s*<\/div>)/i)
  if (skillsMatch) {
    const inner = skillsMatch[1]
    const dataRe = /<div[^>]*class="data dataSmall(?:\s+is-front|\s+is-back)?[^"]*dataEffect[^"]*"[^>]*>([\s\S]*?)<\/div>/g
    let em
    while ((em = dataRe.exec(inner))) effectBlocks.push(cleanText(em[1]))
    if (!effectBlocks.length) {
      const fallback = inner.match(/<div[^>]*class="data[^"]*dataEffect[^"]*"[^>]*>([\s\S]*?)<\/div>/)
      if (fallback) effectBlocks.push(cleanText(fallback[1]))
    }
  }

  // Special Traits (leader may have front/back)
  const traitsFront =
    (html.match(/<h6>\s*Special Traits\s*<\/h6>[\s\S]*?<div[^>]*class="data(?:\s+is-front)?"[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || ''
  const traitsBack =
    (html.match(/<h6>\s*Special Traits\s*<\/h6>[\s\S]*?is-back[^>]*>([\s\S]*?)<\/div>/i) || [])[1] || ''

  // Set name / pack label
  const setLabel =
    (html.match(/<h6>\s*Where to get it\s*<\/h6>\s*<div[^>]*class="data dataSmall"[^>]*>([^<]+)<\/div>/i) || [])[1]?.trim() || ''
  const setCodeMatch = setLabel.match(/\[([A-Z0-9]+)\]\s*$/)
  const setCode = setCodeMatch ? setCodeMatch[1] : null

  // Image filenames (the page lists exactly what exists for this id+parallel)
  const imgMatches = []
  const imgRe = /<img[^>]+src="\.\.\/\.\.\/images\/cards\/card\/en\/([^"?]+\.webp)(?:\?[^"]*)?"/g
  let im
  while ((im = imgRe.exec(html))) imgMatches.push(im[1])
  const uniqueImages = Array.from(new Set(imgMatches))

  return {
    id: parallel ? `${cardNo}_${parallel.replace(/^_/, '')}` : cardNo,
    cardNo: cardNum,
    parallel: parallel || null,
    name: nameFront,
    nameBack: nameBack || null,
    rarity,
    cardType,
    color,
    cost,
    specifiedCost,
    powerFront,
    powerBack: powerBack || null,
    comboPower,
    traitsFront: cleanText(traitsFront),
    traitsBack: cleanText(traitsBack) || null,
    effect: effectBlocks.length ? effectBlocks.join('\n---\n') : '',
    setLabel,
    setCode,
    images: uniqueImages, // e.g. ["FB01-001_f.webp","FB01-001_b.webp"]
  }
}

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

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

  const targets = [] // { cardNo, parallel, packLabel, packCode }
  const seen = new Set()
  for (let i = 0; i < packs.length; i++) {
    const p = packs[i]
    process.stdout.write(`[${i + 1}/${packs.length}] ${p.rawLabel} ... `)
    try {
      const ids = await fetchCardIdsForPack(p.numericId)
      for (const { cardNo, parallel } of ids) {
        const key = parallel ? `${cardNo}|${parallel}` : cardNo
        if (seen.has(key)) continue
        seen.add(key)
        targets.push({ cardNo, parallel, packLabel: p.rawLabel, packCode: p.code })
      }
      console.log(`${ids.length} tiles`)
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
    }
    await sleep(200)
  }

  console.log(`\nTotal unique card entries: ${targets.length}`)
  console.log(`Already cached: ${already.size}`)

  const records = [...existing]
  let failed = 0
  for (let i = 0; i < targets.length; i++) {
    const t = targets[i]
    const id = t.parallel ? `${t.cardNo}_${t.parallel.replace(/^_/, '')}` : t.cardNo
    if (already.has(id)) continue
    process.stdout.write(`[${i + 1}/${targets.length}] ${id} ... `)
    try {
      const detail = await fetchCardDetail(t.cardNo, t.parallel)
      detail.sourcePackLabel = t.packLabel
      detail.sourcePackCode = t.packCode
      records.push(detail)
      console.log(`${detail.name || '(no name)'} [${detail.rarity}]`)
      if (records.length % 25 === 0) {
        writeFileSync(OUT, JSON.stringify(records, null, 2))
      }
    } catch (err) {
      console.log(`FAILED: ${err.message}`)
      failed++
    }
    await sleep(200)
  }

  writeFileSync(OUT, JSON.stringify(records, null, 2))
  console.log(`\nDone. ${records.length} cards -> ${OUT} (${failed} failed)`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
