/**
 * Diff Limitless TCG's card inventory against our local data/cards.json.
 *
 * Reads data/limitless/card-urls.json (built by --crawl in
 * fetch-limitless-supplement.mjs) and emits the deltas:
 *
 *   data/limitless/missing-bases.json   - cards Limitless has where
 *                                          the base id is unknown to us
 *   data/limitless/missing-variants.json - cards where the base is
 *                                          known but a print Limitless
 *                                          tracks (`_p1`, `_p2`, ...)
 *                                          isn't in our variant list
 *   data/limitless/known.json            - everything we already cover
 *
 * Variant mapping: confirmed by sampling, Limitless's `?v=N` query
 * parameter maps deterministically to Bandai's `_p${N}` suffix. The
 * one wrinkle is that some Bandai IDs use `_r1` / `_p1` interchangeably
 * for the same image (parallel art reissues). We accept either match.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const urls = JSON.parse(readFileSync(join(ROOT, 'data/limitless/card-urls.json'), 'utf8'))

// Local catalogue: union every per-language scrape we have plus the
// merged data/cards.json (the post-dedupe output). This way "missing"
// means missing from EVERY Bandai region, not just EN. A print that's
// on JP-only Bandai but not Limitless still counts as known and we
// won't re-ingest it from the Limitless CDN.
const localIds = new Set()
function ingest(path) {
  if (!existsSync(path)) return
  for (const c of JSON.parse(readFileSync(path, 'utf8'))) {
    if (c?.id) localIds.add(c.id)
  }
}
ingest(join(ROOT, 'data/cards.json'))
const byLangDir = join(ROOT, 'data/by-language')
if (existsSync(byLangDir)) {
  for (const f of readdirSync(byLangDir)) {
    if (f.endsWith('.json') && !f.endsWith('.bak')) ingest(join(byLangDir, f))
  }
}
const cards = [...localIds].map((id) => ({ id }))

// Treat `_p1` <-> `_r1` as equivalents: Bandai sometimes ships the
// same art under both suffixes (the EN side prints as `_p1`, the
// JP side as `_r1`, etc.). Build an alias set keyed off the
// numeric tail.
const localAliases = new Set()
for (const id of localIds) {
  localAliases.add(id)
  const m = id.match(/^(.+)_([pr])(\d+)$/)
  if (m) {
    const [, base, , n] = m
    localAliases.add(`${base}_p${n}`)
    localAliases.add(`${base}_r${n}`)
  }
}

const missingBases = []
const missingVariants = []
const known = []

// Index Limitless entries by cardId
const byCard = {}
for (const e of Object.values(urls.byCardVariant)) {
  byCard[e.cardId] ??= []
  byCard[e.cardId].push(e)
}

for (const [cardId, prints] of Object.entries(byCard)) {
  const baseKnown = localAliases.has(cardId)
  for (const p of prints) {
    const ourId = p.variant === 0 ? cardId : `${cardId}_p${p.variant}`
    const known1 = localAliases.has(ourId)
    if (known1) {
      known.push({ ourId, limitless: p })
      continue
    }
    if (!baseKnown && p.variant === 0) {
      missingBases.push({ cardId, firstSeenIn: p.firstSeenIn })
    } else {
      missingVariants.push({
        ourId,
        cardId,
        variant: p.variant,
        firstSeenIn: p.firstSeenIn,
        baseKnown,
      })
    }
  }
}

const outDir = join(ROOT, 'data/limitless')
writeFileSync(join(outDir, 'missing-bases.json'), JSON.stringify(missingBases, null, 2))
writeFileSync(join(outDir, 'missing-variants.json'), JSON.stringify(missingVariants, null, 2))
writeFileSync(join(outDir, 'known.json'), JSON.stringify(known.length, null, 2))

console.log(`Local catalogue: ${localIds.size} entries`)
console.log(`Limitless catalogue: ${Object.keys(urls.byCardVariant).length} (cardId, variant) pairs`)
console.log(`  Known to us:        ${known.length}`)
console.log(`  Missing base cards: ${missingBases.length}`)
console.log(`  Missing variants:   ${missingVariants.length}`)

// Quick breakdown of missing variants by source category
const byCat = {}
for (const m of missingVariants) {
  byCat[m.firstSeenIn] = (byCat[m.firstSeenIn] ?? 0) + 1
}
console.log('\nMissing variants by Limitless category:')
for (const [cat, n] of Object.entries(byCat).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${cat}: ${n}`)
}

// Sample first 10 missing variants
console.log('\nFirst 10 missing variants:')
for (const m of missingVariants.slice(0, 10)) {
  console.log(`  ${m.ourId}  (from ${m.firstSeenIn})`)
}

// Sample first 10 missing bases
if (missingBases.length) {
  console.log('\nFirst 10 missing base cards:')
  for (const m of missingBases.slice(0, 10)) {
    console.log(`  ${m.cardId}  (from ${m.firstSeenIn})`)
  }
}
