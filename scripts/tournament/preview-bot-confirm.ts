/* eslint-disable no-console */
/**
 * Companion to preview-roleplay.ts (PREVIEW ONLY). Acts as the dummy opponents
 * so you can watch the report flow resolve from the player's side:
 *
 *   - For your match (human vs bot): once YOU report, the bot submits the
 *     matching/complementary report so the match flips to "confirmed" on your
 *     screen. If you haven't reported yet, it waits (prints a note).
 *   - For bot-vs-bot matches: it resolves them (one bot wins) so the round can
 *     advance to the next once your match is in.
 *
 * Idempotent and safe to re-run after each round. Uses the real player-report
 * service path (reportResult) with the bot tokens saved by preview-roleplay.ts.
 *
 * Run:
 *   npx tsx --conditions=react-server scripts/tournament/preview-bot-confirm.ts
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
if (!PREVIEW_URL || !PREVIEW_KEY) throw new Error('Missing preview TOURNAMENT_SUPABASE_* in .env.preview.local')
if (PREVIEW_URL === prod.TOURNAMENT_SUPABASE_URL) throw new Error('ABORT: preview URL == prod URL. Refusing to run.')
process.env.TOURNAMENT_SUPABASE_URL = PREVIEW_URL
process.env.TOURNAMENT_SUPABASE_SECRET_KEY = PREVIEW_KEY
delete process.env.TOURNAMENT_ACTIVE_CODE

const BOT_PREFIX = 'rp_bot_'
type Reported = 'win' | 'loss' | 'draw'
const complement = (r: Reported): Reported => (r === 'win' ? 'loss' : r === 'loss' ? 'win' : 'draw')

interface Svc {
  getActiveSnapshot: () => Promise<any>
  reportResult: (code: string, matchId: string, playerToken: string, result: Reported) => Promise<void>
}

async function main() {
  const tokensPath = root + '.preview-bot-tokens.json'
  if (!fs.existsSync(tokensPath)) {
    console.error('No .preview-bot-tokens.json - run preview-roleplay.ts --go first.')
    process.exit(1)
  }
  const tokens: { handle: string; token: string }[] = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
  const tokenByHandle = new Map(tokens.map((t) => [t.handle, t.token]))

  const svc = (await import(root + 'src/lib/tournament/service.ts')) as unknown as Svc
  const snap = await svc.getActiveSnapshot()
  const code = snap.tournament.code
  const byId = new Map<string, any>(snap.players.map((p: any) => [p.id, p]))
  const active = snap.rounds.find((r: any) => r.status === 'active')
  if (!active) {
    console.log('No active round (tournament may be complete).')
    process.exit(0)
  }
  const matches = snap.matches
    .filter((m: any) => m.roundId === active.id)
    .sort((a: any, b: any) => a.number - b.number)

  console.log(`Round ${active.number} — resolving bot side(s) for ${code}`)
  for (const m of matches) {
    if (m.status === 'confirmed' || m.status === 'bye' || !m.player2Id) continue
    const p1 = byId.get(m.player1Id)
    const p2 = byId.get(m.player2Id)
    const p1Bot = p1?.xHandle?.startsWith(BOT_PREFIX)
    const p2Bot = p2?.xHandle?.startsWith(BOT_PREFIX)

    if (p1Bot && p2Bot) {
      // Bot vs bot: bot1 wins, bot2 loses.
      await svc.reportResult(code, m.id, tokenByHandle.get(p1.xHandle)!, 'win')
      await svc.reportResult(code, m.id, tokenByHandle.get(p2.xHandle)!, 'loss')
      console.log(`  M${m.number}: bot-vs-bot resolved (@${p1.xHandle} beats @${p2.xHandle})`)
      continue
    }

    // Human vs bot: confirm only if the human has reported.
    const humanReport = p1Bot ? m.player2Report : m.player1Report
    const botPlayer = p1Bot ? p1 : p2
    const humanPlayer = p1Bot ? p2 : p1
    if (!humanReport) {
      console.log(`  M${m.number}: waiting for @${humanPlayer.xHandle} to report (no bot action yet)`)
      continue
    }
    const botToken = tokenByHandle.get(botPlayer.xHandle)
    if (!botToken) {
      console.log(`  M${m.number}: no token for @${botPlayer.xHandle} (skip)`)
      continue
    }
    await svc.reportResult(code, m.id, botToken, complement(humanReport as Reported))
    console.log(`  M${m.number}: @${humanPlayer.xHandle} reported ${humanReport}; @${botPlayer.xHandle} confirmed → match confirmed`)
  }

  const after = await svc.getActiveSnapshot()
  console.log(`\nStatus: ${after.tournament.status}`)
  const a2 = after.rounds.find((r: any) => r.status === 'active')
  if (a2) console.log(`Active round is now ${a2.number}.`)
  process.exit(0)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
