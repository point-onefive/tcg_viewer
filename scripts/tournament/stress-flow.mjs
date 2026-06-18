#!/usr/bin/env node
/**
 * Comprehensive end-to-end stress test of the tournament system against the
 * live API. Covers the full lifecycle for both formats plus the validation
 * and guard rails around it:
 *
 *   A. Sign-up validations (dup handle, invalid handle, cap, closed window)
 *   B. Prize pool set / clear round-trips through the snapshot
 *   C. Approve / reject flow
 *   D. Full single-elim run (8) + odd field with byes (6)
 *   E. Full Swiss run (8) + odd field with byes (5)
 *   F. set-result guards (draw rejected for single-elim, bye not reportable)
 *
 * Usage:  node scripts/tournament/stress-flow.mjs
 *         BASE_URL=http://localhost:3000 node scripts/tournament/stress-flow.mjs
 *
 * Reads TOURNAMENT_ADMIN_SECRET from .env.local. Read-heavy but it DOES create
 * tournaments + players in whatever DB the running server points at.
 */
import fs from 'node:fs'

const BASE = process.env.BASE_URL || 'http://localhost:3000'

const env = Object.fromEntries(
  fs
    .readFileSync(new URL('../../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#') && l.includes('='))
    .map((l) => {
      const i = l.indexOf('=')
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()]
    }),
)
const ADMIN = env.TOURNAMENT_ADMIN_SECRET
if (!ADMIN) throw new Error('TOURNAMENT_ADMIN_SECRET missing from .env.local')

let pass = 0
let failures = 0
const ok = (cond, msg) => {
  if (cond) {
    pass++
    console.log(`   ok  ${msg}`)
  } else {
    failures++
    console.log(`  FAIL ${msg}`)
  }
}
const section = (s) => console.log(`\n${s}`)

// admin call that never throws; returns { status, json }
async function adminRaw(body) {
  const res = await fetch(`${BASE}/api/tournaments/admin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${ADMIN}` },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  return { status: res.status, json }
}
async function admin(body) {
  const { status, json } = await adminRaw(body)
  if (status < 200 || status >= 300) throw new Error(`admin ${body.action} -> ${status} ${JSON.stringify(json)}`)
  return json
}

async function enrollRaw(code, handle) {
  // The public /:code/enroll endpoint is wallet-gated; seed players through
  // the admin add-player action instead (same enroll service underneath).
  return adminRaw({ action: 'add-player', code, xHandle: handle })
}

async function snapshot() {
  const res = await fetch(`${BASE}/api/tournaments/active`, { cache: 'no-store' })
  if (!res.ok) throw new Error(`snapshot -> ${res.status}`)
  return res.json()
}
const activeRound = (snap) => snap.rounds.find((r) => r.status === 'active')

async function create(name, format, maxPlayers, signupMinutes = 120) {
  const { code } = await admin({ action: 'start-fresh', name, signupMinutes, roundMinutes: 2880, format, maxPlayers })
  return code
}

// ── A. validations ──────────────────────────────────────────────────────────
async function validations() {
  section('A. Sign-up validations')
  const code = await create('Validation Run', 'swiss', 3)

  ok((await enrollRaw(code, 'valid_user_a')).status === 201, 'valid handle accepted (201)')
  ok((await enrollRaw(code, 'valid_user_a')).status >= 400, 'duplicate handle rejected')
  ok((await enrollRaw(code, '@valid_user_a')).status >= 400, 'duplicate w/ @ prefix rejected (normalized)')
  ok((await enrollRaw(code, 'bad handle!')).status >= 400, 'invalid handle (space/!) rejected')
  ok((await enrollRaw(code, '')).status >= 400, 'empty handle rejected')

  // fill to cap (3) then overflow
  await enrollRaw(code, 'valid_user_b')
  await enrollRaw(code, 'valid_user_c')
  ok((await enrollRaw(code, 'valid_user_d')).status >= 400, 'enroll past max cap rejected')

  await admin({ action: 'close-signup', code })
  ok((await enrollRaw(code, 'too_late')).status >= 400, 'enroll after close rejected')
  return code
}

// ── B. prizes ─────────────────────────────────────────────────────────────────
async function prizes() {
  section('B. Prize pool round-trip')
  const code = await create('Prize Run', 'swiss', 8)
  await admin({
    action: 'set-prizes',
    code,
    prizes: [
      { title: '1st', description: 'Booster box', image: null },
      { title: '2nd', description: 'Play mat', image: null },
    ],
  })
  let snap = await snapshot()
  ok(snap.tournament.prizes?.length === 2, `prizes saved + visible in snapshot (${snap.tournament.prizes?.length})`)
  ok(snap.tournament.prizes?.[0]?.title === '1st', 'prize 1 title round-trips')

  const empty = await adminRaw({ action: 'set-prizes', code, prizes: [{ title: '', description: '', image: null }] })
  ok(empty.status >= 400, 'fully-empty prize slot rejected')

  await admin({ action: 'set-prizes', code, prizes: [] })
  snap = await snapshot()
  ok((snap.tournament.prizes?.length ?? 0) === 0, 'prizes cleared')
  return code
}

// ── C. approve / reject ─────────────────────────────────────────────────────
async function approveReject() {
  section('C. Approve / reject flow')
  const code = await create('Approve Run', 'swiss', 8)
  for (const h of ['ar_one', 'ar_two', 'ar_three']) await enrollRaw(code, h)
  let snap = await snapshot()
  ok(snap.players.length === 3, 'three pending sign-ups')

  const victim = snap.players.find((p) => p.xHandle === 'ar_two')
  await admin({ action: 'reject', code, playerId: victim.id })
  const r = await admin({ action: 'approve-all', code })
  ok(r.approved === 2, `approve-all approves only the 2 non-rejected (got ${r.approved})`)
  snap = await snapshot()
  ok(snap.players.find((p) => p.id === victim.id)?.approvalStatus === 'rejected', 'rejected player stays rejected')
}

// ── D/E. full lifecycle for a format ─────────────────────────────────────────
async function runFormat(label, format, playerCount, expectByes) {
  section(`${label} (${playerCount} players)`)
  const code = await create(`Stress ${label}`, format, playerCount)
  const tag = format === 'swiss' ? 's' : 'e'
  let signed = 0
  for (let i = 1; i <= playerCount; i++) {
    if ((await enrollRaw(code, `flow_${tag}${playerCount}_${String(i).padStart(2, '0')}`)).status === 201) signed++
  }
  ok(signed === playerCount, `enrolled ${signed}/${playerCount}`)
  ok((await admin({ action: 'approve-all', code })).approved === playerCount, 'approved all')

  await admin({ action: 'start-bracket', code })
  let snap = await snapshot()
  ok(snap.tournament.status === 'running', 'running after start')
  ok(activeRound(snap)?.number === 1, 'round 1 active')

  if (expectByes) {
    const r1 = activeRound(snap)
    const byes = snap.matches.filter((m) => m.roundId === r1.id && (m.status === 'bye' || !m.player2Id)).length
    ok(byes >= 1, `odd field produced ${byes} bye(s) in round 1`)
  }

  // guard checks on the first decidable match before resolving the round
  if (format === 'single-elim') {
    const r1 = activeRound(snap)
    const m = snap.matches.find((x) => x.roundId === r1.id && x.player2Id && x.status !== 'bye')
    const draw = await adminRaw({ action: 'set-result', code, matchId: m.id, result: 'draw' })
    ok(draw.status >= 400, 'single-elim rejects a draw result')
  }
  const byeMatch = snap.matches.find((m) => m.status === 'bye' || !m.player2Id)
  if (byeMatch) {
    const r = await adminRaw({ action: 'set-result', code, matchId: byeMatch.id, result: 'p1' })
    ok(r.status >= 400, 'reporting a bye match is rejected')
  }

  // admin can record then CORRECT a result while the round is live (only when
  // the round has >1 decidable match, so the fix doesn't trigger advancement).
  {
    const r1 = activeRound(snap)
    const decidable = snap.matches
      .filter((m) => m.roundId === r1.id && m.player2Id && m.status !== 'bye')
      .sort((a, b) => a.number - b.number)
    if (decidable.length >= 2) {
      const m = decidable[0]
      await admin({ action: 'set-result', code, matchId: m.id, result: 'p1' })
      const fix = await adminRaw({ action: 'set-result', code, matchId: m.id, result: 'p2' })
      ok(fix.status >= 200 && fix.status < 300, 'admin can correct a live result')
      const after = (await snapshot()).matches.find((x) => x.id === m.id)
      ok(after?.winnerId === m.player2Id, 'correction flipped the winner')
    }
  }

  let guard = 0
  while (snap.tournament.status === 'running' && guard++ < 25) {
    const round = activeRound(snap)
    if (!round) break
    const decidable = snap.matches
      .filter((m) => m.roundId === round.id && m.status !== 'bye' && m.player2Id && m.status !== 'confirmed')
      .sort((a, b) => a.number - b.number)
    for (const m of decidable) {
      await admin({ action: 'set-result', code, matchId: m.id, result: m.number % 2 === 0 ? 'p2' : 'p1' })
    }
    const prev = round.number
    snap = await snapshot()
    if (snap.tournament.status === 'running') {
      ok(activeRound(snap)?.number === prev + 1, `round ${prev} -> ${prev + 1} generated`)
    }
  }
  ok(snap.tournament.status === 'complete', `completed (status=${snap.tournament.status})`)

  if (format === 'single-elim') {
    const ordered = [...snap.rounds].sort((a, b) => a.number - b.number)
    const finalMatch = snap.matches.find((m) => m.roundId === ordered[ordered.length - 1].id)
    const champ = snap.players.find((p) => p.id === finalMatch?.winnerId)
    ok(!!champ, `champion crowned: @${champ?.xHandle ?? '???'}`)
  } else {
    ok(snap.matches.filter((m) => m.status === 'confirmed').length > 0, 'swiss recorded confirmed matches')
  }
  // edits are locked once the tournament is complete
  const anyMatch = snap.matches.find((m) => m.status === 'confirmed')
  if (anyMatch) {
    const r = await adminRaw({ action: 'set-result', code, matchId: anyMatch.id, result: 'p1' })
    ok(r.status >= 400, 'results locked after completion')
  }
  return code
}

async function main() {
  console.log(`Base: ${BASE}`)
  await validations()
  await prizes()
  await approveReject()
  await runFormat('SINGLE-ELIM', 'single-elim', 8, false)
  await runFormat('SINGLE-ELIM byes', 'single-elim', 6, true)
  await runFormat('SWISS', 'swiss', 8, false)
  await runFormat('SWISS byes', 'swiss', 5, true)
  console.log(`\n${pass} passed, ${failures} failed`)
  console.log(failures === 0 ? 'ALL PASS' : 'FAILURES PRESENT')
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR:', e.message || e)
  process.exit(1)
})
