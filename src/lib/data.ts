import { Card, CardSet } from './types'
import type { Collection } from './store'

// ---------------------------------------------------------------------------
// Per-collection generated JSON. Each collection has its own:
//   src/lib/cards-{collection}.json   (generated; gitignored)
//   src/lib/sets-{collection}.json    (generated; gitignored)
// Files are produced by the per-collection scripts under scripts/.
//
// We dynamically require each to keep builds working before a collection has
// been scraped yet. Missing files fall back to empty arrays for that slot.
// ---------------------------------------------------------------------------

type CollectionBundle = { cards: Card[]; sets: CardSet[] }

function loadBundle(collection: Collection): CollectionBundle {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cards = require(`./cards-${collection}.json`) as Card[]
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const sets = require(`./sets-${collection}.json`) as CardSet[]
    return { cards, sets }
  } catch {
    return { cards: [], sets: [] }
  }
}

// Eagerly load every collection we know about. Webpack will tree-shake unused
// require()s at build time only for statically-analyzable paths, so we list
// each one explicitly.
const BUNDLES: Record<Collection, CollectionBundle> = {
  'one-piece': loadBundle('one-piece'),
  'gundam':    loadBundle('gundam'),
  'dbs':       loadBundle('dbs'),
  'digimon':   loadBundle('digimon'),
  'pokemon':   loadBundle('pokemon'),
}

export function getCards(collection: Collection): Card[] {
  return BUNDLES[collection]?.cards ?? []
}

export function getSets(collection: Collection): CardSet[] {
  return BUNDLES[collection]?.sets ?? []
}

export function hasData(collection: Collection): boolean {
  return (BUNDLES[collection]?.cards.length ?? 0) > 0
}

export function getCardsBySet(collection: Collection, setCode: string): Card[] {
  return getCards(collection).filter((c) => c.setCode === setCode)
}
