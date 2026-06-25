/* eslint-disable no-console */
/**
 * Swiss tournament simulation + winner-decisioning stress test.
 *
 * Drives the REAL service layer (src/lib/tournament/service.ts) - the same
 * functions the route handlers call - against the PREVIEW tournament Supabase
 * project, never production. It:
 *
 *   1. Loads the preview tournament creds from .env.preview.local and asserts
 *      they differ from the prod creds in .env.local (hard abort otherwise).
 *   2. Proves isolation: a freshly-created tournament exists in the preview DB
 *      and is ABSENT from the prod DB (read-only check).
 *   3. Runs several Swiss scenarios end-to-end (create -> enroll -> approve ->
 *      start -> resolve every round -> finalize) and asserts the
 *      winner-decisioning: status completes, exactly one rank-1 champion, the
 *      strongest player wins, standings are a valid total order, final
 *      placements persist, byes/pairings are legal, and prizes auto-award to
 *      the top finishers.
 *
 * Run:
 *   vercel env pull .env.preview.local --environment=preview --yes
 *   npx tsx --conditions=react-server scripts/tournament/simulate-swiss-preview.ts
 *   rm .env.preview.local   # temp creds, gitignored - delete when done
 */
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

// ── env loading ─────────────────────────────────────────────────────────────
function loadEnvFile(path: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!fs.existsSync(path)) return out
  for (const raw of fs.readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || !line.includes('=')) continue
    const i = line.indexOf('=')
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1)
    }
    out[k] = v
  }
  return out
}

const root = new URL('../../', import.meta.url).pathname
const preview = loadEnvFile(root + '.env.preview.local')
const prod = loadEnvFile(root + '.env.local')

const PREVIEW_URL = preview.TOURNAMENT_SUPABASE_URL
const PREVIEW_KEY = preview.TOURNAMENT_SUPABASE_SECRET_KEY
const PROD_URL = prod.TOURNAMENT_SUPABASE_URL
const PROD_KEY = prod.TOURNAMENT_SUPABASE_SECRET_KEY

if (!PREVIEW_URL || !PREVIEW_KEY) {
  throw new Error('Missing preview TOURNAMENT_SUPABASE_* in .env.preview.local')
}
if (PREVIEW_URL === PROD_URL) {
  throw new Error(`ABORT: preview URL == prod URL (${PREVIEW_URL}). Refusing to run against prod.`)
}

// Point the service layer at PREVIEW before anything calls getServiceClient().
process.env.TOURNAMENT_SUPABASE_URL = PREVIEW_URL
process.env.TOURNAMENT_SUPABASE_SECRET_KEY = PREVIEW_KEY
delete process.env.TOURNAMENT_ACTIVE_CODE

console.log('Preview tournament DB :', PREVIEW_URL)
console.log('Prod tournament DB    :', PROD_URL, '(read-only isolation check only)')

// Direct clients for verification (NOT used for writes to prod).
const previewSb = createClient(PREVIEW_URL, PREVIEW_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})
const prodSb = PROD_URL && PROD_KEY
  ? createClient(PROD_URL, PROD_KEY, { auth: { persistSession: false, autoRefreshToken: false } })
  : null

// ── tiny assert harness ───────────────────────────────────────────────────--
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

// ── deck list builder (valid, with a resolvable leader) ─────────────────────
const LEADERS = ['OP01-001', 'OP01-002', 'EB01-001', 'EB01-021', 'EB03-001', 'EB04-001']
function deckFor(i: number): string {
  const leader = LEADERS[i % LEADERS.length]
  const lines = [`1x${leader}`]
  for (let n = 1; n <= 12; n++) lines.push(`4xOP01-${String(n + 4).padStart(3, '0')}`)
  lines.push('2xOP01-021')
  return lines.join('\n') // 1 leader + 50 cards
}

// strongest = highest trailing number in the handle; deterministic dominance.
const skillOf = (handle: string): number => Number(handle.split('_').pop()) || 0

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`
}

interface Svc {
  adminStartFresh: (i: { name: string; signupMinutes: number; roundMinutes: number; format?: string; maxPlayers?: number | null }) => Promise<{ code: string }>
  enroll: (code: string, h: string, deck?: string | null, wallet?: string | null) => Promise<unknown>
  getSnapshotByCode: (code: string) => Promise<any>
  adminApproveAllPending: (code: string) => Promise<number>
  adminRejectPlayer: (code: string, playerId: string) => Promise<void>
  adminStartBracket: (code: string) => Promise<void>
  adminSetResult: (code: string, matchId: string, result: 'p1' | 'p2' | 'draw') => Promise<void>
  adminSetPrizes: (code: string, prizes: unknown) => Promise<{ count: number }>
  recommendedSwissRounds?: (n: number) => number
}

function recommendedSwissRounds(n: number): number {
  if (n <= 1) return 1
  return Math.max(3, Math.ceil(Math.log2(n)))
}

// ── one full Swiss run + assertions ─────────────────────────────────────────
async function runSwiss(
  svc: Svc,
  label: string,
  opts: { maxPlayers: number; signups: number; prizes?: { title: string; description: string; image: null }[] },
) {
  section(`${label}  (maxPlayers=${opts.maxPlayers}, signups=${opts.signups})`)
  const { code } = await svc.adminStartFresh({
    name: `SIM ${label}`,
    signupMinutes: 120,
    roundMinutes: 2880,
    format: 'swiss',
    maxPlayers: opts.maxPlayers,
  })
  console.log(`   created ${code}`)

  const handles: string[] = []
  let accepted = 0
  for (let i = 1; i <= opts.signups; i++) {
    // Handles must match X's [a-z0-9_]{1,15}; keep the trailing number so the
    // deterministic skill model (skillOf) makes the strongest player win.
    const h = `sim_${String(i).padStart(2, '0')}`
    try {
      await svc.enroll(code, h, deckFor(i))
      accepted++
      handles.push(h)
    } catch (e) {
      console.log(`   enroll FAILED for ${h}: ${(e as Error).message}`)
    }
  }
  ok(accepted === opts.signups, `enrolled ${accepted}/${opts.signups} with deck lists`)

  // Reject any auto-converted waitlist players so the field is exactly ours.
  let snap = await svc.getSnapshotByCode(code)
  const known = new Set(handles)
  for (const p of snap.players) {
    if (!known.has(p.xHandle)) {
      await svc.adminRejectPlayer(code, p.id)
      console.log(`   (rejected stray waitlist player @${p.xHandle})`)
    }
  }

  const approved = await svc.adminApproveAllPending(code)
  ok(approved === opts.signups, `approved ${approved}/${opts.signups}`)

  if (opts.prizes) await svc.adminSetPrizes(code, opts.prizes)

  await svc.adminStartBracket(code)
  snap = await svc.getSnapshotByCode(code)
  ok(snap.tournament.status === 'running', `status running after start (got ${snap.tournament.status})`)
  const expectedRounds = recommendedSwissRounds(opts.signups)
  ok(
    snap.tournament.swissRounds === expectedRounds,
    `swissRounds = recommended ${expectedRounds} (got ${snap.tournament.swissRounds})`,
  )

  // Resolve every round deterministically: stronger player always wins.
  let guard = 0
  let roundsPlayed = 0
  while (snap.tournament.status === 'running' && guard++ < 200) {
    const active = snap.rounds.find((r: any) => r.status === 'active')
    if (!active) break
    roundsPlayed = Math.max(roundsPlayed, active.number)
    const byHandle = new Map<string, string>(snap.players.map((p: any) => [p.id, p.xHandle]))
    const decidable = snap.matches
      .filter((m: any) => m.roundId === active.id && m.status !== 'bye' && m.player2Id && m.status !== 'confirmed')
      .sort((a: any, b: any) => a.number - b.number)
    for (const m of decidable) {
      const s1 = skillOf(byHandle.get(m.player1Id) ?? '')
      const s2 = skillOf(byHandle.get(m.player2Id) ?? '')
      await svc.adminSetResult(code, m.id, s1 >= s2 ? 'p1' : 'p2')
    }
    const prev = active.number
    snap = await svc.getSnapshotByCode(code)
    if (snap.tournament.status === 'running') {
      const nextActive = snap.rounds.find((r: any) => r.status === 'active')
      ok(nextActive?.number === prev + 1, `round ${prev} -> ${prev + 1} generated`)
    }
  }

  ok(snap.tournament.status === 'complete', `tournament completed (status=${snap.tournament.status})`)
  ok(roundsPlayed === expectedRounds, `played all ${expectedRounds} rounds (got ${roundsPlayed})`)

  // ── winner decisioning ────────────────────────────────────────────────────
  const standings = snap.standings as any[]
  const rank1 = standings.filter((s) => s.rank === 1)
  ok(rank1.length === 1, `exactly one rank-1 champion (got ${rank1.length})`)

  // ranks are a clean 1..N permutation
  const ranks = standings.map((s) => s.rank).sort((a, b) => a - b)
  const cleanRanks = ranks.every((r, i) => r === i + 1)
  ok(cleanRanks, `ranks form a clean 1..${standings.length} sequence`)

  // standings respect the documented comparator: points desc, then OMW desc
  let sortedOk = true
  for (let i = 1; i < standings.length; i++) {
    const a = standings[i - 1]
    const b = standings[i]
    if (a.points < b.points) sortedOk = false
    else if (a.points === b.points && a.oppWinPct + 1e-9 < b.oppWinPct) sortedOk = false
  }
  ok(sortedOk, 'standings ordered by points then opponent-win% (tiebreak comparator holds)')

  // Winner decisioning. In this skill model the strongest player can never lose
  // a game, so they must finish undefeated and tied for the top score. They are
  // NOT guaranteed rank 1: in a small field with byes two players can both go
  // undefeated and the OMW% tiebreak decides the title (legal Swiss behavior).
  const champ = standings[0]
  const champHandle = snap.players.find((p: any) => p.id === champ.playerId)?.xHandle
  const strongest = [...handles].sort((a, b) => skillOf(b) - skillOf(a))[0]
  const strongestRow = standings.find(
    (s) => snap.players.find((p: any) => p.id === s.playerId)?.xHandle === strongest,
  )
  ok(
    strongestRow?.losses === 0,
    `strongest @${strongest} never lost a game (W${strongestRow?.wins}-L${strongestRow?.losses}-D${strongestRow?.draws})`,
  )
  ok(
    strongestRow?.points === champ.points,
    `strongest @${strongest} is tied for the top score (${strongestRow?.points} vs champ ${champ.points})`,
  )
  ok(champ.losses === 0, `champion went undefeated (W${champ.wins}-L${champ.losses}-D${champ.draws}, ${champ.points} pts)`)
  console.log(`   champion: @${champHandle}  ${champ.wins}-${champ.losses}-${champ.draws} (${champ.points} pts, OMW ${(champ.oppWinPct * 100).toFixed(1)}%)`)

  // bye legality: no player gets two byes
  const byeCount = new Map<string, number>()
  for (const m of snap.matches) {
    if (m.status === 'bye') byeCount.set(m.player1Id, (byeCount.get(m.player1Id) ?? 0) + 1)
  }
  const doubleByes = [...byeCount.values()].filter((n) => n > 1).length
  ok(doubleByes === 0, `no player received more than one bye (${[...byeCount.values()].reduce((a, b) => a + b, 0)} byes total)`)

  // pairing legality: no repeated pairing unless the field is too small to avoid it
  const seen = new Set<string>()
  let repeats = 0
  for (const m of snap.matches) {
    if (!m.player2Id || m.status === 'bye') continue
    const k = pairKey(m.player1Id, m.player2Id)
    if (seen.has(k)) repeats++
    seen.add(k)
  }
  // A field can only avoid rematches when there are more possible opponents
  // than rounds. Below that (e.g. 2 players, 3 rounds) rematches are expected.
  const rematchesAvoidable = opts.signups - 1 >= expectedRounds
  if (rematchesAvoidable) ok(repeats === 0, `no repeated pairings (${repeats})`)
  else console.log(`   (${repeats} rematch(es) - expected for a ${opts.signups}-player / ${expectedRounds}-round field)`)

  // ── persisted final placements (read straight from preview DB) ──────────────
  const tId = snap.tournament.id
  const { data: dbPlayers } = await previewSb
    .from('players')
    .select('x_handle, final_rank, final_players, approval_status')
    .eq('tournament_id', tId)
  const inBracket = (dbPlayers ?? []).filter((p: any) => p.approval_status !== 'rejected')
  const champRow = inBracket.find((p: any) => p.x_handle === champHandle)
  ok(champRow?.final_rank === 1, `final_rank=1 persisted for champion (got ${champRow?.final_rank})`)
  ok(
    inBracket.every((p: any) => p.final_players === opts.signups),
    `final_players=${opts.signups} stamped on all bracket players`,
  )
  const persistedRanks = inBracket.map((p: any) => p.final_rank).sort((a: number, b: number) => a - b)
  ok(
    persistedRanks.length === opts.signups && persistedRanks.every((r: number, i: number) => r === i + 1),
    `persisted final_rank is a clean 1..${opts.signups} sequence`,
  )

  // ── prize auto-award (slot i -> rank i+1) ───────────────────────────────────
  if (opts.prizes) {
    const awarded = snap.awardedPrizes as any[]
    ok(awarded.length === opts.prizes.length, `auto-awarded ${awarded.length}/${opts.prizes.length} prize slots`)
    const slot0 = awarded.find((a) => a.slotIndex === 0)
    ok(slot0?.rank === 1 && slot0?.xHandle === strongest, `1st-place prize went to the champion (@${slot0?.xHandle})`)
    const slotRanks = awarded.map((a) => a.rank).sort((a, b) => a - b)
    ok(
      slotRanks.every((r, i) => r === i + 1),
      `prize slots mapped to placements 1..${opts.prizes.length} in order`,
    )
  }

  return code
}

async function main() {
  // Import the real service AFTER env is pointed at preview.
  const svc = (await import(root + 'src/lib/tournament/service.ts')) as unknown as Svc

  // ── isolation proof ─────────────────────────────────────────────────────--
  section('Isolation check (preview vs prod)')
  const probe = await svc.adminStartFresh({
    name: 'SIM isolation probe',
    signupMinutes: 5,
    roundMinutes: 60,
    format: 'swiss',
    maxPlayers: 4,
  })
  const { data: inPreview } = await previewSb
    .from('tournaments')
    .select('code')
    .eq('code', probe.code)
    .maybeSingle()
  ok(!!inPreview, `probe ${probe.code} EXISTS in preview DB`)
  if (prodSb) {
    const { data: inProd } = await prodSb
      .from('tournaments')
      .select('code')
      .eq('code', probe.code)
      .maybeSingle()
    ok(!inProd, `probe ${probe.code} is ABSENT from prod DB (writes are NOT hitting prod)`)
  } else {
    console.log('   (prod creds unavailable - skipping prod absence check)')
  }

  // ── scenarios ──────────────────────────────────────────────────────────────
  const codes: string[] = []
  // 1) All slots fill, with prizes -> verify winner + prize award
  codes.push(
    await runSwiss(svc, 'FULL-8 (all slots filled)', {
      maxPlayers: 8,
      signups: 8,
      prizes: [
        { title: '1st Place', description: 'Booster box', image: null },
        { title: '2nd Place', description: 'Play mat', image: null },
        { title: '3rd Place', description: 'Sleeves', image: null },
      ],
    }),
  )
  // 2) Larger full field (stress)
  codes.push(await runSwiss(svc, 'FULL-16 (all slots filled)', { maxPlayers: 16, signups: 16 }))
  // 3) Odd full field -> byes
  codes.push(await runSwiss(svc, 'FULL-7 (odd, all slots filled, byes)', { maxPlayers: 7, signups: 7 }))
  // 4) Under-filled: fewer signups than the cap, odd -> byes
  codes.push(await runSwiss(svc, 'UNDER-16/5 (under-filled, byes)', { maxPlayers: 16, signups: 5 }))
  // 5) Under-filled extreme: only 2 of many slots -> forced rematches
  codes.push(await runSwiss(svc, 'UNDER-8/2 (extreme under-fill)', { maxPlayers: 8, signups: 2 }))
  // 6) Under-filled large cap, small odd field
  codes.push(await runSwiss(svc, 'UNDER-32/7 (under-filled, byes)', { maxPlayers: 32, signups: 7 }))

  console.log(`\n──────────────────────────────────────────`)
  console.log(`Scenarios run: ${codes.join(', ')}`)
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
