/**
 * Targeted scraper for the 123 missing alt-art variants identified
 * by diff-limitless-vs-local.mjs.
 *
 * For each (cardId, variant) the diff flagged as missing, fetch the
 * Limitless card-detail page once to grab:
 *   - imageUrl (CDN webp)
 *   - subtitle (e.g. "Illustration Box Vol.1") for provenance
 *   - artist (for the Bandai-style "Illustrated by" line)
 *   - category (e.g. "Misc. Promos")
 *
 * Output: data/limitless/missing-variants-detailed.json
 *
 * Why minimal: the BASE card is already in our data/cards.json with
 * the full name / cost / power / effect / trigger / types / etc.
 * Each alt art print shares all of that with its base; the only
 * per-print fields are the image URL and the source product. We
 * therefore avoid re-parsing 123 full card pages and only extract
 * what we'll actually merge.
 */

import { writeFileSync, readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')
const MISSING_PATH = join(ROOT, 'data/limitless/missing-variants.json')
const OUT_PATH = join(ROOT, 'data/limitless/missing-variants-detailed.json')

const SITE = 'https://onepiece.limitlesstcg.com'
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
const THROTTLE_MS = 250

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function fetchHTML(url, attempt = 0) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'text/html' } })
    if (res.status === 404) return null
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    await sleep(THROTTLE_MS)
    return await res.text()
  } catch (e) {
    if (attempt >= 3) throw new Error(`${url}: ${e.message}`)
    await sleep(1000 * (attempt + 1))
    return fetchHTML(url, attempt + 1)
  }
}

function decodeHtml(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rsquo;|&#0*8217;/g, '\u2019')
    .replace(/&lsquo;|&#0*8216;/g, '\u2018')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
}

function parsePrint(html) {
  const img = html.match(/<div\s+class="card-image">\s*<img[^>]+src="([^"]+)"/i)
  const imageUrl = img?.[1] ?? null

  // Source pill: "Misc. Promos" with subtitle "Alternate Art"
  const pill = html.match(/card-prints-current">[\s\S]*?<span\s+class="text-lg">\s*([\s\S]*?)\s*<\/span>[\s\S]*?<span>\s*([\s\S]*?)\s*<\/span>/i)
  const category = pill?.[1] ? decodeHtml(pill[1].replace(/<[^>]+>/g, '')).trim() : null
  const subtitle = pill?.[2] ? decodeHtml(pill[2].replace(/<[^>]+>/g, '')).trim() : null

  // Notes line below the pill -- typically the retail product name
  // ("Illustration Box Vol.1", "Championship Pack 2024"). Most
  // useful provenance field for the alt-art surface in the lightbox.
  const notes = html.match(/card-prints-notes">\s*([\s\S]*?)\s*<\/div>/i)
  const productName = notes?.[1]
    ? decodeHtml(notes[1].replace(/<[^>]+>/g, '')).trim()
    : null

  const artist = html.match(/card-text-artist[\s\S]*?<a[^>]*>\s*([\s\S]*?)\s*<\/a>/i)
  const artistName = artist?.[1]
    ? decodeHtml(artist[1].replace(/<[^>]+>/g, '')).trim()
    : null

  return { imageUrl, category, subtitle, productName, artist: artistName }
}

async function main() {
  const missing = JSON.parse(readFileSync(MISSING_PATH, 'utf8'))
  const out = existsSync(OUT_PATH) ? JSON.parse(readFileSync(OUT_PATH, 'utf8')) : {}

  console.log(`Scraping ${missing.length} missing variants...`)
  let i = 0
  for (const m of missing) {
    i++
    const key = m.ourId
    if (out[key]?.imageUrl) {
      console.log(`  [${i}/${missing.length}] ${key} - cached`)
      continue
    }
    const url = `${SITE}/cards/${m.cardId}?v=${m.variant}`
    try {
      const html = await fetchHTML(url)
      if (!html) {
        out[key] = { ...m, error: '404' }
        console.log(`  [${i}/${missing.length}] ${key} - 404`)
      } else {
        const parsed = parsePrint(html)
        out[key] = { ...m, ...parsed }
        console.log(`  [${i}/${missing.length}] ${key} -> ${parsed.productName ?? parsed.category ?? '?'}`)
      }
    } catch (e) {
      out[key] = { ...m, error: e.message }
      console.log(`  [${i}/${missing.length}] ${key} - ERR ${e.message}`)
    }
    if (i % 20 === 0) writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))
  }
  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2))
  const withImages = Object.values(out).filter((v) => v.imageUrl).length
  const errors = Object.values(out).filter((v) => v.error).length
  console.log(`\nDone. ${withImages} with image, ${errors} errors.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
