/**
 * Smoke test: can headless Chromium load a PSA population page through
 * Cloudflare? If yes → option B is viable, build the full scraper.
 * If no → fall back to option C (ScraperAPI) immediately.
 *
 * Tests against the One Piece OP-01 (Romance Dawn) English pop page.
 *
 *   node scripts/market/_smoke-psa.mjs
 *
 * Writes a screenshot to /tmp/psa-smoke.png for visual verification.
 */

import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const TARGETS = [
  // OP-01 Romance Dawn English (231245 is the spec set id PSA uses)
  'https://www.psacard.com/pop/tcg-cards/2022/one-piece-card-game-romance-dawn-op-01-english/231245',
  // The search entry point — sometimes less aggressively challenged
  'https://www.psacard.com/pop/search?q=one+piece+OP-01',
]

const browser = await chromium.launch({
  headless: true,
  args: [
    '--disable-blink-features=AutomationControlled',
    '--no-sandbox',
  ],
})

const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
  locale: 'en-US',
  timezoneId: 'America/New_York',
  extraHTTPHeaders: {
    'Accept-Language': 'en-US,en;q=0.9',
  },
})

// Mask the most obvious automation tells. Cloudflare's bot fingerprinter
// checks navigator.webdriver, missing chrome.runtime, etc.
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
  Object.defineProperty(navigator, 'languages',  { get: () => ['en-US', 'en'] })
  // @ts-expect-error - chrome shim
  window.chrome = window.chrome || { runtime: {} }
})

for (const url of TARGETS) {
  console.log(`\n→ ${url}`)
  const page = await ctx.newPage()
  const start = Date.now()
  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    const status = resp?.status() ?? 0

    // Give Cloudflare's JS challenge a chance to complete. The hallmark of
    // a passed challenge is the page title flipping from "Just a moment…"
    // to the real page title.
    let waited = 0
    while (waited < 12_000) {
      const title = await page.title()
      if (!/just a moment|attention required|cloudflare/i.test(title)) break
      await page.waitForTimeout(800)
      waited += 800
    }

    const title  = await page.title()
    const url2   = page.url()
    const html   = await page.content()
    const opHits = (html.match(/OP01-\d+/g) ?? []).length
    const psaHits = (html.match(/PSA\s*1?[0-9]\b/g) ?? []).length
    const popHits = (html.toLowerCase().match(/population/g) ?? []).length

    console.log(`  http: ${status}   waited_for_cf: ${waited}ms   total: ${Date.now() - start}ms`)
    console.log(`  title: ${title.slice(0, 80)}`)
    console.log(`  final url: ${url2}`)
    console.log(`  html: ${html.length} chars   OP01-XXX hits: ${opHits}   "PSA N" hits: ${psaHits}   "population" hits: ${popHits}`)

    const ss = `/tmp/psa-smoke-${TARGETS.indexOf(url) + 1}.png`
    await page.screenshot({ path: ss, fullPage: false })
    console.log(`  screenshot: ${ss}`)

    // Sample a chunk of body to see what kind of content rendered.
    const bodyText = (await page.evaluate(() => document.body.innerText)).slice(0, 400)
    console.log(`  body (first 400): ${bodyText.replace(/\s+/g, ' ').slice(0, 400)}`)
  } catch (err) {
    console.log(`  ERROR: ${err.message}`)
  } finally {
    await page.close()
  }
}

await browser.close()
console.log('\ndone.')
