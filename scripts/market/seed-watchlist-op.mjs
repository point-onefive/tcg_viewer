/**
 * Seed the One Piece watchlist with ~100 curated items.
 *
 * Categories seeded:
 *   - Graded singles: every SEC, every L for headline characters, all P
 *     (promos), and every Manga / alt-art variant on flagship cards.
 *   - Raw singles: a subset of the above flagged for raw market tracking
 *     where grading EV matters most (recent SECs especially).
 *   - Sealed boosters: every main OP series box plus EB-series.
 *   - Sealed starter decks: recent STs (ST-22+) where the secondary market
 *     for the included headline card has movement.
 *   - Sealed premium / Premium Bandai: PRB sets and anniversary boxes.
 *   - Promos / tournament kits: P-rarity headliners across released years.
 *
 * Idempotent: UPSERTs on watchlist by a deterministic external_key we put
 * into notes->'seed_key'. Safe to re-run after schema or curation changes.
 *
 * Usage:
 *   node scripts/market/seed-watchlist-op.mjs           # apply
 *   node scripts/market/seed-watchlist-op.mjs --dry     # preview, no write
 */

import { config } from 'dotenv'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

config({ path: '.env.local' })

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..', '..')

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SECRET_KEY
if (!URL || !KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local')
  process.exit(1)
}

const DRY = process.argv.includes('--dry')
const supabase = createClient(URL, KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
})

// ─── load card catalog ─────────────────────────────────────────────────────

const cards = JSON.parse(
  readFileSync(resolve(ROOT, 'src/lib/cards-one-piece.json'), 'utf-8')
)
console.log(`loaded ${cards.length} one-piece cards from generated bundle`)

// ─── character canonicalization ───────────────────────────────────────────
// The display names use full forms ("Monkey D. Luffy"); we collapse them to
// a single canonical character token used for indexing.

const CHAR_RULES = [
  [/monkey d\.? luffy|gum-gum|gear (second|third|fourth|fifth)/i, 'Luffy'],
  [/roronoa zoro|^zoro/i,                  'Zoro'],
  [/sanji|vinsmoke sanji/i,                'Sanji'],
  [/^nami/i,                               'Nami'],
  [/trafalgar (d\.? )?law/i,               'Law'],
  [/portgas d\.? ace|^ace/i,               'Ace'],
  [/^shanks|red hair/i,                    'Shanks'],
  [/yamato/i,                              'Yamato'],
  [/^jinbe/i,                              'Jinbe'],
  [/chopper|tony tony/i,                   'Chopper'],
  [/nico robin|^robin/i,                   'Robin'],
  [/usopp|sniper king/i,                   'Usopp'],
  [/franky|cutty flam/i,                   'Franky'],
  [/brook/i,                               'Brook'],
  [/jewelry bonney|bonney/i,               'Bonney'],
  [/charlotte katakuri|^katakuri/i,        'Katakuri'],
  [/charlotte (linlin|big mom)|big mom/i,  'Big Mom'],
  [/edward newgate|^whitebeard/i,          'Whitebeard'],
  [/kaido|king of beasts/i,                'Kaido'],
  [/donquixote doflamingo|doflamingo/i,    'Doflamingo'],
  [/marshall d\.? teach|blackbeard/i,      'Blackbeard'],
  [/marco|phoenix/i,                       'Marco'],
  [/boa hancock|^hancock/i,                'Hancock'],
  [/silvers rayleigh|rayleigh/i,           'Rayleigh'],
  [/gol d\.? roger|^roger/i,               'Roger'],
  [/portgas d\.? rouge|rouge/i,            'Rouge'],
  [/uta/i,                                 'Uta'],
  [/sabo/i,                                'Sabo'],
  [/^crocodile/i,                          'Crocodile'],
  [/^buggy/i,                              'Buggy'],
  [/^mihawk|dracule mihawk/i,              'Mihawk'],
  [/kouzuki oden|^oden/i,                  'Oden'],
  [/kouzuki momonosuke|momonosuke/i,       'Momonosuke'],
  [/^perona/i,                             'Perona'],
  [/koby/i,                                'Koby'],
]

function characterFor(name) {
  if (!name) return null
  for (const [re, canonical] of CHAR_RULES) {
    if (re.test(name)) return canonical
  }
  return null
}

const HEADLINE_CHARS = new Set([
  'Luffy', 'Zoro', 'Sanji', 'Nami', 'Law', 'Ace', 'Shanks', 'Yamato',
  'Roger', 'Whitebeard', 'Kaido', 'Big Mom', 'Blackbeard', 'Mihawk',
  'Doflamingo', 'Katakuri', 'Bonney', 'Uta', 'Sabo', 'Rouge',
])

// ─── search-term builders ─────────────────────────────────────────────────

const DEFAULT_EXCLUDES = [
  'japanese', 'jp', '日本', 'asian', 'korean',
  'proxy', 'custom', 'fake', 'replica', 'metal', 'digital', 'sticker',
]

function searchTermsForGradedSingle(card, character) {
  const code = card.code || card.id
  const name = card.name
  const terms = new Set([
    `${code} PSA 10`,
    `${code} ${character || name} PSA 10`,
    `One Piece ${code} PSA 10`,
  ])
  if (character && character !== name) {
    terms.add(`${character} ${code} PSA 10`)
  }
  return Array.from(terms)
}

function searchTermsForRaw(card, character) {
  const code = card.code || card.id
  const name = card.name
  const terms = new Set([
    `${code}`,
    `${code} ${character || name}`,
    `One Piece ${code}`,
  ])
  return Array.from(terms)
}

// ─── card singles selection ──────────────────────────────────────────────
// We build the watchlist by picking from the canonical card catalog. Each
// card gets one row for graded (PSA 10) tracking; flagship cards also get
// a row for raw tracking so we can detect grading-EV opportunities.

const cardItems = []

for (const card of cards) {
  const character = characterFor(card.name)
  const isHeadlineChar = character && HEADLINE_CHARS.has(character)
  const hasManga = (card.variants ?? []).some(
    (v) => /manga/i.test(v.label || '')
  )
  const isPromo = card.rarity === 'P'
  const isLeader = card.rarity === 'L'
  const isSEC = card.rarity === 'SEC'
  const isSR = card.rarity === 'SR'

  // Inclusion rule. Tuned to land near PSA's 100-call/day budget.
  // We deliberately exclude the "any card with a manga variant" catch-all
  // because most flagship manga variants are already SR or higher and get
  // picked up by the other rules.
  const include =
    isSEC ||
    (isLeader && isHeadlineChar) ||
    (isSR && isHeadlineChar && hasManga) ||
    (isPromo && (isHeadlineChar || hasManga))

  if (!include) continue

  cardItems.push({
    seed_key: `card:graded:${card.id}`,
    collection: 'one-piece',
    kind: 'graded_single',
    card_id: card.id,
    variant_id: null,
    display_name: card.name,
    character,
    set_code: card.setCode,
    release_date: card.releaseDate || null,
    image_url: card.imageLarge ?? card.imageSmall ?? null,
    search_terms: searchTermsForGradedSingle(card, character),
    exclude_terms: DEFAULT_EXCLUDES,
    ebay_category: 183454, // Trading Card Single
    psa_spec_id: null,     // backfilled by PSA ingester after first lookup
    pricecharting_id: null,
    enabled: true,
    // Priority drives the PSA ingester's daily budget allocator. Higher
    // priority items get polled first; lower-priority items get polled
    // less often when we hit the 100-call/day cap.
    priority:
      isSEC ? 10 :
      isLeader ? 9 :
      (isSR && hasManga) ? 8 :
      isPromo ? 7 :
      6,
    notes: JSON.stringify({
      rarity: card.rarity,
      colors: card.colors,
      has_manga_variant: hasManga,
      is_headline_character: isHeadlineChar,
    }),
  })

  // Raw tracking for the cards where grading EV is genuinely interesting:
  // SECs (highest grading premium), Manga variants of headline chars.
  if (isSEC || (hasManga && isHeadlineChar)) {
    cardItems.push({
      seed_key: `card:raw:${card.id}`,
      collection: 'one-piece',
      kind: 'raw_single',
      card_id: card.id,
      variant_id: null,
      display_name: `${card.name} (raw)`,
      character,
      set_code: card.setCode,
      release_date: card.releaseDate || null,
      image_url: card.imageLarge ?? card.imageSmall ?? null,
      search_terms: searchTermsForRaw(card, character),
      exclude_terms: [...DEFAULT_EXCLUDES, 'psa', 'cgc', 'bgs', 'graded', 'slab', 'slabbed'],
      ebay_category: 183454,
      psa_spec_id: null,
      pricecharting_id: null,
      enabled: true,
      priority: isSEC ? 8 : 7,
      notes: JSON.stringify({
        rarity: card.rarity,
        colors: card.colors,
        track_purpose: 'grading_ev',
      }),
    })
  }
}

console.log(`generated ${cardItems.length} card-derived items`)

// ─── hand-curated sealed product ─────────────────────────────────────────
// These do not live in cards-one-piece.json. We seed them manually here.
// search_terms target the most common eBay listing patterns for English
// product. quantity / chase relationships go into sealed_contents after
// inserts, keyed by seed_key.

const SEALED_ITEMS = [
  // Main boosters - flagship sets
  { code: 'OP-15', name: 'Premium Booster (OP-15)',  date: '2025-09-12', kind: 'sealed_booster' },
  { code: 'OP-14', name: 'Booster Box (OP-14)',      date: '2025-06-13', kind: 'sealed_booster' },
  { code: 'OP-13', name: 'Booster Box (OP-13)',      date: '2025-03-21', kind: 'sealed_booster' },
  { code: 'OP-12', name: 'Booster Box (OP-12)',      date: '2024-12-13', kind: 'sealed_booster' },
  { code: 'OP-11', name: 'Booster Box (OP-11)',      date: '2024-09-13', kind: 'sealed_booster' },
  { code: 'OP-10', name: 'Booster Box (OP-10)',      date: '2024-07-26', kind: 'sealed_booster' },
  { code: 'OP-09', name: 'Booster Box (OP-09)',      date: '2024-04-26', kind: 'sealed_booster' },
  { code: 'OP-08', name: 'Booster Box (OP-08)',      date: '2024-03-08', kind: 'sealed_booster' },
  { code: 'OP-07', name: 'Booster Box (OP-07)',      date: '2024-01-26', kind: 'sealed_booster' },
  { code: 'OP-06', name: 'Booster Box (OP-06)',      date: '2023-11-24', kind: 'sealed_booster' },
  // Extra boosters
  { code: 'EB-04', name: 'Extra Booster (EB-04)',    date: '2025-10-31', kind: 'sealed_booster' },
  { code: 'EB-03', name: 'Extra Booster (EB-03)',    date: '2025-05-30', kind: 'sealed_booster' },
  { code: 'EB-02', name: 'Extra Booster (EB-02)',    date: '2025-01-31', kind: 'sealed_booster' },
  { code: 'EB-01', name: 'Memorial Collection (EB-01)', date: '2024-05-31', kind: 'sealed_booster' },
  // Recent starter decks
  { code: 'ST-29', name: 'Starter Deck (ST-29)',     date: '2025-12-19', kind: 'sealed_starter' },
  { code: 'ST-28', name: 'Starter Deck (ST-28)',     date: '2025-08-29', kind: 'sealed_starter' },
  { code: 'ST-27', name: 'Starter Deck (ST-27)',     date: '2025-04-25', kind: 'sealed_starter' },
  { code: 'ST-26', name: 'Starter Deck (ST-26)',     date: '2024-12-19', kind: 'sealed_starter' },
  { code: 'ST-25', name: 'Starter Deck (ST-25)',     date: '2024-09-27', kind: 'sealed_starter' },
  { code: 'ST-22', name: 'Starter Deck (ST-22)',     date: '2024-03-28', kind: 'sealed_starter' },
  // Premium Bandai sets - the high-value sealed product the user flagged
  { code: 'PRB-02', name: 'Premium Set (PRB-02)',    date: '2025-08-15', kind: 'sealed_premium' },
  { code: 'PRB-01', name: 'Premium Set (PRB-01)',    date: '2024-11-15', kind: 'sealed_premium' },
  // Anniversary / event sealed
  { code: 'ONE PIECE CARD GAME 1ST ANNIVERSARY SET', name: '1st Anniversary Set', date: '2023-07-08', kind: 'sealed_premium' },
  { code: 'ONE PIECE CARD GAME 2ND ANNIVERSARY SET', name: '2nd Anniversary Set', date: '2024-07-26', kind: 'sealed_premium' },
  { code: 'ONE PIECE CARD GAME 3RD ANNIVERSARY SET', name: '3rd Anniversary Set', date: '2025-07-25', kind: 'sealed_premium' },
  // Tournament / promo distributions
  { code: 'CHAMPIONSHIP SET 2024',  name: 'Championship Set 2024',  date: '2024-09-01', kind: 'tournament_kit' },
  { code: 'CHAMPIONSHIP SET 2025',  name: 'Championship Set 2025',  date: '2025-09-01', kind: 'tournament_kit' },
]

const sealedItems = SEALED_ITEMS.map((s) => ({
  seed_key: `sealed:${s.code}`,
  collection: 'one-piece',
  kind: s.kind,
  card_id: null,
  variant_id: null,
  display_name: s.name,
  character: null,
  set_code: s.code.startsWith('OP-') || s.code.startsWith('EB-') || s.code.startsWith('ST-') || s.code.startsWith('PRB-')
    ? s.code
    : null,
  release_date: s.date,
  image_url: null,
  search_terms: [
    `One Piece ${s.code} Booster Box`,
    `One Piece ${s.code} Box`,
    `One Piece ${s.code} English`,
    `One Piece ${s.name} English`,
  ],
  exclude_terms: [...DEFAULT_EXCLUDES, 'single', 'singles', 'card only', 'opened'],
  ebay_category: 183455, // TCG Sealed Booster Packs (close enough; refine post-launch)
  psa_spec_id: null,
  pricecharting_id: null,
  enabled: true,
  priority: s.kind === 'sealed_premium' || s.kind === 'tournament_kit' ? 8 : 6,
  notes: JSON.stringify({ product_code: s.code, hand_curated: true }),
}))

console.log(`generated ${sealedItems.length} sealed-product items`)

// ─── final list, idempotent insert ───────────────────────────────────────

const all = [...cardItems, ...sealedItems]
console.log('')
console.log(`TOTAL watchlist seed: ${all.length} items`)
console.log('  by kind:')
const byKind = {}
for (const i of all) byKind[i.kind] = (byKind[i.kind] || 0) + 1
for (const [k, v] of Object.entries(byKind).sort()) console.log(`    ${k.padEnd(20)} ${v}`)

if (DRY) {
  console.log('')
  console.log('--dry: not writing. Sample row:')
  console.log(JSON.stringify(all[0], null, 2))
  process.exit(0)
}

console.log('')
console.log('upserting to watchlist…')

// Strategy: dedupe by inserting where notes->>seed_key does not already exist.
// We do this in batches of 100 for sanity, fetching existing seed_keys first.
const { data: existing, error: fetchErr } = await supabase
  .from('watchlist')
  .select('id, notes')

if (fetchErr) {
  console.error('failed to fetch existing watchlist:', fetchErr.message)
  console.error('(is the schema applied? run: node scripts/verify-schema.mjs)')
  process.exit(1)
}

const existingSeedKeys = new Set(
  (existing ?? [])
    .map((r) => {
      try { return JSON.parse(r.notes || '{}').seed_key } catch { return null }
    })
    .filter(Boolean)
)

const toInsert = []
for (const item of all) {
  if (existingSeedKeys.has(item.seed_key)) continue
  const { seed_key, ...row } = item
  const notes = JSON.parse(item.notes || '{}')
  notes.seed_key = seed_key
  toInsert.push({ ...row, notes: JSON.stringify(notes) })
}

console.log(`  ${existingSeedKeys.size} already in watchlist, ${toInsert.length} new to insert`)

if (toInsert.length === 0) {
  console.log('  nothing to do. watchlist is already seeded.')
  process.exit(0)
}

const BATCH = 100
let inserted = 0
for (let i = 0; i < toInsert.length; i += BATCH) {
  const batch = toInsert.slice(i, i + BATCH)
  const { error } = await supabase.from('watchlist').insert(batch)
  if (error) {
    console.error(`  batch ${i}-${i + batch.length} failed:`, error.message)
    process.exit(1)
  }
  inserted += batch.length
  console.log(`  inserted ${inserted}/${toInsert.length}`)
}

console.log('')
console.log(`done. watchlist seeded with ${inserted} new items.`)
