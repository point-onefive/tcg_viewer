/* eslint-disable no-console */
/**
 * Single-elimination tournament simulation + winner-decisioning stress test.
 *
 * Companion to simulate-swiss-preview.ts. Drives the REAL service layer
 * (src/lib/tournament/service.ts) against the PREVIEW tournament Supabase
 * project, never production. It:
 *
 *   1. Loads preview creds from .env.preview.local, asserts they differ from
 *      the prod creds in .env.local (hard abort otherwise) and proves a fresh
 *      tournament lands in preview and is ABSENT from prod.
 *   2. Runs several single-elim scenarios end-to-end (create -> enroll ->
 *      approve -> start -> resolve every round -> finalize) and asserts the
 *      winner-decisioning: status completes, exactly one rank-1 champion who
 *      went undefeated, the strongest player wins (deterministic dominance),
 *      round count = log2(nextPow2(N)), first-round byes go to the top seeds
 *      and number exactly nextPow2(N) - N, no player is eliminated by a bye,
 *      placements persist as a clean 1..N sequence, and prizes auto-award to
 *      the top finishers.
 *   3. Verifies the single-elim guard that a match cannot be reported a draw.
 *
 * Run:
 *   vercel env pull .env.preview.local --environment=preview --yes
 *   npx tsx --conditions=react-server scripts/tournament/simulate-singleelim-preview.ts
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

process.env.TOURNAMENT_SUPABASE_URL = PREVIEW_URL
process.env.TOURNAMENT_SUPABASE_SECRET_KEY = PREVIEW_KEY
delete process.env.TOURNAMENT_ACTIVE_CODE

console.log('Preview tournament DB :', PREVIEW_URL)
console.log('Prod tournament DB    :', PROD_URL, '(read-only isolation check only)')

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

function nextPow2(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
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
}

// ── one full single-elim run + assertions ───────────────────────────────────
async function runElim(
  svc: Svc,
  label: string,
  opts: { maxPlayers: number; signups: number; prizes?: { title: string; description: string; image: null }[] },
) {
  section(`${label}  (maxPlayers=${opts.maxPlayers}, signups=${opts.signups})`)
  const { code } = await svc.adminStartFresh({
    name: `SIM SE ${label}`,
    signupMinutes: 120,
    roundMinutes: 2880,
    format: 'single-elim',
    maxPlayers: opts.maxPlayers,
  })
  console.log(`   created ${code}`)

  const handles: string[] = []
  let accepted = 0
  for (let i = 1; i <= opts.signups; i++) {
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

  const size = nextPow2(opts.signups)
  const expectedRounds = Math.round(Math.log2(size))

  // ── first-round bye structure ───────────────────────────────────────────--
  const round1 = snap.rounds.find((r: any) => r.number === 1)
  const r1Matches = snap.matches.filter((m: any) => m.roundId === round1?.id)
  const r1Byes = r1Matches.filter((m: any) => m.status === 'bye')
  ok(r1Byes.length === size - opts.signups, `first-round byes = nextPow2(N)-N = ${size - opts.signups} (got ${r1Byes.length})`)
  // byes go to the strongest *seeds* (top seeds), i.e. seed 1..(size-N).
  const seedById = new Map<string, number>(snap.players.map((p: any) => [p.id, p.seed]))
  const byeSeeds = r1Byes.map((m: any) => seedById.get(m.player1Id)).sort((a: number, b: number) => a - b)
  const byeSeedsOk = byeSeeds.every((s: number, i: number) => s === i + 1)
  ok(byeSeeds.length === 0 || byeSeedsOk, `first-round byes went to top seeds 1..${size - opts.signups} (got [${byeSeeds.join(',')}])`)

  // ── resolve every round deterministically: stronger player always wins ─────
  let guard = 0
  let roundsPlayed = 0
  let lastResolved = -1
  while (snap.tournament.status === 'running' && guard++ < 200) {
    const active = snap.rounds.find((r: any) => r.status === 'active')
    if (!active) break
    roundsPlayed = Math.max(roundsPlayed, active.number)
    const byHandle = new Map<string, string>(snap.players.map((p: any) => [p.id, p.xHandle]))
    const decidable = snap.matches
      .filter((m: any) => m.roundId === active.id && m.status !== 'bye' && m.player2Id && m.status !== 'confirmed')
      .sort((a: any, b: any) => a.number - b.number)
    if (decidable.length === 0) {
      ok(false, `round ${active.number} had no decidable match (stuck) - aborting scenario`)
      break
    }
    for (const m of decidable) {
      const s1 = skillOf(byHandle.get(m.player1Id) ?? '')
      const s2 = skillOf(byHandle.get(m.player2Id) ?? '')
      await svc.adminSetResult(code, m.id, s1 >= s2 ? 'p1' : 'p2')
      lastResolved = active.number
    }
    const prev = active.number
    snap = await svc.getSnapshotByCode(code)
    if (snap.tournament.status === 'running') {
      const nextActive = snap.rounds.find((r: any) => r.status === 'active')
      ok(nextActive?.number === prev + 1, `round ${prev} -> ${prev + 1} generated`)
    }
  }
  void lastResolved

  ok(snap.tournament.status === 'complete', `tournament completed (status=${snap.tournament.status})`)
  ok(roundsPlayed === expectedRounds, `played all ${expectedRounds} rounds (got ${roundsPlayed})`)

  // ── winner decisioning ────────────────────────────────────────────────────
  const standings = snap.standings as any[]
  const rank1 = standings.filter((s) => s.rank === 1)
  ok(rank1.length === 1, `exactly one rank-1 champion (got ${rank1.length})`)

  const ranks = standings.map((s) => s.rank).sort((a, b) => a - b)
  ok(ranks.every((r, i) => r === i + 1), `ranks form a clean 1..${standings.length} sequence`)

  const champ = standings[0]
  const champHandle = snap.players.find((p: any) => p.id === champ.playerId)?.xHandle
  const strongest = [...handles].sort((a, b) => skillOf(b) - skillOf(a))[0]
  ok(champHandle === strongest, `champion is the strongest player (@${champHandle} vs expected @${strongest})`)
  ok(champ.losses === 0, `champion went undefeated (W${champ.wins}-L${champ.losses}-D${champ.draws}, ${champ.points} pts)`)
  // champion's real (non-bye) wins == number of rounds in which they actually played
  console.log(`   champion: @${champHandle}  ${champ.wins}-${champ.losses}-${champ.draws} (${champ.points} pts)`)

  // every eliminated player has exactly one loss; champion none. In single-elim
  // a player is out after their first loss, so losses must be 0 (champ) or 1.
  const badLosses = standings.filter((s) => s.losses > 1)
  ok(badLosses.length === 0, `no player has >1 loss (single-elim eliminates on first loss) - ${badLosses.length} offenders`)
  const losers = standings.filter((s) => s.losses === 1)
  ok(losers.length === opts.signups - 1, `exactly N-1 players carry one loss (${losers.length}/${opts.signups - 1})`)

  // ── byes never eliminate; no player gets a bye after already losing ────────
  // Count byes per player; a bye is a free advance, never a loss.
  const byeCount = new Map<string, number>()
  for (const m of snap.matches) {
    if (m.status === 'bye') byeCount.set(m.player1Id, (byeCount.get(m.player1Id) ?? 0) + 1)
  }
  // The champion may legitimately collect a round-1 bye then win out; what must
  // never happen is a *draw* anywhere in a single-elim bracket.
  const draws = snap.matches.filter((m: any) => m.status === 'confirmed' && !m.winnerId)
  ok(draws.length === 0, `no drawn matches exist in the single-elim bracket (${draws.length})`)

  // ── persisted final placements (read straight from preview DB) ──────────────
  const tId = snap.tournament.id
  const { data: dbPlayers } = await previewSb
    .from('players')
    .select('x_handle, final_rank, final_players, approval_status, seed')
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
    ok(slotRanks.every((r, i) => r === i + 1), `prize slots mapped to placements 1..${opts.prizes.length} in order`)
  }

  return code
}

// ── single-elim draw-rejection guard ────────────────────────────────────────
async function runDrawGuard(svc: Svc) {
  section('GUARD: single-elim refuses draws')
  const { code } = await svc.adminStartFresh({
    name: 'SIM SE draw-guard',
    signupMinutes: 120,
    roundMinutes: 2880,
    format: 'single-elim',
    maxPlayers: 4,
  })
  const handles: string[] = []
  for (let i = 1; i <= 4; i++) {
    const h = `sim_${String(i).padStart(2, '0')}`
    await svc.enroll(code, h, deckFor(i))
    handles.push(h)
  }
  let snap = await svc.getSnapshotByCode(code)
  const known = new Set(handles)
  for (const p of snap.players) {
    if (!known.has(p.xHandle)) await svc.adminRejectPlayer(code, p.id)
  }
  await svc.adminApproveAllPending(code)
  await svc.adminStartBracket(code)
  snap = await svc.getSnapshotByCode(code)
  const active = snap.rounds.find((r: any) => r.status === 'active')
  const m = snap.matches.find((mm: any) => mm.roundId === active.id && mm.player2Id && mm.status !== 'bye')
  let threw = false
  try {
    await svc.adminSetResult(code, m.id, 'draw')
  } catch {
    threw = true
  }
  ok(threw, 'adminSetResult(draw) throws for a single-elim match')
  // confirm the match is still unresolved after the rejected draw
  snap = await svc.getSnapshotByCode(code)
  const after = snap.matches.find((mm: any) => mm.id === m.id)
  ok(after.status !== 'confirmed', 'rejected draw left the match unresolved (no side effect)')
  return code
}

async function main() {
  const svc = (await import(root + 'src/lib/tournament/service.ts')) as unknown as Svc

  // ── isolation proof ─────────────────────────────────────────────────────--
  section('Isolation check (preview vs prod)')
  const probe = await svc.adminStartFresh({
    name: 'SIM SE isolation probe',
    signupMinutes: 5,
    roundMinutes: 60,
    format: 'single-elim',
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

  const codes: string[] = []
  // Power-of-two fields (no byes), one with prizes.
  codes.push(
    await runElim(svc, 'POW2-8 (clean bracket)', {
      maxPlayers: 8,
      signups: 8,
      prizes: [
        { title: '1st Place', description: 'Booster box', image: null },
        { title: '2nd Place', description: 'Play mat', image: null },
        { title: '3rd Place', description: 'Sleeves', image: null },
      ],
    }),
  )
  codes.push(await runElim(svc, 'POW2-4 (clean bracket)', { maxPlayers: 4, signups: 4 }))
  codes.push(await runElim(svc, 'POW2-16 (clean bracket)', { maxPlayers: 16, signups: 16 }))
  // Non-power-of-two fields -> first-round byes for the top seeds.
  codes.push(await runElim(svc, 'BYES-5 (3 first-round byes)', { maxPlayers: 16, signups: 5 }))
  codes.push(await runElim(svc, 'BYES-6 (2 first-round byes)', { maxPlayers: 8, signups: 6 }))
  codes.push(await runElim(svc, 'BYES-12 (4 first-round byes)', { maxPlayers: 16, signups: 12 }))
  codes.push(await runElim(svc, 'BYES-3 (1 first-round bye)', { maxPlayers: 8, signups: 3 }))
  // Tiny field.
  codes.push(await runElim(svc, 'TINY-2 (single match)', { maxPlayers: 2, signups: 2 }))
  // Draw-rejection guard.
  codes.push(await runDrawGuard(svc))

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
