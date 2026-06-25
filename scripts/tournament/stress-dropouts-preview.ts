/* eslint-disable no-console */
/**
 * Stress test for the NEW tournament behaviors, run against the PREVIEW
 * tournament Supabase (never prod):
 *
 *   A. Round-1 randomization - round 1 pairs off the random seed order, not
 *      alphabetically, so repeat entrants don't keep drawing each other.
 *   B. Self-drop mid-round  - forfeits the dropped player's open match to the
 *      opponent and advances the round; dropped player excluded afterwards.
 *   C. Admin-drop mid-round - same forfeit + advance via the admin path.
 *   D. Drop during enrolling - excluded from the bracket at start.
 *   E. Full event with a mid-round drop - still completes with valid standings,
 *      and the drop induces a legal bye in the next round.
 *
 * Run:
 *   vercel env pull .env.preview.local --environment=preview --yes
 *   npx tsx --conditions=react-server scripts/tournament/stress-dropouts-preview.ts
 *   rm .env.preview.local
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(path)) return out
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[line.slice(0, i).trim()] = v
  }
  return out
}

const root = new URL('../../', import.meta.url).pathname
const preview = loadEnvFile(root + '.env.preview.local')
const prod = loadEnvFile(root + '.env.local')
const PREVIEW_URL = preview.TOURNAMENT_SUPABASE_URL
const PREVIEW_KEY = preview.TOURNAMENT_SUPABASE_SECRET_KEY
if (!PREVIEW_URL || !PREVIEW_KEY) throw new Error('Missing preview TOURNAMENT_SUPABASE_* in .env.preview.local')
if (PREVIEW_URL === prod.TOURNAMENT_SUPABASE_URL) throw new Error('ABORT: preview URL == prod URL. Refusing to run.')
process.env.TOURNAMENT_SUPABASE_URL = PREVIEW_URL
process.env.TOURNAMENT_SUPABASE_SECRET_KEY = PREVIEW_KEY
delete process.env.TOURNAMENT_ACTIVE_CODE

console.log('Preview tournament DB :', PREVIEW_URL)
const previewSb = createClient(PREVIEW_URL, PREVIEW_KEY, { auth: { persistSession: false, autoRefreshToken: false } })

let pass = 0
let fail = 0
const failures: string[] = []
function ok(cond: boolean, msg: string) {
  if (cond) {
    pass++
    console.log(`   ok   ${msg}`)
  } else {
    fail++
    failures.push(msg)
    console.log(`  FAIL  ${msg}`)
  }
}
const section = (s: string) => console.log(`\n=== ${s} ===`)

const LEADERS = ['OP01-001', 'OP01-002', 'EB01-001', 'EB01-021']
function deckFor(i: number): string {
  const leader = LEADERS[i % LEADERS.length]
  const lines = [`1x${leader}`]
  for (let n = 1; n <= 12; n++) lines.push(`4xOP01-${String(n + 4).padStart(3, '0')}`)
  lines.push('2xOP01-021')
  return lines.join('\n')
}
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`)
const skillOf = (h: string): number => Number(h.split('_').pop()) || 0

interface Svc {
  adminStartFresh: (i: { name: string; signupMinutes: number; roundMinutes: number; format?: string; maxPlayers?: number | null }) => Promise<{ code: string }>
  enroll: (code: string, h: string, deck?: string | null, wallet?: string | null) => Promise<unknown>
  getSnapshotByCode: (code: string) => Promise<any>
  adminApproveAllPending: (code: string) => Promise<number>
  adminRejectPlayer: (code: string, playerId: string) => Promise<void>
  adminStartBracket: (code: string) => Promise<void>
  adminSetResult: (code: string, matchId: string, result: 'p1' | 'p2' | 'draw') => Promise<void>
  dropSelfByWallet: (code: string, wallet: string, handle: string | null) => Promise<void>
  adminDropPlayer: (code: string, playerId: string) => Promise<void>
}

let svc: Svc

/** Create a swiss event, enroll N players, reject strays, approve all, return code + handles. */
async function setupEnrolled(label: string, n: number): Promise<{ code: string; handles: string[] }> {
  const { code } = await svc.adminStartFresh({
    name: `DROP ${label}`,
    signupMinutes: 120,
    roundMinutes: 2880,
    format: 'swiss',
    maxPlayers: n,
  })
  const handles: string[] = []
  for (let i = 1; i <= n; i++) {
    const h = `drp_${String(i).padStart(2, '0')}`
    await svc.enroll(code, h, deckFor(i))
    handles.push(h)
  }
  // Reject any auto-converted waitlist strays so the field is exactly ours.
  const snap = await svc.getSnapshotByCode(code)
  const known = new Set(handles)
  for (const p of snap.players) if (!known.has(p.xHandle)) await svc.adminRejectPlayer(code, p.id)
  return { code, handles }
}

async function seedsByHandle(tournamentId: string): Promise<Map<string, number>> {
  const { data } = await previewSb
    .from('players')
    .select('x_handle, seed, approval_status, dropped')
    .eq('tournament_id', tournamentId)
  const m = new Map<string, number>()
  for (const p of data ?? []) if (p.seed != null && p.approval_status !== 'rejected') m.set(p.x_handle, p.seed)
  return m
}

function adjacentPairs<T>(ordered: T[]): Set<string> {
  const s = new Set<string>()
  for (let i = 0; i + 1 < ordered.length; i += 2) s.add(pairKey(String(ordered[i]), String(ordered[i + 1])))
  return s
}

// ── A. Round-1 randomization ────────────────────────────────────────────────
async function scenarioRandomR1() {
  section('A. Round 1 is randomized (seed order), not alphabetical')
  const RUNS = 4
  const N = 16
  let anyNonAlphabetical = 0
  for (let run = 1; run <= RUNS; run++) {
    const { code, handles } = await setupEnrolled(`R1-rand-${run}`, N)
    await svc.adminApproveAllPending(code)
    await svc.adminStartBracket(code)
    const snap = await svc.getSnapshotByCode(code)
    const tId = snap.tournament.id
    const seeds = await seedsByHandle(tId)
    const idToHandle = new Map<string, string>(snap.players.map((p: any) => [p.id, p.xHandle]))

    // Actual round-1 pairs (by handle).
    const r1 = snap.matches.filter((m: any) => m.player2Id)
    const actual = new Set<string>(r1.map((m: any) => pairKey(idToHandle.get(m.player1Id)!, idToHandle.get(m.player2Id)!)))

    // Expected if pairing follows seed order: sort handles by seed, pair adjacent.
    const bySeed = [...handles].sort((a, b) => (seeds.get(a) ?? 1e9) - (seeds.get(b) ?? 1e9))
    const expectedSeed = adjacentPairs(bySeed)
    // What a pure-alphabetical pairing would have produced.
    const byAlpha = [...handles].sort()
    const expectedAlpha = adjacentPairs(byAlpha)

    const matchesSeed = actual.size === expectedSeed.size && [...actual].every((k) => expectedSeed.has(k))
    const matchesAlpha = actual.size === expectedAlpha.size && [...actual].every((k) => expectedAlpha.has(k))
    ok(matchesSeed, `run ${run}: round-1 pairs follow the random seed order`)
    if (!matchesAlpha) anyNonAlphabetical++
    const seedOrderStr = bySeed.join(',')
    console.log(`   run ${run}: seed order ${seedOrderStr === byAlpha.join(',') ? '== alphabetical' : '!= alphabetical'}`)
  }
  ok(anyNonAlphabetical > 0, `at least one run paired non-alphabetically (${anyNonAlphabetical}/${RUNS} runs)`)
}

// ── shared: resolve a specific match by deciding stronger handle wins ─────────
async function resolveMatch(code: string, snap: any, m: any) {
  const idToHandle = new Map<string, string>(snap.players.map((p: any) => [p.id, p.xHandle]))
  const s1 = skillOf(idToHandle.get(m.player1Id) ?? '')
  const s2 = skillOf(idToHandle.get(m.player2Id) ?? '')
  await svc.adminSetResult(code, m.id, s1 >= s2 ? 'p1' : 'p2')
}

// ── B/C. Mid-round drop forfeits the open match + advances ───────────────────
async function scenarioMidRoundDrop(viaAdmin: boolean) {
  const label = viaAdmin ? 'C. Admin-drop mid-round' : 'B. Self-drop mid-round'
  section(`${label} forfeits the open match and advances`)
  const N = 8
  const { code, handles } = await setupEnrolled(viaAdmin ? 'admindrop' : 'selfdrop', N)
  await svc.adminApproveAllPending(code)
  await svc.adminStartBracket(code)
  let snap = await svc.getSnapshotByCode(code)
  const r1 = snap.rounds.find((r: any) => r.status === 'active')
  const r1Matches = snap.matches.filter((m: any) => m.roundId === r1.id && m.player2Id).sort((a: any, b: any) => a.number - b.number)
  ok(r1Matches.length === 4, `round 1 has 4 matches for 8 players (got ${r1Matches.length})`)

  // Resolve all but the first match normally; then drop a player in match 1.
  for (const m of r1Matches.slice(1)) await resolveMatch(code, snap, m)
  snap = await svc.getSnapshotByCode(code)

  const target = snap.matches.find((m: any) => m.id === r1Matches[0].id)
  const idToHandle = new Map<string, string>(snap.players.map((p: any) => [p.id, p.xHandle]))
  const dropId = target.player1Id
  const oppId = target.player2Id
  const dropHandle = idToHandle.get(dropId)!
  const oppHandle = idToHandle.get(oppId)!
  console.log(`   dropping @${dropHandle} (match still open, opponent @${oppHandle})`)

  if (viaAdmin) await svc.adminDropPlayer(code, dropId)
  else await svc.dropSelfByWallet(code, `0xnowallet_${dropHandle}`, dropHandle)

  snap = await svc.getSnapshotByCode(code)
  const after = snap.matches.find((m: any) => m.id === target.id)
  ok(after.status === 'confirmed', `dropped player's open match auto-confirmed (got ${after.status})`)
  ok(after.winnerId === oppId, `opponent @${oppHandle} recorded as the winner of the forfeit`)
  const droppedRow = snap.players.find((p: any) => p.id === dropId)
  ok(droppedRow?.dropped === true, `@${dropHandle} marked dropped`)

  // The round was the last unresolved match -> it should have advanced to R2.
  ok(snap.tournament.status === 'running', `tournament still running after the drop`)
  const r2 = snap.rounds.find((r: any) => r.number === 2)
  ok(!!r2, `round 2 was generated after the forfeit completed round 1`)
  if (r2) {
    const r2Players = new Set<string>()
    for (const m of snap.matches.filter((mm: any) => mm.roundId === r2.id)) {
      r2Players.add(m.player1Id)
      if (m.player2Id) r2Players.add(m.player2Id)
    }
    ok(!r2Players.has(dropId), `dropped @${dropHandle} is NOT paired in round 2`)
    ok(r2Players.size === 7, `round 2 has the 7 remaining active players (got ${r2Players.size})`)
    const r2Byes = snap.matches.filter((mm: any) => mm.roundId === r2.id && mm.status === 'bye')
    ok(r2Byes.length === 1, `odd field after drop -> exactly one bye in round 2 (got ${r2Byes.length})`)
  }
  return code
}

// ── D. Drop during enrolling -> excluded from the bracket ────────────────────
async function scenarioEnrollDrop() {
  section('D. Drop during enrolling is excluded from the bracket')
  const N = 9
  const { code, handles } = await setupEnrolled('enrolldrop', N)
  await svc.adminApproveAllPending(code)
  let snap = await svc.getSnapshotByCode(code)
  const victim = snap.players.find((p: any) => p.xHandle === handles[0])
  await svc.dropSelfByWallet(code, `0xnowallet_${handles[0]}`, handles[0])
  await svc.adminStartBracket(code)
  snap = await svc.getSnapshotByCode(code)
  const tId = snap.tournament.id
  const { data: dbPlayers } = await previewSb
    .from('players')
    .select('x_handle, seed, dropped')
    .eq('tournament_id', tId)
  const seededActive = (dbPlayers ?? []).filter((p: any) => p.seed != null && !p.dropped)
  ok(seededActive.length === 8, `bracket seeded the 8 non-dropped players (got ${seededActive.length})`)
  const r1Players = new Set<string>()
  for (const m of snap.matches.filter((m: any) => m.status !== 'bye')) {
    r1Players.add(m.player1Id)
    if (m.player2Id) r1Players.add(m.player2Id)
  }
  ok(!r1Players.has(victim.id), `@${handles[0]} dropped pre-start is absent from round 1`)
}

// ── E. Full event with a mid-round drop still completes cleanly ──────────────
async function scenarioFullWithDrop() {
  section('E. Full 8-player event with a mid-round drop still completes')
  const N = 8
  const { code, handles } = await setupEnrolled('fulldrop', N)
  await svc.adminApproveAllPending(code)
  await svc.adminStartBracket(code)
  let snap = await svc.getSnapshotByCode(code)

  // Round 1: drop the weakest player (won't be champion), resolve the rest.
  const r1 = snap.rounds.find((r: any) => r.status === 'active')
  const idToHandle = new Map<string, string>(snap.players.map((p: any) => [p.id, p.xHandle]))
  const r1Matches = snap.matches.filter((m: any) => m.roundId === r1.id && m.player2Id)
  // pick the player with the lowest skill to drop
  const weakest = [...handles].sort((a, b) => skillOf(a) - skillOf(b))[0]
  const dropMatch = r1Matches.find((m: any) => idToHandle.get(m.player1Id) === weakest || idToHandle.get(m.player2Id) === weakest)
  const dropId = idToHandle.get(dropMatch.player1Id) === weakest ? dropMatch.player1Id : dropMatch.player2Id
  await svc.dropSelfByWallet(code, `0xnowallet_${weakest}`, weakest)
  console.log(`   dropped @${weakest} in round 1`)
  // resolve any remaining open matches each round until complete
  let guard = 0
  while (snap.tournament.status === 'running' && guard++ < 50) {
    const active = snap.rounds.find((r: any) => r.status === 'active')
    if (!active) break
    const open = snap.matches.filter((m: any) => m.roundId === active.id && m.player2Id && m.status !== 'bye' && m.status !== 'confirmed')
    if (open.length === 0) {
      snap = await svc.getSnapshotByCode(code)
      continue
    }
    for (const m of open) await resolveMatch(code, snap, m)
    snap = await svc.getSnapshotByCode(code)
  }
  ok(snap.tournament.status === 'complete', `event completed despite the drop (status=${snap.tournament.status})`)
  const dropStanding = snap.standings.find((s: any) => s.playerId === dropId)
  ok(!!dropStanding?.dropped, `dropped player flagged as dropped in final standings`)
  // dropped player never appears as a participant after round 1
  const roundsAfter1 = snap.rounds.filter((r: any) => r.number > 1).map((r: any) => r.id)
  const playedAfter = snap.matches.some(
    (m: any) => roundsAfter1.includes(m.roundId) && (m.player1Id === dropId || m.player2Id === dropId),
  )
  ok(!playedAfter, `dropped player was not paired in any round after they left`)
  const champ = snap.standings[0]
  ok(champ.rank === 1 && champ.playerId !== dropId, `a non-dropped player is the champion`)
  // ranks are a clean permutation
  const ranks = snap.standings.map((s: any) => s.rank).sort((a: number, b: number) => a - b)
  ok(ranks.every((r: number, i: number) => r === i + 1), `final ranks form a clean 1..${ranks.length} sequence`)
}

async function main() {
  svc = (await import(root + 'src/lib/tournament/service.ts')) as unknown as Svc

  await scenarioRandomR1()
  await scenarioMidRoundDrop(false)
  await scenarioMidRoundDrop(true)
  await scenarioEnrollDrop()
  await scenarioFullWithDrop()

  console.log(`\n──────────────────────────────────────────`)
  console.log(`${pass} passed, ${fail} failed`)
  if (fail > 0) {
    console.log('\nFAILURES:')
    for (const f of failures) console.log(`  - ${f}`)
  }
  console.log(fail === 0 ? 'ALL PASS' : 'FAILURES PRESENT')
  process.exit(fail === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
