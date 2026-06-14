#!/usr/bin/env node
/**
 * Stress-test sign-ups against the live tournament API.
 *
 * Usage:
 *   node scripts/tournament/simulate-signups.mjs --count=20
 *   BASE_URL=https://thecardwall.com node scripts/tournament/simulate-signups.mjs --count=50
 *
 * Creates fake X handles (sim_user_001 …). Clean them up from Supabase
 * admin panel or SQL after testing.
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000'
const countArg = process.argv.find((a) => a.startsWith('--count='))
const COUNT = countArg ? Number(countArg.split('=')[1]) : 10

async function main() {
  console.log(`Base: ${BASE}`)
  const activeRes = await fetch(`${BASE}/api/tournaments/active`)
  if (!activeRes.ok) {
    const err = await activeRes.json().catch(() => ({}))
    throw new Error(`No active tournament: ${err.error || activeRes.status}`)
  }
  const snap = await activeRes.json()
  const code = snap.tournament.code
  console.log(`Tournament: ${code} (${snap.tournament.name})`)
  console.log(`Simulating ${COUNT} sign-ups…\n`)

  let ok = 0
  let fail = 0
  for (let i = 1; i <= COUNT; i++) {
    const handle = `sim_user_${String(i).padStart(3, '0')}`
    const res = await fetch(`${BASE}/api/tournaments/${encodeURIComponent(code)}/enroll`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ xHandle: handle }),
    })
    if (res.ok) {
      ok++
      process.stdout.write('.')
    } else {
      fail++
      const err = await res.json().catch(() => ({}))
      console.log(`\n  fail ${handle}: ${err.error || res.status}`)
    }
    // Small delay to avoid hammering
    await new Promise((r) => setTimeout(r, 50))
  }
  console.log(`\n\nDone: ${ok} ok, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e.message || e)
  process.exit(1)
})
