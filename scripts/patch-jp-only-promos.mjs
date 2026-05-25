#!/usr/bin/env node
/**
 * One-shot bundle patch for the Live Action Edition vol.2 promos
 * (P-136..P-149). Bandai's en.onepiece-cardgame.com doesn't host EN
 * scans for these prints; asia-en serves the Japanese-text SAMPLE
 * file at the same URL, which made the fallback chain silently leak
 * JP scans into the EN gallery view after the asia-en tail fallback
 * was added on a1e5d08.
 *
 * The correct stance: these prints have no real EN-language scan and
 * shouldn't surface under the EN picker at all. We remove EN /
 * EN_ASIA from `languages`, `regions`, `imagesByLanguage`, and
 * `regionalIds`. They remain JP-only in the bundle (which is
 * factually true today; if Bandai later localizes them, the next
 * cards:scan run will pick that up).
 */
import { readFileSync, writeFileSync } from 'node:fs'

const TARGET_IDS = new Set([
  'P-136', 'P-137', 'P-138', 'P-139', 'P-140', 'P-141',
  'P-143', 'P-144', 'P-145', 'P-146', 'P-147', 'P-148', 'P-149',
])

const path = 'src/lib/cards-one-piece.json'
const cards = JSON.parse(readFileSync(path, 'utf8'))

let patched = 0
for (const card of cards) {
  if (!TARGET_IDS.has(card.id)) continue
  patched++

  if (Array.isArray(card.languages)) {
    card.languages = card.languages.filter((l) => l !== 'EN' && l !== 'EN_ASIA')
  }
  if (Array.isArray(card.regions)) {
    card.regions = card.regions.filter((r) => r !== 'EN')
  }
  if (card.imagesByLanguage) {
    delete card.imagesByLanguage.en
    delete card.imagesByLanguage.en_asia
  }
  if (card.regionalIds) {
    delete card.regionalIds.EN
    delete card.regionalIds.EN_ASIA
  }
  // For JP-only cards the bundle convention is to point imageSmall
  // at the JP CDN file so non-language-aware code paths still render
  // something sensible.
  const jp = card.imagesByLanguage?.jp
  if (jp) {
    card.imageSmall = jp
    card.imageLarge = jp
  }
}

writeFileSync(path, JSON.stringify(cards, null, 2) + '\n')
console.log(`Patched ${patched} of ${TARGET_IDS.size} target ids.`)
