// ─────────────────────────────────────────────────────────────────────────
// Leader extraction from a stored deck list.
//
// A One Piece deck has exactly one Leader card. The Leader is public during
// play (it sits face-up on the table and the metagame is tracked by leader),
// so we surface it from the otherwise-private deck list. The rest of the 50
// cards stay hidden until the event concludes.
//
// Deck lists are stored verbatim in the OPTCG Sim format (lines of
// "<count>x<cardId>", e.g. "1xOP01-001"). We parse out card ids and match the
// first one that is a known Leader in the bundled index. Unknown / new leaders
// (not yet in the index) simply resolve to null, never an error.
// ─────────────────────────────────────────────────────────────────────────

import leadersIndex from './leaders-one-piece.json'

export interface LeaderInfo {
  id: string
  name: string
  image: string | null
}

type LeaderEntry = { name: string; image: string | null }
const INDEX = leadersIndex as Record<string, LeaderEntry>

// Card id token, e.g. "OP01-001", "ST01-001", "EB01-021", "PRB01-001", "P-001".
const CARD_ID = /^([A-Z]{1,4}\d{2}-\d{3}|P-\d{3})/i
// Leading OPTCG Sim quantity prefix, e.g. "4x" / "1 x " before the card id.
const QTY_PREFIX = /^\s*\d+\s*[xX]\s*/
// Token separators across every paste format we accept: whitespace / newlines
// (OPTCG Sim line format "1xOP01-001") plus quotes, commas and brackets (the
// onepiecetopdecks.com JSON-array export, e.g. `["Exported...","OP15-058",…]`).
// Splitting first, then matching each token, keeps the leader resolvable no
// matter which exporter a player pasted from.
const TOKEN_SPLIT = /[\s",[\]]+/

/**
 * Resolve the Leader card from a deck list, or null when none of its card ids
 * match a known leader. Display-only: never throws, never blocks anything.
 *
 * A 50-card One Piece deck has exactly one Leader, and the Leader is the only
 * card that appears in the leaders index - so we scan tokens in order and return
 * the first one that is a known leader, which is format-agnostic.
 */
export function extractLeader(deckList: string | null | undefined): LeaderInfo | null {
  if (!deckList) return null
  for (const rawToken of deckList.split(TOKEN_SPLIT)) {
    if (!rawToken) continue
    // Strip the "<count>x" quantity prefix so the greedy id match never eats
    // the separating "x" (e.g. "1xOP01-001" -> "OP01-001", not "XOP01-001").
    const token = rawToken.replace(QTY_PREFIX, '')
    const m = token.match(CARD_ID)
    if (!m) continue
    const id = m[1].toUpperCase()
    const entry = INDEX[id]
    if (entry) return { id, name: entry.name, image: entry.image }
  }
  return null
}
