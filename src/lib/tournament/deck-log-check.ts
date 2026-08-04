// ─────────────────────────────────────────────────────────────────────────
// Deck-integrity checker: does a player's REGISTERED decklist match the deck
// they ACTUALLY played, as recorded in an OPTCG Sim battle-log JSON?
//
// CORRECTNESS-CRITICAL. The single most important property of this module is
// that it NEVER FALSE-POSITIVE FIRES: it must never report a `mismatch` that is
// actually caused by incomplete/hidden data or by cosmetic print differences.
// When anything is uncertain (hidden cards, partial reconstruction, an
// unresolved leader, a malformed log, or a registered list that is not a full
// 51) it returns `inconclusive`, never `mismatch`. This is a REPORT-ONLY tool:
// it never penalizes anyone and never feeds settlement or disputes.
//
// It is a pure, dependency-light module (no server-only imports, no full card
// bundle) so it can run either client-side or in a small API route, and stays
// trivially unit-testable with hand-built fixtures. The only data it leans on
// is the small bundled leaders index (via ./leader) to identify the Leader in
// the registered list, exactly the way the rest of the app resolves a player's
// public leader.
//
// ── Battle-log shape (reverse-engineered, treated as ground truth) ──────────
// Top level: a JSON ARRAY of turn snapshots. Each snapshot has `player1`,
// `player2`, `turnNumber`, `isPlayer1TurnStarting`. Each player object has the
// zones: activeDon, board, deck, givenDon, hand, leaderCard, life, restedDon,
// stage, trash. A normal card entry is `{ cardId, uniqueDeckId, isFaceUp }`
// where `cardId` is a string like "OP15-061" or null (hidden), and
// `uniqueDeckId` is a stable per-physical-card integer within that player's
// deck. Board/stage slots may be null or nested `{ attachedDon, card, cardId,
// uniqueDeckId, isFaceUp }` objects, so we gather cards RECURSIVELY. The nested
// inner `card` object uses a DIFFERENT key (`deckUniqueID`) and has no `cardId`,
// so the "must have both a numeric uniqueDeckId AND a cardId key" rule below
// never double-counts it. Don cards carry no `cardId` and are ignored. The
// leader sits at `player.leaderCard.cardId` (a string); its inner
// `leaderCard.card.cardId` is null, so we do NOT use that.
// ─────────────────────────────────────────────────────────────────────────

import { extractLeader } from './leader'

/** Which side of the replay to reconstruct. */
export type PlayerKey = 'player1' | 'player2'

/** The three possible verdicts. See file header for the guarantees. */
export type VerifyStatus = 'match' | 'mismatch' | 'inconclusive'

/** A deck reconstructed from every snapshot of the log for one player. */
export interface ReconstructedDeck {
  /** Normalized base id of the leader, or null when it could not be resolved. */
  leader: string | null
  /** Normalized base id -> copies, for the 50-card deck (EXCLUDES the leader). */
  counts: Record<string, number>
  /** Total deduped physical cards seen (deck + leader). A complete deck is 51. */
  total: number
  /** How many deduped physical cards are still hidden (cardId === null). */
  unknownCount: number
}

/** A registered decklist parsed into the same normalized shape. */
export interface RegisteredDeck {
  /** Normalized base id of the Leader (resolved via the leaders index), or null. */
  leader: string | null
  /** Normalized base id -> copies, EXCLUDING the one leader copy. */
  counts: Record<string, number>
  /** leader (if resolved) + sum(counts). A legal list is 51. */
  total: number
  /** True when no card ids could be parsed out of the text at all. */
  malformed: boolean
}

/** One line of a structured multiset diff (a base id and a copy delta). */
export interface DiffEntry {
  id: string
  count: number
}

/** Structured difference between the registered list and what was played. */
export interface DeckDiff {
  /** In the registered list but not played (or played in fewer copies). */
  missing: DiffEntry[]
  /** Played but not registered (or played in more copies). */
  extra: DiffEntry[]
  /** True when the played leader differs from the registered leader. */
  leaderMismatch: boolean
  registeredLeader: string | null
  playedLeader: string | null
}

export interface VerifyResult {
  status: VerifyStatus
  /** Human-readable explanation, always populated. */
  reason: string
  /** Which log player we compared against; null when we could not settle on one. */
  target: PlayerKey | null
  /** Normalized registered leader (for display). */
  registeredLeader: string | null
  /** The leader each log player resolved to (for display / mirror context). */
  logLeaders: { player1: string | null; player2: string | null }
  /** Structured diff. Present on `mismatch`, null otherwise. */
  diff: DeckDiff | null
  /** The reconstructed deck of the compared player, for display. Null when none. */
  reconstructed: ReconstructedDeck | null
  /** leader (if any) + 50 for the registered list; surfaced for the UI. */
  registeredTotal: number
}

// ── Normalization (false-positive guard) ────────────────────────────────────
//
// We compare by the game-FUNCTIONAL base id, stripping cosmetic print/art/
// language variant suffixes so a differently-printed copy of the same card can
// never look like a different card. In this repo a variant id is the base id
// followed by an underscore and one or more suffix segments, e.g.
// `OP01-016_p1`, `OP01-016_p5_aen`, `OP01-016_p9_sc`. Base ids themselves never
// contain an underscore (they look like `OP15-058`, `ST21-001`, `EB01-021`,
// `PRB01-001`, `P-001`), so stripping from the first underscore onward yields
// the functional id. We also uppercase + trim. The sim log already uses clean
// base ids, so in practice this only matters on the REGISTERED side.

/**
 * Normalize a single card id to its game-functional base id: uppercase, trim,
 * and drop any `_...` cosmetic variant suffix. Idempotent; safe on clean ids.
 */
export function normalizeCardId(raw: string | null | undefined): string {
  const s = String(raw ?? '').trim().toUpperCase()
  const underscore = s.indexOf('_')
  return underscore === -1 ? s : s.slice(0, underscore)
}

// ── Log reconstruction ───────────────────────────────────────────────────────

/** A qualifying physical-card entry: numeric uniqueDeckId + a cardId key. */
function isCardEntry(node: unknown): node is { uniqueDeckId: number; cardId: string | null } {
  if (node === null || typeof node !== 'object') return false
  const obj = node as Record<string, unknown>
  const udi = obj.uniqueDeckId
  return (
    typeof udi === 'number' &&
    Number.isFinite(udi) &&
    Object.prototype.hasOwnProperty.call(obj, 'cardId') &&
    (typeof obj.cardId === 'string' || obj.cardId === null)
  )
}

/**
 * Walk any JSON value, recording every physical-card entry into `byUnique`
 * keyed by uniqueDeckId. When the same physical card appears in multiple
 * snapshots we PREFER a non-null cardId (a card revealed on any turn is known),
 * which only ever REDUCES the hidden-card count. This can never manufacture a
 * mismatch. We keep recursing into the matched entry too (board/stage slots
 * nest a `card` object), but that inner object uses `deckUniqueID` and has no
 * `cardId`, so it is never mistaken for a second physical card.
 */
function walk(node: unknown, byUnique: Map<number, string | null>): void {
  if (Array.isArray(node)) {
    for (const child of node) walk(child, byUnique)
    return
  }
  if (node === null || typeof node !== 'object') return

  if (isCardEntry(node)) {
    const prev = byUnique.get(node.uniqueDeckId)
    if (!byUnique.has(node.uniqueDeckId) || (prev === null && node.cardId !== null)) {
      byUnique.set(node.uniqueDeckId, node.cardId)
    }
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    walk(value, byUnique)
  }
}

/** Pull the leader's uniqueDeckId (and raw cardId) from any snapshot that has one. */
function findLeaderIdentity(
  log: unknown[],
  playerKey: PlayerKey,
): { uniqueDeckId: number | null; rawCardId: string | null } {
  for (const snap of log) {
    if (snap === null || typeof snap !== 'object') continue
    const player = (snap as Record<string, unknown>)[playerKey]
    if (player === null || typeof player !== 'object') continue
    const leaderCard = (player as Record<string, unknown>).leaderCard
    if (leaderCard === null || typeof leaderCard !== 'object') continue
    const lc = leaderCard as Record<string, unknown>
    const udi = typeof lc.uniqueDeckId === 'number' && Number.isFinite(lc.uniqueDeckId) ? lc.uniqueDeckId : null
    const raw = typeof lc.cardId === 'string' ? lc.cardId : null
    if (udi !== null || raw !== null) return { uniqueDeckId: udi, rawCardId: raw }
  }
  return { uniqueDeckId: null, rawCardId: null }
}

/**
 * Reconstruct one player's full physical deck from the whole battle log. See the
 * file header for the shape and the dedupe/normalization rules. Never throws:
 * malformed input just yields an empty reconstruction.
 */
export function reconstructDeckFromLog(log: unknown, playerKey: PlayerKey): ReconstructedDeck {
  const empty: ReconstructedDeck = { leader: null, counts: {}, total: 0, unknownCount: 0 }
  if (!Array.isArray(log)) return empty

  const byUnique = new Map<number, string | null>()
  for (const snap of log) {
    if (snap === null || typeof snap !== 'object') continue
    const player = (snap as Record<string, unknown>)[playerKey]
    walk(player, byUnique)
  }
  if (byUnique.size === 0) return empty

  const leaderIdentity = findLeaderIdentity(log, playerKey)
  const leaderUnique = leaderIdentity.uniqueDeckId

  // Resolve the leader: prefer the entry sitting at the leader's uniqueDeckId,
  // then fall back to the raw leaderCard.cardId. Normalize either way.
  let leaderRaw: string | null = null
  if (leaderUnique !== null && byUnique.has(leaderUnique)) {
    leaderRaw = byUnique.get(leaderUnique) ?? null
  }
  if (leaderRaw === null) leaderRaw = leaderIdentity.rawCardId
  const leader = leaderRaw ? normalizeCardId(leaderRaw) : null

  const counts: Record<string, number> = {}
  let unknownCount = 0
  for (const [unique, cardId] of byUnique) {
    if (leaderUnique !== null && unique === leaderUnique) continue
    if (cardId === null) {
      unknownCount += 1
      continue
    }
    const id = normalizeCardId(cardId)
    counts[id] = (counts[id] ?? 0) + 1
  }

  return { leader, counts, total: byUnique.size, unknownCount }
}

// ── Registered decklist parsing ──────────────────────────────────────────────
//
// Format-agnostic on purpose, reusing the exact card-id token grammar the app
// already uses to validate lists (see deck-check.ts): an optional "<n>x" copy
// prefix then a card id. This accepts the OPTCG Sim line format ("4xOP15-061",
// one per line) and the onepiecetopdecks.com JSON-array export (a list of ids).
// A trailing "_pN"/"_sc" variant suffix on any token is simply not part of the
// id grammar, so it is dropped by the match and then normalized away too.

const CARD_TOKEN = /(?:(\d+)\s*[xX]\s*)?([A-Z]{1,4}\d{2}-\d{3}|P-\d{3})/gi

/**
 * Parse a registered decklist (any accepted paste format) into normalized
 * base-id counts, with the Leader separated out via the leaders index (the same
 * source the app uses to surface a player's public leader). Never throws.
 */
export function parseRegisteredDeck(text: string | null | undefined): RegisteredDeck {
  const counts: Record<string, number> = {}
  let anyToken = false

  for (const m of String(text ?? '').matchAll(CARD_TOKEN)) {
    anyToken = true
    const n = m[1] ? parseInt(m[1], 10) : 1
    const copies = Number.isFinite(n) && n > 0 ? n : 1
    const id = normalizeCardId(m[2])
    counts[id] = (counts[id] ?? 0) + copies
  }

  // Identify the leader exactly as the app does (first token that is a known
  // leader in the bundled index), then normalize + peel one copy out of counts.
  const resolved = extractLeader(String(text ?? ''))
  const leader = resolved ? normalizeCardId(resolved.id) : null
  if (leader && counts[leader] != null) {
    counts[leader] -= 1
    if (counts[leader] <= 0) delete counts[leader]
  }

  const deckTotal = Object.values(counts).reduce((a, b) => a + b, 0)
  const total = (leader ? 1 : 0) + deckTotal

  return { leader, counts, total, malformed: !anyToken }
}

// ── Comparison + verdict ─────────────────────────────────────────────────────

const COMPLETE_TOTAL = 51

/** Diff two normalized count maps into missing (registered-only) / extra (played-only). */
function diffCounts(registered: Record<string, number>, played: Record<string, number>): {
  missing: DiffEntry[]
  extra: DiffEntry[]
} {
  const missing: DiffEntry[] = []
  const extra: DiffEntry[] = []
  const ids = new Set<string>([...Object.keys(registered), ...Object.keys(played)])
  for (const id of [...ids].sort()) {
    const r = registered[id] ?? 0
    const p = played[id] ?? 0
    if (r > p) missing.push({ id, count: r - p })
    else if (p > r) extra.push({ id, count: p - r })
  }
  return { missing, extra }
}

interface Evaluation {
  /** True when the log has enough data to make a decisive card-level call. */
  complete: boolean
  /** Why it is not complete (the inconclusive reason), when !complete. */
  incompleteReason: string | null
  diff: DeckDiff
  /** True only when leader + all 50 cards match exactly, on complete data. */
  exact: boolean
  /** Total copies of disagreement (+1 for a leader mismatch); ranks "closeness". */
  distance: number
}

/** Evaluate one reconstructed player against the registered list. Pure. */
function evaluateTarget(
  recon: ReconstructedDeck,
  registered: RegisteredDeck,
  registeredLeader: string | null,
): Evaluation {
  const { missing, extra } = diffCounts(registered.counts, recon.counts)
  const leaderMismatch = registeredLeader !== recon.leader
  const diff: DeckDiff = {
    missing,
    extra,
    leaderMismatch,
    registeredLeader,
    playedLeader: recon.leader,
  }
  const distance =
    missing.reduce((a, e) => a + e.count, 0) +
    extra.reduce((a, e) => a + e.count, 0) +
    (leaderMismatch ? 1 : 0)

  // Completeness guards. These are the core false-positive guards: on anything
  // less than a fully reconstructed, fully revealed 51-card deck we refuse to
  // return a card-level mismatch.
  let incompleteReason: string | null = null
  if (recon.leader === null) {
    incompleteReason = 'The log did not reveal this player\u2019s leader, so the deck cannot be verified.'
  } else if (recon.unknownCount > 0) {
    incompleteReason = `The log still has ${recon.unknownCount} hidden card${recon.unknownCount === 1 ? '' : 's'} for this player, so the deck cannot be fully verified.`
  } else if (recon.total !== COMPLETE_TOTAL) {
    incompleteReason = `Only ${recon.total} of ${COMPLETE_TOTAL} cards could be reconstructed from the log for this player, so it is incomplete.`
  }

  const complete = incompleteReason === null
  const exact = complete && !leaderMismatch && missing.length === 0 && extra.length === 0

  return { complete, incompleteReason, diff, exact, distance }
}

function leaderLabel(id: string | null): string {
  return id ?? 'unknown'
}

/**
 * Verify a parsed registered decklist against a parsed battle log.
 *
 * Player selection is by LEADER: we compare against whichever log player is
 * playing the registered leader. Exactly one match -> compare that player. Both
 * match (mirror) -> it is a `match` if EITHER side reconstructs to the list
 * exactly, else the closest diff. Neither match -> a decisive `mismatch`
 * ("played a different leader") as long as both log leaders are known; if a log
 * leader could not be resolved we stay `inconclusive`.
 *
 * `opts.forcePlayer` skips leader selection and compares against a specific log
 * player (used to answer "does this list match THAT specific seat", e.g. the
 * opponent). Completeness guards still apply.
 */
export function verifyDeckAgainstLog(
  log: unknown,
  registered: RegisteredDeck,
  opts: { forcePlayer?: PlayerKey } = {},
): VerifyResult {
  const recon1 = reconstructDeckFromLog(log, 'player1')
  const recon2 = reconstructDeckFromLog(log, 'player2')
  const logLeaders = { player1: recon1.leader, player2: recon2.leader }
  const registeredLeader = registered.leader

  const base = {
    target: null as PlayerKey | null,
    registeredLeader,
    logLeaders,
    diff: null as DeckDiff | null,
    reconstructed: null as ReconstructedDeck | null,
    registeredTotal: registered.total,
  }

  // ── Up-front guards that make ANY comparison meaningless ──────────────────
  if (!Array.isArray(log) || log.length === 0) {
    return { ...base, status: 'inconclusive', reason: 'The battle log is empty or is not the expected array of turn snapshots.' }
  }
  if (registered.malformed) {
    return { ...base, status: 'inconclusive', reason: 'No card codes could be read from the registered decklist.' }
  }
  if (registered.total !== COMPLETE_TOTAL) {
    return {
      ...base,
      status: 'inconclusive',
      reason: `The registered decklist has ${registered.total} card${registered.total === 1 ? '' : 's'} (expected ${COMPLETE_TOTAL}: 1 leader + 50), so it is not a complete list to check against.`,
    }
  }
  if (registeredLeader === null) {
    return { ...base, status: 'inconclusive', reason: 'The Leader in the registered decklist could not be identified.' }
  }

  const reconOf = (key: PlayerKey) => (key === 'player1' ? recon1 : recon2)

  const decide = (target: PlayerKey): VerifyResult => {
    const recon = reconOf(target)
    const ev = evaluateTarget(recon, registered, registeredLeader)
    const withTarget = { ...base, target, reconstructed: recon }
    if (!ev.complete) {
      return { ...withTarget, status: 'inconclusive', reason: ev.incompleteReason ?? 'The log is incomplete for this player.' }
    }
    if (ev.exact) {
      return { ...withTarget, status: 'match', diff: null, reason: 'The registered decklist matches the deck played in this log exactly.' }
    }
    return { ...withTarget, status: 'mismatch', diff: ev.diff, reason: describeMismatch(ev.diff) }
  }

  // ── Forced seat: skip leader selection, compare against the given player ──
  if (opts.forcePlayer) return decide(opts.forcePlayer)

  // ── Leader-based selection ────────────────────────────────────────────────
  const candidates: PlayerKey[] = (['player1', 'player2'] as PlayerKey[]).filter(
    (k) => reconOf(k).leader !== null && reconOf(k).leader === registeredLeader,
  )

  if (candidates.length === 1) return decide(candidates[0])

  if (candidates.length === 2) {
    // Mirror match: a match if EITHER seat reconstructs to the list exactly.
    const ev1 = evaluateTarget(recon1, registered, registeredLeader)
    const ev2 = evaluateTarget(recon2, registered, registeredLeader)
    if (ev1.exact) return { ...base, target: 'player1', reconstructed: recon1, status: 'match', reason: 'The registered decklist matches one seat of this mirror match exactly.' }
    if (ev2.exact) return { ...base, target: 'player2', reconstructed: recon2, status: 'match', reason: 'The registered decklist matches one seat of this mirror match exactly.' }
    // No exact match on either seat. If either seat is incomplete we cannot
    // safely accuse, so stay inconclusive; otherwise report the closest diff.
    if (!ev1.complete && !ev2.complete) {
      return { ...base, status: 'inconclusive', reason: 'Both seats of this mirror match have incomplete log data, so the deck cannot be verified.' }
    }
    if (!ev1.complete) return { ...base, target: 'player2', reconstructed: recon2, status: 'mismatch', diff: ev2.diff, reason: describeMismatch(ev2.diff) }
    if (!ev2.complete) return { ...base, target: 'player1', reconstructed: recon1, status: 'mismatch', diff: ev1.diff, reason: describeMismatch(ev1.diff) }
    const closer = ev1.distance <= ev2.distance ? { key: 'player1' as PlayerKey, ev: ev1, recon: recon1 } : { key: 'player2' as PlayerKey, ev: ev2, recon: recon2 }
    return { ...base, target: closer.key, reconstructed: closer.recon, status: 'mismatch', diff: closer.ev.diff, reason: describeMismatch(closer.ev.diff) }
  }

  // ── Neither log player is on the registered leader ────────────────────────
  // A player's leader is public from turn one, so a leader that appears nowhere
  // in the log is a decisive signal - PROVIDED both log leaders were actually
  // resolved. If a log leader is missing/unresolved we cannot be sure, so we
  // stay inconclusive rather than risk a false accusation.
  if (recon1.leader === null || recon2.leader === null) {
    return {
      ...base,
      status: 'inconclusive',
      reason: 'The registered leader is not on either seat, but a leader could not be resolved for a player in the log, so the result is uncertain.',
    }
  }

  const ev1 = evaluateTarget(recon1, registered, registeredLeader)
  const ev2 = evaluateTarget(recon2, registered, registeredLeader)
  const closer = ev1.distance <= ev2.distance ? { key: 'player1' as PlayerKey, ev: ev1, recon: recon1 } : { key: 'player2' as PlayerKey, ev: ev2, recon: recon2 }
  const reason = `The registered leader ${leaderLabel(registeredLeader)} was not played by either seat in this log (player1 played ${leaderLabel(recon1.leader)}, player2 played ${leaderLabel(recon2.leader)}). A different leader was played.`
  return { ...base, target: closer.key, reconstructed: closer.recon, status: 'mismatch', diff: closer.ev.diff, reason }
}

/** Convenience: parse a registered decklist and verify it against a parsed log. */
export function verifyDeckListAgainstLog(
  log: unknown,
  registeredDeckList: string,
  opts: { forcePlayer?: PlayerKey } = {},
): VerifyResult {
  return verifyDeckAgainstLog(log, parseRegisteredDeck(registeredDeckList), opts)
}

/**
 * Convenience for callers holding raw strings (the tool UI): parse the log text
 * as JSON (a malformed log yields `inconclusive`, never a throw), then verify.
 */
export function verifyFromText(
  logText: string,
  registeredDeckList: string,
  opts: { forcePlayer?: PlayerKey } = {},
): VerifyResult {
  const registered = parseRegisteredDeck(registeredDeckList)
  let log: unknown
  try {
    log = JSON.parse(logText)
  } catch {
    return {
      status: 'inconclusive',
      reason: 'The battle log is not valid JSON. Paste the full OPTCG Sim battle-log export.',
      target: null,
      registeredLeader: registered.leader,
      logLeaders: { player1: null, player2: null },
      diff: null,
      reconstructed: null,
      registeredTotal: registered.total,
    }
  }
  return verifyDeckAgainstLog(log, registered, opts)
}

/** Compose a human sentence from a structured diff (used for `mismatch`). */
function describeMismatch(diff: DeckDiff): string {
  const parts: string[] = []
  if (diff.leaderMismatch) {
    parts.push(`leader differs (registered ${leaderLabel(diff.registeredLeader)}, played ${leaderLabel(diff.playedLeader)})`)
  }
  if (diff.missing.length > 0) {
    const n = diff.missing.reduce((a, e) => a + e.count, 0)
    parts.push(`${n} card${n === 1 ? '' : 's'} registered but not played`)
  }
  if (diff.extra.length > 0) {
    const n = diff.extra.reduce((a, e) => a + e.count, 0)
    parts.push(`${n} card${n === 1 ? '' : 's'} played but not registered`)
  }
  if (parts.length === 0) return 'The registered decklist does not match the deck played in this log.'
  return `The registered decklist does not match the deck played: ${parts.join('; ')}.`
}
