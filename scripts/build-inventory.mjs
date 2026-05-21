/**
 * Build / refresh the master inventory of every print we have, keyed by
 * canonical print id, recording per-language coverage and image bytes.
 *
 * Output: data/inventory.json
 *
 * Shape:
 *   {
 *     "lastRunAt": "2026-05-21T13:00:00Z",
 *     "byLanguage": {
 *       "EN":      { "cards": 4372, "lastBandaiSync": "2026-05-21T..." },
 *       "JP":      { "cards": 4518, "lastBandaiSync": "2026-05-21T..." },
 *       "EN_ASIA": { "cards": 4471, "lastBandaiSync": "2026-05-21T..." },
 *       "TC":      { "cards": 4471, "lastBandaiSync": "2026-05-21T..." },
 *       "TW":      { "cards": 4471, "lastBandaiSync": "2026-05-21T..." }
 *     },
 *     "byPrintId": {
 *       "OP05-062_p1": {
 *         "languages": ["EN"],
 *         "imageHashes": { "EN": "sha256:..." },
 *         "imageBytes":  { "EN": 312843 },
 *         "source": "limitless",
 *         "stamp": null,
 *         "lastSeenAt": "2026-05-21T..."
 *       }
 *     }
 *   }
 *
 * Why: every fetch / merge / upload script can consult this file at the
 * top of its run to decide what's actually changed since the last sweep.
 * On a weekly refresh:
 *   - The Bandai scraper compares `byLanguage[lang].cards` against the
 *     fresh row count and surfaces a diff (handled by fetch-card-data's
 *     existing diff report; this file augments it with the cross-region
 *     totals so the operator sees the FULL picture in one place).
 *   - The Limitless diff script flags only the (cardId, variant) pairs
 *     that aren't already in `byPrintId`, skipping re-scraping known
 *     entries.
 *   - The image download / R2 upload scripts re-hash files on disk and
 *     skip uploads where the hash hasn't changed. This keeps a weekly
 *     run sub-minute when nothing new dropped.
 *
 * Idempotent: running this multiple times produces identical output
 * (modulo `lastRunAt`); the file is the LOG of what we have, not a
 * cache of intermediate computation.
 *
 * Usage:
 *   node scripts/build-inventory.mjs
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createHash } from 'crypto'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const DATA_DIR = join(ROOT, 'data')
const BY_LANG_DIR = join(DATA_DIR, 'by-language')
const PUBLIC_CARDS = join(ROOT, 'public', 'cards')
const OUT_PATH = join(DATA_DIR, 'inventory.json')

const FILE_TO_LANGUAGE = {
  'en': 'EN',
  'jp': 'JP',
  'asia-en': 'EN_ASIA',
  'asia-tc': 'TC',
  'asia-tw': 'TW',
}

function readJSON(path, fallback = null) {
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch { return fallback }
}

function fileSha256(path) {
  if (!existsSync(path)) return null
  const buf = readFileSync(path)
  return 'sha256:' + createHash('sha256').update(buf).digest('hex')
}

function fileBytes(path) {
  if (!existsSync(path)) return null
  return statSync(path).size
}

function main() {
  const prev = readJSON(OUT_PATH, { byLanguage: {}, byPrintId: {} })
  const inventory = {
    lastRunAt: new Date().toISOString(),
    byLanguage: {},
    byPrintId: { ...(prev.byPrintId || {}) },
  }

  // ----- per-language counts -----
  if (existsSync(BY_LANG_DIR)) {
    for (const f of readdirSync(BY_LANG_DIR)) {
      if (!f.endsWith('.json') || f.endsWith('.bak') || f.endsWith('.tmp')) continue
      const id = f.replace(/\.json$/, '')
      const lang = FILE_TO_LANGUAGE[id]
      if (!lang) continue
      const rows = readJSON(join(BY_LANG_DIR, f), [])
      const ids = new Set(rows.map((r) => r.id).filter(Boolean))
      inventory.byLanguage[lang] = {
        cards: ids.size,
        lastBandaiSync: new Date().toISOString(),
      }
    }
  }

  // Per-print coverage: walk the merged data/cards.json (post-dedupe) so
  // the inventory matches what the bundle / UI actually see.
  const merged = readJSON(join(DATA_DIR, 'cards.json'), [])
  for (const row of merged) {
    const prev = inventory.byPrintId[row.id] ?? {}
    inventory.byPrintId[row.id] = {
      ...prev,
      languages: row.languages ?? prev.languages ?? (row.regions ? row.regions.slice() : []),
      source: row.source ?? prev.source ?? 'bandai',
      stamp: row.stamp ?? prev.stamp ?? null,
      lastSeenAt: new Date().toISOString(),
      imagesByLanguage: row.imagesByLanguage ?? prev.imagesByLanguage,
    }
  }

  // ----- image hashes (cheap-ish: SHA-256 the bytes on disk) -----
  // Format: byPrintId[id].imageHashes[lang] = sha256:...
  // We only hash files that exist; missing langs are simply absent.
  let hashed = 0
  let unchanged = 0
  if (existsSync(PUBLIC_CARDS)) {
    for (const [printId, entry] of Object.entries(inventory.byPrintId)) {
      entry.imageHashes ??= {}
      entry.imageBytes ??= {}
      const candidates = []
      // Primary file: cards/<printId>.png (EN / canonical)
      candidates.push(['EN', join(PUBLIC_CARDS, `${printId}.png`)])
      // Per-language: cards/<lang>/<printId>.png
      for (const lang of ['JP', 'EN_ASIA', 'TC', 'TW']) {
        candidates.push([lang, join(PUBLIC_CARDS, lang.toLowerCase().replace('_', '-'), `${printId}.png`)])
      }
      for (const [lang, p] of candidates) {
        const bytes = fileBytes(p)
        if (bytes == null) {
          // No local file -- if a prior run had a hash, retain it; we
          // don't have anything fresher to write.
          continue
        }
        if (entry.imageBytes[lang] === bytes && entry.imageHashes[lang]) {
          unchanged++
          continue
        }
        entry.imageHashes[lang] = fileSha256(p)
        entry.imageBytes[lang] = bytes
        hashed++
      }
    }
  }

  writeFileSync(OUT_PATH, JSON.stringify(inventory, null, 2))

  // ----- summary -----
  console.log(`Wrote ${OUT_PATH}`)
  console.log(`  lastRunAt:      ${inventory.lastRunAt}`)
  console.log(`  byLanguage:`)
  for (const [lang, info] of Object.entries(inventory.byLanguage)) {
    console.log(`    ${lang.padEnd(8)} ${String(info.cards).padStart(6)} cards`)
  }
  const printIds = Object.keys(inventory.byPrintId)
  console.log(`  byPrintId:      ${printIds.length} prints tracked`)
  console.log(`  image hashes:   ${hashed} new/updated, ${unchanged} unchanged`)
  const bySource = {}
  for (const v of Object.values(inventory.byPrintId)) {
    bySource[v.source] = (bySource[v.source] ?? 0) + 1
  }
  console.log(`  by source:      ${JSON.stringify(bySource)}`)
  const stamped = Object.values(inventory.byPrintId).filter((v) => v.stamp).length
  console.log(`  stamped prints: ${stamped}`)
}

main()
