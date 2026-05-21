/**
 * Inject Limitless-sourced alt-art variants into data/cards.json.
 *
 * Reads:
 *   data/cards.json                                (current catalogue)
 *   data/limitless/missing-variants-detailed.json  (123 alts to add)
 *
 * For each missing variant we create a new row in data/cards.json that
 * INHERITS every gameplay attribute from its base card (name, type,
 * color, cost, power, counter, attributes, types, effect, trigger,
 * rarity) and OVERRIDES the per-print fields:
 *
 *   - id            : "OP05-062_p1"
 *   - img_full_url  : the Limitless CDN URL (download step will rewrite
 *                      to a local PNG once the file is on disk)
 *   - img_path      : "cards/OP05-062_p1.png" (R2 key after upload)
 *   - source_pack_id: "limitless:misc-promos" (sentinel so this row
 *                      can be re-found / re-derived without re-scraping
 *                      Limitless)
 *   - source_pack_prefix / source_pack_label : derived from the Limitless
 *                      category for human-readable provenance
 *   - distribution  : e.g. "Misc. Promos / Illustration Box Vol.1
 *                      (Peach Momoko)" so the gallery's existing
 *                      distribution badge surfaces the source product
 *                      without needing new UI plumbing
 *   - regions       : ['EN'] or ['JP'] from the image filename suffix
 *   - source        : 'limitless'  (NEW field, used by future tooling
 *                      to spot supplementary entries vs. Bandai-pulled)
 *   - limitless_product / limitless_artist / limitless_subtitle :
 *                     full structured provenance for downstream UI
 *                     (e.g. a "first printed in: <product>" line in
 *                     the lightbox). Kept separate from `distribution`
 *                     so the original community classifier survives
 *                     intact even if we ever rewrite the distribution
 *                     string.
 *
 * Writes data/cards.json in place (with `.bak` retention by the
 * caller -- this script does NOT take backups; pair it with the
 * existing fetch-card-data atomic-write pattern if you need rollback).
 *
 * Idempotent: re-running skips any row already tagged source='limitless'
 * for that id, so this script can safely be re-invoked after pulling
 * fresh Limitless data.
 */

import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

const CARDS_PATH = join(ROOT, 'data/cards.json')
const MISSING_PATH = join(ROOT, 'data/limitless/missing-variants-detailed.json')

const cards = JSON.parse(readFileSync(CARDS_PATH, 'utf8'))
const detailed = JSON.parse(readFileSync(MISSING_PATH, 'utf8'))

const byId = new Map(cards.map((c) => [c.id, c]))

function regionsFromImage(url) {
  if (!url) return ['EN']
  if (url.endsWith('_JP.webp')) return ['JP']
  return ['EN']
}

// Synthesised provenance string. The gallery's existing distribution
// badge prints whatever's in `distribution` verbatim, so we want it
// terse and human-readable. Build "<Product> (<Artist>)" with
// graceful fallbacks when one or the other is missing.
function distributionLine(d) {
  const product = d.productName || d.subtitle || d.category || 'Unknown promo'
  return d.artist ? `${product} (${d.artist})` : product
}

// Classify the print into one of the PrintStamp enum buckets so the UI
// can show a small badge ("Winner / Champion / Pre-release / etc.") on
// stamped tournament prizes. Same heuristic as dedupe-cross-language so
// both ingestion paths produce identical stamp tags.
function classifyStamp(d) {
  const cat = (d.firstSeenIn || '').toLowerCase()
  const sub = (d.subtitle || '').toLowerCase()
  const prod = (d.productName || '').toLowerCase()
  const blob = `${cat} ${sub} ${prod}`
  if (/winner/.test(blob)) return 'winner'
  if (/champion(ship)?/.test(blob)) return 'champion'
  if (/pre-release|prerelease|pre release/.test(blob)) return 'pre-release'
  if (/prize-cards|prize cards|top \d+|top player/.test(blob)) return 'event'
  if (/tournament|regional|event-pack|treasure[- ]cup/.test(blob)) return 'event'
  if (/dash[- ]pack|illustration[- ]box|family[- ]deck|storage[- ]box/.test(blob)) return 'pack'
  return null
}

let added = 0
let skipped = 0
let bareBase = 0

for (const [ourId, d] of Object.entries(detailed)) {
  if (!d.imageUrl) { skipped++; continue }
  if (byId.has(ourId)) {
    // Either already injected by a prior run, or accidentally overlaps
    // with a base Bandai pulled later. Skip without modifying.
    skipped++
    continue
  }
  const base = byId.get(d.cardId)
  if (!base) {
    // The base card isn't in our local data. Shouldn't happen given
    // the diff says all 123 missing variants have known bases, but
    // guard just in case (e.g. Bandai dropped the base mid-cycle).
    bareBase++
    continue
  }

  const row = {
    id: ourId,
    name: base.name,
    rarity: base.rarity,
    category: base.category,
    colors: base.colors,
    cost: base.cost,
    power: base.power,
    counter: base.counter,
    attributes: base.attributes,
    types: base.types,
    effect: base.effect,
    trigger: base.trigger,
    distribution: distributionLine(d),
    img_full_url: d.imageUrl,
    img_path: `cards/${ourId}.png`,
    // Sentinel pack id so re-runs / future tooling can find these
    // rows without grepping the schema. Slug from Limitless category.
    source_pack_id: `limitless:${d.firstSeenIn}`,
    source_pack_prefix: 'LIMITLESS',
    source_pack_label: d.category || d.firstSeenIn,
    regions: regionsFromImage(d.imageUrl),
    source: 'limitless',
    stamp: classifyStamp(d),
    limitless_product: d.productName ?? null,
    limitless_artist: d.artist ?? null,
    limitless_subtitle: d.subtitle ?? null,
    limitless_url: `https://onepiece.limitlesstcg.com/cards/${d.cardId}?v=${d.variant}`,
  }
  cards.push(row)
  added++
}

writeFileSync(CARDS_PATH, JSON.stringify(cards, null, 2))

console.log(`Merge complete:`)
console.log(`  added:   ${added} new variants`)
console.log(`  skipped: ${skipped} (no image or already present)`)
console.log(`  orphan:  ${bareBase} (limitless variant but no base card locally)`)
console.log(`  total:   ${cards.length} entries in data/cards.json now`)
