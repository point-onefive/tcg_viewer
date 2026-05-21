#!/usr/bin/env node
/**
 * One-shot scan across every catalog source we know about to surface
 * net-new One Piece TCG print ids that aren't yet in our shipping
 * bundle (`src/lib/cards-one-piece.json`).
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployed bundle is the source of truth for what the gallery
 * actually renders. New cards drop weekly via tournament packs, store
 * championship participation packs, Premium Bandai limited boxes,
 * magazine inserts, anniversary serialized prints, etc. A single
 * fresh print can come from any of five+ different feeds (each with
 * different cadence + completeness), so manually polling them is the
 * kind of work that quietly rots.
 *
 * This orchestrator runs every fetcher we have in the right order,
 * snapshots what each source actually publishes today, and diffs that
 * against the deployed bundle. It writes nothing to the bundle itself
 * — that's intentional. Surface findings, let the operator decide
 * what to ingest. (We learned the hard way: an automated "always
 * merge new prints" pipeline drowns the bundle in mislabeled images
 * the first time a CDN renames a file.)
 *
 * SOURCES HIT
 * -----------
 *   bandai-cardlist  : /cardlist/ for EN + JP + asia-en + asia-tc + asia-tw
 *                      (5 official regional catalogs, static HTML)
 *   bandai-sc        : windoent JSON API for the .cn Vue SPA (Simplified
 *                      Chinese; mainland-only anniversary + serialized
 *                      prints typically appear here first)
 *   bandai-products  : /products/ pages for every region (Premium Bandai
 *                      boxes that never reach /cardlist/)
 *   limitless        : limitlesstcg.com category indexes (community
 *                      catalog covering tournament packs, championship
 *                      prizes, store-champ participation, magazine
 *                      inserts — the long tail Bandai doesn't catalog)
 *
 * USAGE
 * -----
 *   node scripts/scan-for-new-cards.mjs            # quick scan (~7min)
 *   node scripts/scan-for-new-cards.mjs --quick    # same as default
 *   node scripts/scan-for-new-cards.mjs --full     # also Limitless detail
 *                                                  # crawl (+~17min, only
 *                                                  # needed to pull full
 *                                                  # metadata for newly-
 *                                                  # surfaced prints)
 *   node scripts/scan-for-new-cards.mjs --skip-products --skip-limitless
 *                                                  # any combination of
 *                                                  # --skip-bandai,
 *                                                  # --skip-cn,
 *                                                  # --skip-products,
 *                                                  # --skip-limitless to
 *                                                  # narrow the run
 *
 * OUTPUTS
 * -------
 *   data/scan-report.json   machine-readable: per-source counts,
 *                           categorized lists of missing prints,
 *                           timestamp, run params
 *   data/scan-report.md     human-readable: same data as GitHub-flavored
 *                           markdown, paste into an issue / chat
 *   stdout                  concise summary table at the end of the run
 *
 * The script is idempotent and safe to interrupt: each fetcher writes
 * its own incremental files, and the final diff just reads what's on
 * disk. Re-running picks up where you left off.
 */

import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const BUNDLE_PATH = join(ROOT, 'src', 'lib', 'cards-one-piece.json')
const DATA_DIR = join(ROOT, 'data')
const BY_LANG_DIR = join(DATA_DIR, 'by-language')
const LIMITLESS_DIR = join(DATA_DIR, 'limitless')
const REPORT_JSON = join(DATA_DIR, 'scan-report.json')
const REPORT_MD = join(DATA_DIR, 'scan-report.md')

const args = new Set(process.argv.slice(2))
const FULL = args.has('--full')
const SKIP_BANDAI = args.has('--skip-bandai')
const SKIP_CN = args.has('--skip-cn')
const SKIP_PRODUCTS = args.has('--skip-products')
const SKIP_LIMITLESS = args.has('--skip-limitless')

/* --------------------------------------------------------------------- */
/* Local-bundle snapshot                                                 */
/* --------------------------------------------------------------------- */

/**
 * Walk the deployed bundle and collect every print id we already know
 * about, in two forms:
 *   - `canonical`   : the id field we emit (e.g. "OP01-016_p9_sc")
 *   - `aliases`     : every region-local id we have on file (the
 *                     `regionalIds` map values, e.g. JP's
 *                     "OP01-016_p2" for the EN "_p1" print). Source-
 *                     side ids match against this fuzzy set so we
 *                     don't flag a JP-labeled print as "missing" just
 *                     because its EN-side label is what we ship.
 *
 * We also build a `_p${N}` ↔ `_r${N}` equivalence (Bandai sometimes
 * reissues the same art under both suffixes for promo reprints).
 */
function loadLocalSnapshot() {
  const cards = JSON.parse(readFileSync(BUNDLE_PATH, 'utf8'))
  const canonical = new Set()
  const aliases = new Set()

  const addAliases = (id) => {
    if (!id) return
    aliases.add(id)
    const m = id.match(/^(.+)_([pr])(\d+)(.*)$/)
    if (m) {
      const [, base, , n, tail] = m
      aliases.add(`${base}_p${n}${tail}`)
      aliases.add(`${base}_r${n}${tail}`)
    }
  }

  for (const card of cards) {
    canonical.add(card.id)
    addAliases(card.id)
    if (card.regionalIds) {
      for (const v of Object.values(card.regionalIds)) addAliases(v)
    }
    if (card.variants) {
      for (const v of card.variants) {
        canonical.add(v.id)
        addAliases(v.id)
        if (v.regionalIds) {
          for (const vv of Object.values(v.regionalIds)) addAliases(vv)
        }
      }
    }
  }

  return { canonical, aliases, cardCount: cards.length }
}

const LOCAL = loadLocalSnapshot()

function isKnown(id) {
  if (!id) return true
  if (LOCAL.aliases.has(id)) return true
  // Also try the `_pN` form derived from any `?v=N` query (limitless),
  // since that's the most common rewrite.
  const m = id.match(/^(.+)_([pr])(\d+)$/)
  if (m) {
    const [, base, , n] = m
    if (LOCAL.aliases.has(`${base}_p${n}`)) return true
    if (LOCAL.aliases.has(`${base}_r${n}`)) return true
  }
  return false
}

/* --------------------------------------------------------------------- */
/* Subprocess runner                                                     */
/* --------------------------------------------------------------------- */

/**
 * Spawn a fetcher as a child process and stream its output through to
 * our stdout (prefixed so the operator can see what's running). We
 * never swallow errors — if a fetcher fails partway, the scan still
 * runs the remaining sources and reports the failure at the end.
 */
function runFetcher(label, scriptPath, scriptArgs = []) {
  return new Promise((resolve) => {
    const startedAt = Date.now()
    console.log(`\n────── ${label} ──────`)
    const child = spawn('node', [scriptPath, ...scriptArgs], { cwd: ROOT, stdio: 'inherit' })
    child.on('exit', (code) => {
      const elapsedMs = Date.now() - startedAt
      const ok = code === 0
      console.log(`────── ${label} ${ok ? 'OK' : `FAILED (exit ${code})`} (${(elapsedMs / 1000).toFixed(1)}s) ──────`)
      resolve({ ok, code, elapsedMs })
    })
    child.on('error', (err) => {
      console.error(`────── ${label} ERROR: ${err.message} ──────`)
      resolve({ ok: false, code: -1, elapsedMs: Date.now() - startedAt, error: err.message })
    })
  })
}

/* --------------------------------------------------------------------- */
/* Per-source diff helpers                                               */
/* --------------------------------------------------------------------- */

function readJsonSafe(path, fallback) {
  if (!existsSync(path)) return fallback
  try { return JSON.parse(readFileSync(path, 'utf8')) }
  catch (e) { console.warn(`  (could not parse ${path}: ${e.message})`); return fallback }
}

/**
 * Scan a per-language Bandai cardlist file and bucket each row as
 * either known or new. Returns a compact summary plus up to N
 * sample new ids.
 */
function diffBandaiLanguageFile(label, path) {
  const rows = readJsonSafe(path, [])
  const newOnes = []
  for (const r of rows) {
    if (!r?.id) continue
    if (!isKnown(r.id)) newOnes.push({ id: r.id, name: r.name ?? null, distribution: r.distribution ?? null })
  }
  return {
    source: label,
    path: path.replace(ROOT + '/', ''),
    rowsSeen: rows.length,
    knownToUs: rows.length - newOnes.length,
    newFound: newOnes.length,
    sample: newOnes.slice(0, 25),
    all: newOnes,
  }
}

/**
 * Limitless catalog uses `(cardId, variant)` tuples where variant=0
 * means the base print. Map each to our canonical form (`_p${N}` for
 * non-base) before diffing.
 */
function diffLimitlessCardUrls(path) {
  const urls = readJsonSafe(path, null)
  if (!urls?.byCardVariant) {
    return { source: 'limitless', path: path.replace(ROOT + '/', ''), rowsSeen: 0, knownToUs: 0, newFound: 0, sample: [], all: [] }
  }
  const entries = Object.values(urls.byCardVariant)
  const newOnes = []
  for (const e of entries) {
    const id = e.variant === 0 ? e.cardId : `${e.cardId}_p${e.variant}`
    if (!isKnown(id)) {
      newOnes.push({ id, name: null, distribution: e.firstSeenIn ?? null })
    }
  }
  // Bucket new prints by Limitless category for triage ("which kind of
  // missing print is this?" — championship prize vs. anniversary
  // box vs. magazine insert).
  const byCategory = {}
  for (const n of newOnes) {
    const cat = n.distribution || 'unknown'
    byCategory[cat] = (byCategory[cat] || 0) + 1
  }
  return {
    source: 'limitless',
    path: path.replace(ROOT + '/', ''),
    rowsSeen: entries.length,
    knownToUs: entries.length - newOnes.length,
    newFound: newOnes.length,
    byCategory,
    sample: newOnes.slice(0, 25),
    all: newOnes,
  }
}

/* --------------------------------------------------------------------- */
/* Report rendering                                                      */
/* --------------------------------------------------------------------- */

function renderSummary(sections, runMeta) {
  const lines = []
  lines.push('')
  lines.push('═'.repeat(64))
  lines.push(`  SCAN REPORT — ${runMeta.startedAt}`)
  lines.push(`  Mode: ${runMeta.mode}   Local bundle: ${LOCAL.cardCount} base cards, ${LOCAL.canonical.size} prints`)
  lines.push('═'.repeat(64))
  lines.push('')
  lines.push('  source                          rows   known   NEW')
  lines.push('  ───────────────────────────────────────────────────')
  let totalNew = 0
  for (const s of sections) {
    if (!s) continue
    totalNew += s.newFound
    lines.push(
      `  ${s.source.padEnd(30)} ${String(s.rowsSeen).padStart(5)}   ${String(s.knownToUs).padStart(5)}   ${String(s.newFound).padStart(4)}`,
    )
  }
  lines.push('  ───────────────────────────────────────────────────')
  lines.push(`  TOTAL NEW                                          ${String(totalNew).padStart(4)}`)
  lines.push('')

  for (const s of sections) {
    if (!s || s.newFound === 0) continue
    lines.push(`  ▸ ${s.source} — ${s.newFound} new prints`)
    if (s.byCategory) {
      const top = Object.entries(s.byCategory).sort((a, b) => b[1] - a[1]).slice(0, 8)
      for (const [cat, n] of top) lines.push(`      ${String(n).padStart(4)} × ${cat}`)
    }
    for (const item of s.sample.slice(0, 8)) {
      const tail = item.distribution ? ` — ${item.distribution}` : ''
      const name = item.name ? ` ${item.name}` : ''
      lines.push(`      ${item.id}${name}${tail}`)
    }
    if (s.newFound > 8) lines.push(`      … and ${s.newFound - 8} more (see ${REPORT_JSON.replace(ROOT + '/', '')})`)
    lines.push('')
  }

  if (totalNew === 0) {
    lines.push('  No new prints found across any source. Bundle is current.')
    lines.push('')
  } else {
    lines.push(`  Full report: ${REPORT_JSON.replace(ROOT + '/', '')}`)
    lines.push(`  Markdown:    ${REPORT_MD.replace(ROOT + '/', '')}`)
    lines.push('')
    lines.push('  Next step: review the lists above and decide which to ingest.')
    lines.push('  Ask the agent to "merge these new prints" with the ids you want.')
    lines.push('')
  }
  return lines.join('\n')
}

function renderMarkdown(sections, runMeta) {
  const out = []
  out.push(`# Scan report — ${runMeta.startedAt}`)
  out.push('')
  out.push(`- Mode: \`${runMeta.mode}\``)
  out.push(`- Local bundle: ${LOCAL.cardCount} base cards / ${LOCAL.canonical.size} prints`)
  out.push(`- Elapsed: ${(runMeta.elapsedMs / 1000).toFixed(1)}s`)
  out.push('')
  out.push('## Summary')
  out.push('')
  out.push('| Source | Rows seen | Known | **New** |')
  out.push('|---|---:|---:|---:|')
  let totalNew = 0
  for (const s of sections) {
    if (!s) continue
    totalNew += s.newFound
    out.push(`| ${s.source} | ${s.rowsSeen} | ${s.knownToUs} | **${s.newFound}** |`)
  }
  out.push(`| **Total new** |  |  | **${totalNew}** |`)
  out.push('')

  for (const s of sections) {
    if (!s || s.newFound === 0) continue
    out.push(`## ${s.source} — ${s.newFound} new`)
    out.push('')
    if (s.byCategory) {
      out.push('### Categories')
      out.push('')
      out.push('| Category | Count |')
      out.push('|---|---:|')
      for (const [cat, n] of Object.entries(s.byCategory).sort((a, b) => b[1] - a[1])) {
        out.push(`| ${cat} | ${n} |`)
      }
      out.push('')
    }
    out.push('### Prints')
    out.push('')
    out.push('| Print id | Name | Distribution |')
    out.push('|---|---|---|')
    for (const item of s.all.slice(0, 200)) {
      out.push(`| \`${item.id}\` | ${item.name ?? ''} | ${item.distribution ?? ''} |`)
    }
    if (s.all.length > 200) out.push(`| … and ${s.all.length - 200} more | | |`)
    out.push('')
  }
  return out.join('\n')
}

/* --------------------------------------------------------------------- */
/* Main                                                                  */
/* --------------------------------------------------------------------- */

async function main() {
  mkdirSync(DATA_DIR, { recursive: true })

  const runMeta = {
    startedAt: new Date().toISOString(),
    mode: FULL ? 'full' : 'quick',
    skipped: {
      bandai: SKIP_BANDAI,
      cn: SKIP_CN,
      products: SKIP_PRODUCTS,
      limitless: SKIP_LIMITLESS,
    },
    elapsedMs: 0,
  }
  const startedAt = Date.now()

  console.log(`\nScan starting (${runMeta.mode} mode)`)
  console.log(`Local bundle: ${LOCAL.cardCount} base cards / ${LOCAL.canonical.size} prints / ${LOCAL.aliases.size} aliases`)

  const fetcherResults = []

  if (!SKIP_BANDAI) {
    fetcherResults.push({
      label: 'bandai-cardlist',
      ...(await runFetcher('Bandai /cardlist/ (all regions)', 'scripts/fetch-card-data.mjs', ['--language=all'])),
    })
  }
  if (!SKIP_CN) {
    fetcherResults.push({
      label: 'bandai-sc',
      ...(await runFetcher('Bandai SC (windoent API)', 'scripts/fetch-bandai-cn.mjs')),
    })
  }
  if (!SKIP_PRODUCTS) {
    fetcherResults.push({
      label: 'bandai-products',
      ...(await runFetcher('Bandai /products/ (all regions)', 'scripts/fetch-bandai-products.mjs')),
    })
  }
  if (!SKIP_LIMITLESS) {
    // --crawl refreshes the category index + per-category card-id list
    // (~30s). --details on top adds per-card metadata fetches (~17min);
    // we only need that when the operator decides to actually ingest a
    // new print and wants full text.
    const limitlessArgs = FULL ? ['--all'] : ['--crawl']
    fetcherResults.push({
      label: 'limitless',
      ...(await runFetcher(`Limitless TCG (${FULL ? 'all' : 'crawl'})`, 'scripts/fetch-limitless-supplement.mjs', limitlessArgs)),
    })
  }

  /* ---- Diff every fresh fetch against the local bundle ---- */

  const sections = []

  if (!SKIP_BANDAI) {
    for (const lang of ['en', 'jp', 'asia-en', 'asia-tc', 'asia-tw']) {
      const path = join(BY_LANG_DIR, `${lang}.json`)
      if (!existsSync(path)) continue
      sections.push({ ...diffBandaiLanguageFile(`bandai-${lang}`, path) })
    }
  }
  if (!SKIP_CN) {
    const path = join(BY_LANG_DIR, 'cn.json')
    if (existsSync(path)) sections.push(diffBandaiLanguageFile('bandai-sc', path))
  }
  if (!SKIP_PRODUCTS) {
    for (const lang of ['en', 'jp', 'asia-en', 'asia-tc', 'asia-tw']) {
      const path = join(BY_LANG_DIR, `${lang}-products.json`)
      if (!existsSync(path)) continue
      sections.push(diffBandaiLanguageFile(`products-${lang}`, path))
    }
  }
  if (!SKIP_LIMITLESS) {
    const path = join(LIMITLESS_DIR, 'card-urls.json')
    if (existsSync(path)) sections.push(diffLimitlessCardUrls(path))
  }

  runMeta.elapsedMs = Date.now() - startedAt

  const report = {
    runMeta,
    localSnapshot: {
      cardCount: LOCAL.cardCount,
      printCount: LOCAL.canonical.size,
      aliasCount: LOCAL.aliases.size,
    },
    fetchers: fetcherResults,
    sections,
  }
  writeFileSync(REPORT_JSON, JSON.stringify(report, null, 2))
  writeFileSync(REPORT_MD, renderMarkdown(sections, runMeta))
  console.log(renderSummary(sections, runMeta))
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
