/* eslint-disable no-console */
/**
 * Role-play helper for the PREVIEW environment ONLY.
 *
 * The user has joined the live tournament on the preview website and wants to
 * personally experience reporting a match result. This script:
 *
 *   - Loads preview creds from .env.preview.local and HARD-ABORTS if they match
 *     the prod creds in .env.local. It only ever writes to the preview DB.
 *   - Operates on the EXISTING live preview tournament (the one you joined). It
 *     never creates a new tournament, so your sign-up is preserved.
 *
 * Modes:
 *   (default)  inspect  - print the live tournament + roster, nothing written.
 *   --go       act      - add dummy opponents (default 3) with valid deck lists,
 *                         approve everyone, then start round 1 so you can report.
 *   --bots N            - how many dummy opponents to add (with --go).
 *
 * Run:
 *   vercel env pull .env.preview.local --environment=preview --yes
 *   npx tsx --conditions=react-server scripts/tournament/preview-roleplay.ts
 *   npx tsx --conditions=react-server scripts/tournament/preview-roleplay.ts --go --bots 3
 *   rm .env.preview.local   # temp creds, gitignored - delete when done
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
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
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

if (!PREVIEW_URL || !PREVIEW_KEY) throw new Error('Missing preview TOURNAMENT_SUPABASE_* in .env.preview.local')
if (PREVIEW_URL === PROD_URL) throw new Error(`ABORT: preview URL == prod URL (${PREVIEW_URL}). Refusing to run.`)

process.env.TOURNAMENT_SUPABASE_URL = PREVIEW_URL
process.env.TOURNAMENT_SUPABASE_SECRET_KEY = PREVIEW_KEY
delete process.env.TOURNAMENT_ACTIVE_CODE

const GO = process.argv.includes('--go')
const botsArgIdx = process.argv.indexOf('--bots')
const BOTS = botsArgIdx >= 0 ? Math.max(1, parseInt(process.argv[botsArgIdx + 1] ?? '3', 10)) : 3
const BOT_PREFIX = 'rp_bot_'

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
console.log('  PREVIEW ONLY  ·  DB:', PREVIEW_URL)
console.log('  mode:', GO ? `ACT (add ${BOTS} bots + start round 1)` : 'inspect (read-only)')
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')

const previewSb = createClient(PREVIEW_URL, PREVIEW_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// Valid OPTCG deck: 1 leader + 50 cards.
function deckFor(i: number): string {
  const leaders = ['OP01-001', 'OP01-002', 'EB01-001', 'EB01-021']
  const lines = [`1x${leaders[i % leaders.length]}`]
  for (let n = 1; n <= 12; n++) lines.push(`4xOP01-${String(n + 4).padStart(3, '0')}`)
  lines.push('2xOP01-021')
  return lines.join('\n')
}

interface Svc {
  getActiveSnapshot: () => Promise<any>
  getSnapshotByCode: (code: string) => Promise<any>
  enroll: (code: string, h: string, deck?: string | null, wallet?: string | null) => Promise<{ playerToken: string }>
  adminExtendSignup: (code: string, extra: number) => Promise<void>
  adminApproveAllPending: (code: string) => Promise<number>
  adminStartBracket: (code: string) => Promise<void>
}

function printRoster(snap: any) {
  const t = snap.tournament
  console.log(`\nTournament : ${t.name}  (${t.code})`)
  console.log(`Format     : ${t.format}`)
  console.log(`Status     : ${t.status}`)
  console.log(`Max players: ${t.maxPlayers ?? 'none'}`)
  console.log(`Round len  : ${t.roundMinutes}m`)
  console.log(`Signups close: ${t.enrollClosesAt ?? 'manual'}${
    t.enrollClosesAt && new Date(t.enrollClosesAt) <= new Date() ? '  (ELAPSED)' : ''
  }`)
  console.log(`\nRoster (${snap.players.length}):`)
  for (const p of snap.players) {
    const bot = p.xHandle.startsWith(BOT_PREFIX) ? 'bot ' : 'USER'
    console.log(
      `  [${bot}] @${p.xHandle.padEnd(16)} ${String(p.approvalStatus).padEnd(9)} deck:${p.hasDeckList ? 'yes' : 'NO '} seed:${p.seed ?? '-'}`,
    )
  }
}

function printRound1(snap: any) {
  const byId = new Map<string, any>(snap.players.map((p: any) => [p.id, p]))
  const r1 = [...snap.rounds].sort((a: any, b: any) => a.number - b.number)[0]
  if (!r1) {
    console.log('\n(no rounds yet)')
    return
  }
  const ms = snap.matches
    .filter((m: any) => m.roundId === r1.id)
    .sort((a: any, b: any) => a.number - b.number)
  console.log(`\nRound ${r1.number} pairings:`)
  for (const m of ms) {
    const p1 = byId.get(m.player1Id)
    const p2 = m.player2Id ? byId.get(m.player2Id) : null
    const tag = (p: any) => (p ? `@${p.xHandle}${p.xHandle.startsWith(BOT_PREFIX) ? '' : '  <-- YOU'}` : 'bye')
    console.log(`  M${m.number}: ${tag(p1)}  vs  ${p2 ? tag(p2) : 'BYE'}`)
  }
}

async function main() {
  const svc = (await import(root + 'src/lib/tournament/service.ts')) as unknown as Svc

  let snap
  try {
    snap = await svc.getActiveSnapshot()
  } catch (e) {
    console.error('\nNo active (is_live) tournament found in preview:', (e as Error).message)
    process.exit(1)
  }

  printRoster(snap)

  if (!GO) {
    console.log('\n(read-only inspect; re-run with --go to add bots + start round 1)')
    process.exit(0)
  }

  const t = snap.tournament
  if (t.status !== 'enrolling') {
    console.error(`\nABORT: tournament is '${t.status}', not 'enrolling'. Not modifying.`)
    process.exit(1)
  }

  // Make sure enroll won't be rejected by an elapsed sign-up window.
  if (t.enrollClosesAt && new Date(t.enrollClosesAt) <= new Date()) {
    console.log('\nSign-up window elapsed; extending +120m so dummies can be added…')
    await svc.adminExtendSignup(t.code, 120)
  }

  // Add dummy opponents with valid deck lists.
  const existingBots = new Set(
    snap.players.filter((p: any) => p.xHandle.startsWith(BOT_PREFIX)).map((p: any) => p.xHandle),
  )
  const tokens: { handle: string; token: string }[] = []
  let added = 0
  for (let i = 1; added < BOTS && i <= BOTS + 20; i++) {
    const h = `${BOT_PREFIX}${i}`
    if (existingBots.has(h)) continue
    try {
      const r = await svc.enroll(t.code, h, deckFor(i))
      tokens.push({ handle: h, token: r.playerToken })
      added++
      console.log(`  + added @${h}`)
    } catch (e) {
      console.log(`  ! enroll failed for @${h}: ${(e as Error).message}`)
    }
  }

  const approved = await svc.adminApproveAllPending(t.code)
  console.log(`  approved ${approved} pending player(s)`)

  // Re-fetch and verify everyone in the bracket has a deck before starting.
  snap = await svc.getSnapshotByCode(t.code)
  const approvedPlayers = snap.players.filter((p: any) => p.approvalStatus === 'approved')
  const missing = approvedPlayers.filter((p: any) => !p.hasDeckList)
  if (missing.length > 0) {
    console.log('\nThese approved players still need a deck list before round 1 can start:')
    for (const p of missing) console.log(`   @${p.xHandle}${p.xHandle.startsWith(BOT_PREFIX) ? '' : '  <-- YOU (submit your deck on the site)'}`)
    console.log('\nFix the above, then re-run with --go to start round 1.')
    printRoster(snap)
    process.exit(1)
  }

  if (approvedPlayers.length < 2) {
    console.error(`\nABORT: only ${approvedPlayers.length} approved player(s); need at least 2.`)
    process.exit(1)
  }

  await svc.adminStartBracket(t.code)
  snap = await svc.getSnapshotByCode(t.code)
  console.log(`\nStarted. Status: ${snap.tournament.status}`)
  printRound1(snap)

  if (tokens.length > 0) {
    fs.writeFileSync(root + '.preview-bot-tokens.json', JSON.stringify(tokens, null, 2))
    console.log('\nBot player tokens written to .preview-bot-tokens.json (gitignored, preview-only).')
  }
  console.log('\nDONE. Refresh your bracket on the preview site to report your match.')
  process.exit(0)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
