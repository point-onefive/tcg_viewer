// Generates a tiny One Piece "leaders" lookup (card id -> name + image) from
// the full src/lib/cards-one-piece.json bundle. Output is committed and used
// by the tournament service to reveal each player's Leader card (public during
// play, like the table) without redacting the rest of the deck list.
//
// Run: node scripts/generate-leaders-index.mjs
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const SRC = join(__dirname, '..', 'src', 'lib', 'cards-one-piece.json')
const OUT = join(__dirname, '..', 'src', 'lib', 'tournament', 'leaders-one-piece.json')

const cards = JSON.parse(await readFile(SRC, 'utf8'))
const index = {}
for (const c of cards) {
  if (c.cardType !== 'LEADER') continue
  const id = c.id || c.code
  if (!id || index[id]) continue
  index[id] = {
    name: c.name ?? id,
    image: c.imageSmall || c.imageLarge || null,
  }
}

const sorted = Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)))
await writeFile(OUT, JSON.stringify(sorted, null, 2) + '\n', 'utf8')
console.log(`Wrote ${Object.keys(sorted).length} leaders to ${OUT}`)
