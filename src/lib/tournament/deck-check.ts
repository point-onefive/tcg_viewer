// ─────────────────────────────────────────────────────────────────────────
// Definitive deck-list validation for One Piece.
//
// SERVER-ONLY: this imports the full One Piece card bundle (~2.6k cards) to
// resolve every submitted card code against a real card. Never import this from
// a client component - keep it behind service.ts / API routes so the bundle
// never ships to the browser. (Client-facing helpers live in deck-list.ts.)
//
// It is format-agnostic on purpose: players paste from OPTCG Sim ("4xOP01-001",
// one per line) OR from onepiecetopdecks.com (a JSON array of ids, one entry per
// copy). We scan every card-id token, sum copies, then check the three things
// that make a One Piece deck legal: exactly one Leader, exactly 50 deck cards,
// and every code resolving to a known card.
//
// NB: we deliberately do NOT enforce the "max 4 copies" rule. Some cards legally
// allow any number (e.g. cards that read "you may include any number in your
// deck"), and the bundle doesn't carry per-card copy limits - so a copy-count
// check would false-fail those decks. The 50-card total already catches decks
// that are oversized from genuine over-copying.
//
// CAREFUL: an unknown code is treated as a failure. That is intentional - it is
// how we catch typos / wrong deck codes - but it also means a brand-new print
// not yet ingested into the bundle would read as "unknown". This check is
// therefore ADVISORY (a pass/fail signal for the operator), never a hard gate,
// so a legitimate new card can never silently block a player.
// ─────────────────────────────────────────────────────────────────────────

import cards from '../cards-one-piece.json'

interface RawCard {
  id?: string
  code?: string
  cardType?: string
}

// Build the id sets once at module load. Both `id` and `code` are indexed (they
// are the same today, but indexing both is future-proof), uppercased so lookups
// are case-insensitive.
const VALID_IDS = new Set<string>()
const LEADER_IDS = new Set<string>()
for (const c of cards as RawCard[]) {
  for (const raw of [c.id, c.code]) {
    if (!raw) continue
    const id = raw.toUpperCase()
    VALID_IDS.add(id)
    if (c.cardType === 'LEADER') LEADER_IDS.add(id)
  }
}

// Optional "<n>x" copy prefix, then a card id. Global so we can sweep the whole
// paste regardless of line/JSON structure.
const CARD_TOKEN = /(?:(\d+)\s*[xX]\s*)?([A-Z]{1,4}\d{2}-\d{3}|P-\d{3})/gi
const DECK_SIZE = 50

export interface DeckCheck {
  /** True only when the deck is unambiguously legal + fully resolvable. */
  ok: boolean
  leaderCount: number
  deckCount: number
  /** Codes that look like card ids but resolve to no known card. */
  unknownIds: string[]
  /** Human-readable problems, empty when ok. */
  issues: string[]
}

/**
 * Validate a deck list. Pure + synchronous. See file header for the rules and
 * the "advisory, never a hard gate" caveat.
 */
export function checkDeckList(deckList: string | null | undefined): DeckCheck {
  const counts = new Map<string, number>() // card id -> total copies
  if (deckList) {
    for (const m of deckList.toUpperCase().matchAll(CARD_TOKEN)) {
      const n = m[1] ? parseInt(m[1], 10) : 1
      const id = m[2]
      counts.set(id, (counts.get(id) ?? 0) + (Number.isFinite(n) && n > 0 ? n : 1))
    }
  }

  let leaderCount = 0
  let deckCount = 0
  const unknownIds: string[] = []

  for (const [id, count] of counts) {
    if (!VALID_IDS.has(id)) {
      unknownIds.push(id)
      continue
    }
    if (LEADER_IDS.has(id)) leaderCount += count
    else deckCount += count
  }

  const issues: string[] = []
  if (counts.size === 0) issues.push('No recognizable card codes found.')
  if (unknownIds.length > 0) {
    issues.push(`Unknown card code${unknownIds.length === 1 ? '' : 's'}: ${unknownIds.join(', ')}`)
  }
  if (leaderCount === 0) issues.push('No Leader card found.')
  else if (leaderCount > 1) issues.push(`Multiple Leader cards (${leaderCount}).`)
  if (deckCount !== DECK_SIZE) issues.push(`Deck has ${deckCount} card${deckCount === 1 ? '' : 's'} (expected ${DECK_SIZE}).`)

  const ok =
    counts.size > 0 &&
    unknownIds.length === 0 &&
    leaderCount === 1 &&
    deckCount === DECK_SIZE

  return { ok, leaderCount, deckCount, unknownIds, issues }
}
