/**
 * Audits residual gap reports and fails loud (exit 1) when newly-released
 * sets are still missing alt arts after the TCGdex augmenter runs.
 *
 * Run after augment-pokemon-tcgdex.mjs in CI. The workflow uses the exit
 * code to decide whether to open a GitHub issue summarizing the gaps.
 *
 * "Recent" defaults to sets released within the last 180 days — that's
 * the window where alt arts realistically still matter and might be
 * actively requested. Older gaps are usually upstream bugs we can't fix.
 *
 * Usage:
 *   node scripts/audit-pokemon-gaps.mjs                # default 180 days
 *   node scripts/audit-pokemon-gaps.mjs --days=365     # wider window
 *   node scripts/audit-pokemon-gaps.mjs --strict       # fail on ANY gap
 */

import { readFileSync, existsSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const RESIDUAL = join(ROOT, 'data', 'pokemon-residual-gaps.json')

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...rest] = a.replace(/^--/, '').split('=')
    return [k, rest.length ? rest.join('=') : true]
  })
)
const DAYS = Number(args.days ?? 180)
const STRICT = !!args.strict

if (!existsSync(RESIDUAL)) {
  console.log('No residual gap file — pipeline likely did not run augmenter. Skipping audit.')
  process.exit(0)
}

const all = JSON.parse(readFileSync(RESIDUAL, 'utf8'))
const cutoff = new Date(Date.now() - DAYS * 86_400_000).toISOString().slice(0, 10)

const concerning = STRICT
  ? all
  : all.filter((g) => {
      const d = (g.releaseDate || '').replace(/\//g, '-')
      return d >= cutoff
    })

if (concerning.length === 0) {
  console.log(`✓ Audit clean (window=${DAYS}d, strict=${STRICT}).`)
  if (all.length) console.log(`  ${all.length} older sets have residual gaps but are outside the alert window.`)
  process.exit(0)
}

console.log(`✗ ${concerning.length} recently-released sets are still missing cards after TCGdex augmentation:\n`)
const lines = []
for (const g of concerning) {
  const flag = g.tcgdexMapped ? '' : ' [no TCGdex mapping]'
  const line = `  ${g.setId.padEnd(10)} ${(g.name || '').padEnd(35)} ${g.received}/${g.expected}  released ${g.releaseDate || '?'}${flag}`
  console.log(line)
  lines.push(line)
}

// Write an issue body for the GitHub Actions step to consume.
const body = [
  `**${concerning.length} Pokémon set(s) are missing cards after both pokemontcg.io and TCGdex.**`,
  '',
  'These are sets released within the last ' + DAYS + ' days where neither upstream has full coverage. They typically resolve themselves within a few weeks as the data sources catch up. If a set is stuck for 30+ days, manual sourcing may be needed.',
  '',
  '| Set | Name | Coverage | Released | Notes |',
  '|---|---|---|---|---|',
  ...concerning.map((g) =>
    `| \`${g.setId}\` | ${g.name || ''} | ${g.received}/${g.expected} | ${g.releaseDate || '?'} | ${g.tcgdexMapped ? '' : 'No TCGdex mapping — investigate'} |`
  ),
  '',
  '_This issue was opened automatically by `scripts/audit-pokemon-gaps.mjs`. It will be updated on the next refresh run; if all gaps close, the issue will be closed automatically._',
].join('\n')
writeFileSync(join(ROOT, 'data', 'pokemon-gap-issue-body.md'), body)

process.exit(1)
