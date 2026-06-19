// ─────────────────────────────────────────────────────────────────────────
// Deck list capture + light validation.
//
// Players submit the deck they commit to for the whole tournament. We accept
// the OPTCG Sim export format (lines of "<count>x<cardId>", e.g. "4xST01-003")
// but deliberately keep validation LIGHT: non-empty, sane size caps, stored
// verbatim. We never hard-reject on unknown card ids or exact counts so a
// newly released card (or a legitimately unusual list) is never blocked. The
// admin can eyeball the actual list during the event.
// ─────────────────────────────────────────────────────────────────────────

/** Generous caps so a normal 1-leader + 50-card list always fits, but a paste
 * bomb cannot bloat the polled snapshot. A list is ~17-60 lines. */
export const MAX_DECK_CHARS = 4000
export const MAX_DECK_LINES = 100

/**
 * Tidy a pasted deck list: normalize line endings, trim each line, and drop
 * blank lines. Returns the cleaned multi-line string (verbatim card ids).
 */
export function normalizeDeckList(raw: string): string {
  return String(raw ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n')
}

/**
 * Validate a deck list for storage. Light by design (see header). Returns the
 * normalized text on success, or a human-readable error message.
 */
export function validateDeckList(
  raw: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const value = normalizeDeckList(raw)
  if (!value) {
    return { ok: false, error: 'Paste your deck list to sign up.' }
  }
  if (value.length > MAX_DECK_CHARS) {
    return { ok: false, error: 'That deck list is too long - paste just the card list.' }
  }
  if (value.split('\n').length > MAX_DECK_LINES) {
    return { ok: false, error: 'That deck list has too many lines - paste just the card list.' }
  }
  return { ok: true, value }
}

/**
 * Best-effort card count for display only (sum of the leading "<n>x" on each
 * line). Never used for validation. Returns 0 when nothing parses.
 */
export function deckCardCount(deckList: string | null | undefined): number {
  if (!deckList) return 0
  let total = 0
  for (const line of deckList.split('\n')) {
    const m = line.trim().match(/^(\d+)\s*x/i)
    if (m) total += Number(m[1])
  }
  return total
}
