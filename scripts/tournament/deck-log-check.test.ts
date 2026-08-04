/* eslint-disable no-console */
// ─────────────────────────────────────────────────────────────────────────
// Unit tests for the deck-integrity checker (src/lib/tournament/deck-log-check).
//
// Zero-dependency assertion runner (no heavy test framework - the repo has
// none). Uses small hand-built synthetic logs in the real OPTCG Sim battle-log
// shape. The overriding goal is the false-positive guarantee: every incomplete
// or ambiguous input must resolve to `inconclusive`, never `mismatch`.
//
// Run: npx tsx scripts/tournament/deck-log-check.test.ts
// ─────────────────────────────────────────────────────────────────────────

import {
  parseRegisteredDeck,
  reconstructDeckFromLog,
  verifyDeckAgainstLog,
  verifyFromText,
  normalizeCardId,
  type PlayerKey,
} from '../../src/lib/tournament/deck-log-check'

// ── Tiny assertion harness ───────────────────────────────────────────────────
let passed = 0
let failed = 0
function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    passed += 1
    console.log(`  ok  - ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL - ${name}${detail ? `  (${detail})` : ''}`)
  }
}
function eq<T>(name: string, actual: T, expected: T): void {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

// ── Fixture builders ──────────────────────────────────────────────────────────
const ENEL = 'OP15-058' // real, known leader (present in the leaders index)
const LUFFY = 'ST21-001' // a different real, known leader

type Entry = { cardId: string | null; uniqueDeckId: number; isFaceUp: boolean }

/** The canonical 50-card deck multiset used across the match fixtures. */
function canonicalCounts(): Record<string, number> {
  const counts: Record<string, number> = {}
  for (let i = 1; i <= 12; i++) counts[`OP01-0${String(i).padStart(2, '0')}`] = 4 // 48
  counts['OP01-013'] = 2 // -> 50 total
  return counts
}

/** Render a counts map (+ leader) as OPTCG Sim registered-list text. */
function registeredText(leader: string, counts: Record<string, number>): string {
  const lines = [`1x${leader}`]
  for (const [id, n] of Object.entries(counts)) lines.push(`${n}x${id}`)
  return lines.join('\n')
}

/** Expand a counts map into flat physical-card entries with unique ids. */
function entriesFromCounts(counts: Record<string, number>, startUnique: number): Entry[] {
  const out: Entry[] = []
  let u = startUnique
  for (const [id, n] of Object.entries(counts)) {
    for (let i = 0; i < n; i++) out.push({ cardId: id, uniqueDeckId: u++, isFaceUp: false })
  }
  return out
}

/** Build one player object in the battle-log shape from a leader + deck entries. */
function buildPlayer(leader: string | null, deckEntries: Entry[]) {
  const leaderCard = leader
    ? { attachedDon: 0, card: { cardDef: null, deckUniqueID: 1, cardId: null }, cardId: leader, uniqueDeckId: 1, isFaceUp: true }
    : { attachedDon: 0, card: { cardDef: null, deckUniqueID: 1, cardId: null }, cardId: null, uniqueDeckId: 1, isFaceUp: true }
  return {
    hand: [],
    trash: [],
    // Nest a couple of cards inside board slots to exercise recursive gathering.
    board: deckEntries.slice(0, 2).map((e) => ({ attachedDon: 0, card: { cardDef: null, deckUniqueID: e.uniqueDeckId, cardId: null }, ...e })),
    life: [],
    stage: [],
    deck: deckEntries.slice(2),
    leaderCard,
    activeDon: [{ isActive: true }],
    restedDon: [],
    givenDon: [],
  }
}

/** Assemble a one-snapshot two-player log. */
function buildLog(p1: ReturnType<typeof buildPlayer>, p2: ReturnType<typeof buildPlayer>) {
  return [{ turnNumber: 1, isPlayer1TurnStarting: true, player1: p1, player2: p2 }]
}

// A stock opponent deck (different leader, arbitrary 50 cards) for the "our
// player is player1" fixtures. Its exact contents never matter.
function stockOpponent() {
  const counts: Record<string, number> = {}
  for (let i = 1; i <= 10; i++) counts[`OP99-0${String(i).padStart(2, '0')}`] = 5 // 50
  return buildPlayer(LUFFY, entriesFromCounts(counts, 200))
}

// ── Tests ─────────────────────────────────────────────────────────────────────
console.log('normalization')
eq('strips _p9_sc suffix', normalizeCardId('OP01-016_p9_sc'), 'OP01-016')
eq('strips _p1 suffix', normalizeCardId('op15-061_p1'), 'OP15-061')
eq('trims + uppercases clean id', normalizeCardId('  op15-058 '), 'OP15-058')
eq('leaves base id untouched', normalizeCardId('ST21-001'), 'ST21-001')

console.log('exact MATCH')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  eq('registered parses to 51', reg.total, 51)
  eq('registered leader resolved', reg.leader, ENEL)
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(counts, 10)), stockOpponent())
  const recon = reconstructDeckFromLog(log, 'player1')
  eq('reconstruct total 51', recon.total, 51)
  eq('reconstruct unknown 0', recon.unknownCount, 0)
  eq('reconstruct leader', recon.leader, ENEL)
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict match', r.status, 'match')
  eq('target is player1 (by leader)', r.target, 'player1')
}

console.log('MISMATCH - extra + missing card (one swap)')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  // Play deck swaps one copy of OP01-001 for an unregistered OP01-050.
  const played = { ...counts, 'OP01-001': counts['OP01-001'] - 1, 'OP01-050': 1 }
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(played, 10)), stockOpponent())
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict mismatch', r.status, 'mismatch')
  check('extra lists OP01-050', !!r.diff?.extra.some((e) => e.id === 'OP01-050' && e.count === 1))
  check('missing lists OP01-001', !!r.diff?.missing.some((e) => e.id === 'OP01-001' && e.count === 1))
  eq('leader not flagged', r.diff?.leaderMismatch, false)
}

console.log('MISMATCH - leader differs (forced opponent seat)')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  // player2 is a complete but totally different deck on a different leader.
  const oppCounts: Record<string, number> = {}
  for (let i = 1; i <= 10; i++) oppCounts[`OP99-0${String(i).padStart(2, '0')}`] = 5
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(counts, 10)), buildPlayer(LUFFY, entriesFromCounts(oppCounts, 200)))
  const r = verifyDeckAgainstLog(log, reg, { forcePlayer: 'player2' })
  eq('verdict mismatch', r.status, 'mismatch')
  eq('leader flagged', r.diff?.leaderMismatch, true)
  eq('target player2', r.target, 'player2')
}

console.log('MISMATCH - neither seat plays the registered leader')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  // Neither log seat is on ENEL; both leaders resolve, so this is decisive.
  const a: Record<string, number> = {}
  for (let i = 1; i <= 10; i++) a[`OP98-0${String(i).padStart(2, '0')}`] = 5
  const log = buildLog(buildPlayer(LUFFY, entriesFromCounts(canonicalCounts(), 10)), buildPlayer(LUFFY, entriesFromCounts(a, 200)))
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict mismatch', r.status, 'mismatch')
  eq('leader flagged', r.diff?.leaderMismatch, true)
}

console.log('INCONCLUSIVE - a hidden (null) card is present')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  const entries = entriesFromCounts(counts, 10)
  entries[0] = { ...entries[0], cardId: null } // one card still hidden
  const log = buildLog(buildPlayer(ENEL, entries), stockOpponent())
  const recon = reconstructDeckFromLog(log, 'player1')
  eq('unknownCount is 1', recon.unknownCount, 1)
  eq('total still 51', recon.total, 51)
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict inconclusive', r.status, 'inconclusive')
}

console.log('INCONCLUSIVE - reconstructed total is not 51')
{
  const counts = canonicalCounts()
  delete counts['OP01-013'] // drop 2 cards -> only 48 deck cards + leader = 49
  const reg = parseRegisteredDeck(registeredText(ENEL, canonicalCounts())) // registered stays complete (51)
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(counts, 10)), stockOpponent())
  const recon = reconstructDeckFromLog(log, 'player1')
  eq('total is 49', recon.total, 49)
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict inconclusive', r.status, 'inconclusive')
}

console.log('INCONCLUSIVE - unresolved leader in the log')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  // player1 has no resolvable leader (null), player2 is a different leader.
  const log = buildLog(buildPlayer(null, entriesFromCounts(counts, 10)), stockOpponent())
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict inconclusive', r.status, 'inconclusive')
}

console.log('INCONCLUSIVE - malformed log JSON')
{
  const counts = canonicalCounts()
  const r = verifyFromText('{ this is not json', registeredText(ENEL, counts))
  eq('verdict inconclusive', r.status, 'inconclusive')
  const r2 = verifyDeckAgainstLog({ not: 'an array' }, parseRegisteredDeck(registeredText(ENEL, counts)))
  eq('non-array log inconclusive', r2.status, 'inconclusive')
}

console.log('INCONCLUSIVE - registered list is not a full 51')
{
  const counts = canonicalCounts()
  delete counts['OP01-013'] // registered now only 48 + leader = 49
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(canonicalCounts(), 10)), stockOpponent())
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict inconclusive', r.status, 'inconclusive')
}

console.log('MIRROR - both seats on the same leader; one matches')
{
  const counts = canonicalCounts()
  const reg = parseRegisteredDeck(registeredText(ENEL, counts))
  // player1 exactly matches; player2 is same leader but a different 50.
  const other: Record<string, number> = {}
  for (let i = 1; i <= 10; i++) other[`OP50-0${String(i).padStart(2, '0')}`] = 5
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(counts, 10)), buildPlayer(ENEL, entriesFromCounts(other, 200)))
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict match', r.status, 'match')
  eq('target is the matching seat', r.target, 'player1')
}

console.log('NORMALIZATION - suffixed registered ids still MATCH the clean log ids')
{
  const counts = canonicalCounts()
  // Registered list uses a print-suffixed leader AND a print-suffixed card.
  const lines = [`1x${ENEL}_p1`]
  for (const [id, n] of Object.entries(counts)) {
    lines.push(id === 'OP01-001' ? `${n}x${id}_p9_sc` : `${n}x${id}`)
  }
  const reg = parseRegisteredDeck(lines.join('\n'))
  eq('suffixed registered still parses to 51', reg.total, 51)
  eq('suffixed leader normalizes', reg.leader, ENEL)
  const log = buildLog(buildPlayer(ENEL, entriesFromCounts(counts, 10)), stockOpponent())
  const r = verifyDeckAgainstLog(log, reg)
  eq('verdict match', r.status, 'match')
}

// ── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
