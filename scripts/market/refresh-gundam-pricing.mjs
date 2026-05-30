#!/usr/bin/env node
/**
 * VPS cron helper: refresh Gundam pricing and push updated JSON back
 * to the repo so Vercel auto-deploys it.
 *
 * Designed to run on the VPS as a scheduled cron job, in the same
 * style as op_hub's pricing export → git commit → push flow for
 * One Piece.
 *
 * What it does:
 *   1. git pull origin main  (pick up any bundle / code changes)
 *   2. npm run gundam:pricing  (queries eBay, rewrites pricing-gundam.json)
 *   3. git add + commit + push  (triggers Vercel auto-deploy)
 *
 * Cron example (runs at 3:15 AM daily, after op_hub OP pricing at 3:00 AM):
 *   15 3 * * * cd /path/to/tcg_viewer && node scripts/market/refresh-gundam-pricing.mjs >> /var/log/gundam-pricing.log 2>&1
 *
 * Requirements on VPS:
 *   - node 18+ in PATH
 *   - EBAY_APP_ID, EBAY_CERT_ID, EBAY_MARKETPLACE in .env.local
 *   - git configured with push credentials (SSH key or HTTPS token)
 *   - `git config user.name` and `git config user.email` set
 *
 * Run manually:
 *   node scripts/market/refresh-gundam-pricing.mjs
 *   node scripts/market/refresh-gundam-pricing.mjs --dry-run   # skip git push
 */

import { execSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..', '..')
const DRY_RUN = process.argv.includes('--dry-run')

function run(cmd, { cwd = ROOT, label = cmd } = {}) {
  console.log(`\n▶ ${label}`)
  try {
    const out = execSync(cmd, { cwd, encoding: 'utf-8', stdio: 'pipe' })
    if (out.trim()) console.log(out.trim())
    return out.trim()
  } catch (err) {
    console.error(`✗ Failed: ${err.message}`)
    if (err.stdout) console.error(err.stdout)
    if (err.stderr) console.error(err.stderr)
    throw err
  }
}

const startedAt = new Date().toISOString()
console.log(`━━━ Gundam pricing refresh  ${startedAt} ━━━`)
if (DRY_RUN) console.log('  [DRY RUN — git push skipped]')

// 1. Pull latest code
run('git pull origin main', { label: 'git pull origin main' })

// 2. Run the pricing pipeline
run('node scripts/market/fetch-gundam-pricing.mjs', {
  label: 'fetch-gundam-pricing.mjs',
})

// 3. Check if either pricing or history file changed
const status = run(
  'git status --porcelain src/lib/pricing-gundam.json src/lib/price-history-gundam.json',
  { label: 'check for changes' },
)

if (!status) {
  console.log('\n✓ Gundam pricing files unchanged — nothing to commit.')
} else {
  const now = new Date().toISOString().slice(0, 16).replace('T', ' ')
  run(`git add src/lib/pricing-gundam.json src/lib/price-history-gundam.json`, { label: 'git add' })
  run(`git commit -m "chore(gundam): refresh pricing ${now}"`, { label: 'git commit' })

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] Would push now.')
  } else {
    run('git push origin main', { label: 'git push origin main' })
    console.log('\n✓ Pushed — Vercel will auto-deploy within ~60s.')
  }
}

console.log(`\n━━━ done  ${new Date().toISOString()} ━━━`)
