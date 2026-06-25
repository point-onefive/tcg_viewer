/**
 * Shared types + helpers for the Deck Builder page. Lifted out of the
 * builder component so the Zustand store (`lib/store.ts`) can reference
 * them without a backwards `lib → components` dependency cycle - the
 * builder persists its decks in the store so they survive navigation
 * away to the gallery (to grab more cards) and back, and across reloads
 * for as long as the browser keeps its localStorage.
 *
 * Deliberately framework-free (no React, no store import) so the export
 * helpers can be unit-tested or reused server-side later.
 */

/**
 * Where a deck entry came from:
 *
 *  - `gallery` - added from the main Card Wall (via the lightbox "Deck"
 *    button). Carries the real Bandai card code so the export lines up
 *    with OPTCGSim / any sim that imports `<qty>x<cardId>`.
 *  - `custom`  - a user-authored proxy. The player names it, optionally
 *    assigns an index/code, and optionally pastes an image. Lets people
 *    slot in a print we're missing or an alt art they want to mock up
 *    without blocking on our catalog.
 */
export type DeckCardKind = 'gallery' | 'custom'

export interface DeckEntry {
  /**
   * Stable per-entry id (uuid). NOT the card id - keeping them separate
   * means a custom proxy and a real card can coexist, and an entry's
   * identity survives quantity / art edits.
   */
  uid: string
  /**
   * The card identity used for the copy-paste export. For gallery cards
   * this is the BASE card code (e.g. "OP01-016") regardless of which
   * alt-art print is shown, because every sim imports decks by base
   * code. For custom cards it's whatever index the user typed (may be
   * empty).
   */
  cardId: string
  /** Display name shown on the tile + in the text export comments. */
  name: string
  /** Image URL/data-URL rendered in the builder. */
  src: string
  /**
   * Chosen print id for DISPLAY only (gallery cards). Defaults to the
   * base print. The export always uses `cardId` so import compatibility
   * is never affected by an alt-art choice.
   */
  printId?: string
  /** Copies of this card in the deck. */
  qty: number
  kind: DeckCardKind
  /** Uppercase card type (LEADER / CHARACTER / EVENT / STAGE) for grouping. */
  cardType?: string
  cost?: number | null
  /** Primary color of the card, used for a subtle tile accent. */
  color?: string
}

export interface Deck {
  id: string
  /**
   * Which TCG collection this deck belongs to (mirrors the per-collection
   * board / pin model). Typed as a plain string to avoid a circular
   * import with the store's `Collection` union; call sites pass a valid
   * Collection value.
   */
  collection: string
  name: string
  entries: DeckEntry[]
  createdAt: number
  updatedAt: number
}

/** Reduce a print id to its base card code: "OP01-016_p1" → "OP01-016". */
export function baseCardId(id: string): string {
  const us = id.indexOf('_')
  return us >= 0 ? id.slice(0, us) : id
}

export function createEmptyDeck(collection: string, name: string): Deck {
  const now = Date.now()
  return {
    id: (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `deck-${now}-${Math.random().toString(36).slice(2)}`,
    collection,
    name,
    entries: [],
    createdAt: now,
    updatedAt: now,
  }
}

/** Total cards across every entry (leaders included). */
export function deckTotalCount(deck: Deck): number {
  return deck.entries.reduce((sum, e) => sum + e.qty, 0)
}

/** True when the entry's card type is a Leader (any casing). */
export function isLeaderType(cardType?: string): boolean {
  return (cardType ?? '').toUpperCase() === 'LEADER'
}

/**
 * Deck-building copy limit. Virtually every TCG caps a single card (by
 * number) at 4 copies - One Piece, Pokémon, Lorcana, etc. - so we enforce
 * 4 as the hard ceiling for normal cards (and custom proxies). A One Piece
 * Leader is a singleton, so it caps at 1.
 */
export const MAX_CARD_COPIES = 4

/** Max copies allowed for a given entry: 1 for a Leader, else MAX_CARD_COPIES. */
export function maxCopiesFor(entry: Pick<DeckEntry, 'cardType'>): number {
  return isLeaderType(entry.cardType) ? 1 : MAX_CARD_COPIES
}

/** Sum of non-leader copies - the "deck" most TCGs cap at 50. */
export function deckMainCount(deck: Deck): number {
  return deck.entries.reduce(
    (sum, e) => sum + (isLeaderType(e.cardType) ? 0 : e.qty),
    0,
  )
}

/** First leader entry in the deck, if any. */
export function deckLeader(deck: Deck): DeckEntry | undefined {
  return deck.entries.find((e) => isLeaderType(e.cardType))
}

/**
 * Ordered card-type groups for the builder layout + the stats strip.
 * The labels read as plain English; the `match` set holds the uppercase
 * raw card-type values a One Piece bundle carries. CUSTOM is a synthetic
 * bucket for user proxies (and any card whose type we don't recognise).
 */
export const DECK_GROUPS: { key: string; label: string; match: string[] }[] = [
  { key: 'LEADER',    label: 'Leader',     match: ['LEADER'] },
  { key: 'CHARACTER', label: 'Characters', match: ['CHARACTER'] },
  { key: 'EVENT',     label: 'Events',     match: ['EVENT'] },
  { key: 'STAGE',     label: 'Stages',     match: ['STAGE'] },
  { key: 'CUSTOM',    label: 'Other',      match: [] },
]

function groupKeyFor(entry: DeckEntry): string {
  if (entry.kind === 'custom') return 'CUSTOM'
  const t = (entry.cardType ?? '').toUpperCase()
  for (const g of DECK_GROUPS) {
    if (g.match.includes(t)) return g.key
  }
  return 'CUSTOM'
}

export interface DeckGroup {
  key: string
  label: string
  entries: DeckEntry[]
  count: number
}

/**
 * Bucket a deck's entries into the ordered type groups, sorted within
 * each group by cost then card id so the layout is stable and readable.
 * Empty groups are dropped.
 */
export function groupDeckEntries(deck: Deck): DeckGroup[] {
  const byKey = new Map<string, DeckEntry[]>()
  for (const e of deck.entries) {
    const k = groupKeyFor(e)
    if (!byKey.has(k)) byKey.set(k, [])
    byKey.get(k)!.push(e)
  }
  const out: DeckGroup[] = []
  for (const g of DECK_GROUPS) {
    const entries = byKey.get(g.key)
    if (!entries || entries.length === 0) continue
    entries.sort((a, b) => {
      const ca = a.cost ?? 99
      const cb = b.cost ?? 99
      if (ca !== cb) return ca - cb
      return a.cardId.localeCompare(b.cardId)
    })
    out.push({
      key: g.key,
      label: g.label,
      entries,
      count: entries.reduce((s, e) => s + e.qty, 0),
    })
  }
  return out
}

/**
 * Render a deck to the plain-text format every One Piece simulator
 * (OPTCGSim and friends) imports: one `<qty>x<cardId>` line per unique
 * card, leader first. Entries with no usable card id are emitted as a
 * trailing `# proxy` comment so the export never silently drops a custom
 * card the player added.
 */
export function deckToText(deck: Deck): string {
  const leaders: string[] = []
  const main: string[] = []
  const proxies: string[] = []

  // Leaders first (sim convention), then the rest ordered by card id.
  const sorted = [...deck.entries].sort((a, b) => {
    const la = isLeaderType(a.cardType) ? 0 : 1
    const lb = isLeaderType(b.cardType) ? 0 : 1
    if (la !== lb) return la - lb
    return a.cardId.localeCompare(b.cardId)
  })

  for (const e of sorted) {
    const id = e.cardId.trim()
    if (!id) {
      proxies.push(`# ${e.qty}x ${e.name || 'Custom card'} (proxy)`)
      continue
    }
    const line = `${e.qty}x${id}`
    if (isLeaderType(e.cardType)) leaders.push(line)
    else main.push(line)
  }

  return [...leaders, ...main, ...proxies].join('\n')
}
