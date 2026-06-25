/* eslint-disable no-console */
/**
 * PREVIEW ONLY. Report an arbitrary result as one of the dummy bots, for its
 * current active match. Lets you exercise specific flows from the opponent's
 * side: a matching report (auto-confirm), or a contradictory one (dispute).
 *
 * Run:
 *   npx tsx --conditions=react-server scripts/tournament/preview-bot-report.ts --bot rp_bot_1 --result loss
 */
import fs from 'node:fs'

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

const args = process.argv
const bot = args[args.indexOf('--bot') + 1]
const result = args[args.indexOf('--result') + 1] as 'win' | 'loss' | 'draw'
if (!bot || !['win', 'loss', 'draw'].includes(result)) {
  console.error('Usage: --bot <handle> --result <win|loss|draw>')
  process.exit(1)
}

interface Svc {
  getActiveSnapshot: () => Promise<any>
  reportResult: (code: string, matchId: string, token: string, r: 'win' | 'loss' | 'draw') => Promise<void>
}

async function main() {
  const tokens: { handle: string; token: string }[] = JSON.parse(
    fs.readFileSync(root + '.preview-bot-tokens.json', 'utf8'),
  )
  const token = tokens.find((t) => t.handle === bot)?.token
  if (!token) {
    console.error(`No token for @${bot} in .preview-bot-tokens.json`)
    process.exit(1)
  }

  const svc = (await import(root + 'src/lib/tournament/service.ts')) as unknown as Svc
  const snap = await svc.getActiveSnapshot()
  const code = snap.tournament.code
  const byId = new Map<string, any>(snap.players.map((p: any) => [p.id, p]))
  const me = snap.players.find((p: any) => p.xHandle === bot)
  if (!me) {
    console.error(`@${bot} is not in this tournament.`)
    process.exit(1)
  }
  const active = snap.rounds.find((r: any) => r.status === 'active')
  const match = snap.matches.find(
    (m: any) => m.roundId === active?.id && (m.player1Id === me.id || m.player2Id === me.id) && m.status !== 'bye',
  )
  if (!match) {
    console.error(`No active match for @${bot}.`)
    process.exit(1)
  }
  const opp = byId.get(match.player1Id === me.id ? match.player2Id : match.player1Id)
  await svc.reportResult(code, match.id, token, result)
  console.log(`@${bot} reported "${result}" for M${match.number} (vs @${opp?.xHandle}).`)

  const after = await svc.getActiveSnapshot()
  const m2 = after.matches.find((m: any) => m.id === match.id)
  console.log(`Match status now: ${m2?.status}` + (m2?.winnerId ? ` (winner: @${byId.get(m2.winnerId)?.xHandle})` : ''))
  process.exit(0)
}

main().catch((e) => {
  console.error('\nFATAL:', e?.stack || e?.message || e)
  process.exit(2)
})
