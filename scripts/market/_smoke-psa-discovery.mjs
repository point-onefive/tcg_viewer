/**
 * Find PSA's real internal set IDs for One Piece TCG by visiting PSA's TCG
 * landing pages and looking for links to One Piece sets. PSA's URL format
 * for TCG pop pages is:
 *
 *   /pop/tcg-cards/<year>/<slug>/<numeric-spec-set-id>
 *
 * We need the numeric IDs. They aren't publicly listed in one place, but
 * the search results pages do contain them as hrefs.
 *
 * This script tries several discovery entry points and dumps any links it
 * finds that contain "one-piece" in the URL.
 */

import { chromium } from 'playwright'

const ENTRIES = [
  'https://www.psacard.com/pop/tcg-cards',
  'https://www.psacard.com/pop/',
  // Google-friendly: search for OP sets via google.com restricted to psacard.com
  'https://www.google.com/search?q=site%3Apsacard.com+%22OP-01%22+%22romance+dawn%22',
  'https://www.google.com/search?q=site%3Apsacard.com+pop+tcg-cards+%22one+piece%22',
]

const browser = await chromium.launch({ headless: true, args: ['--disable-blink-features=AutomationControlled', '--no-sandbox'] })
const ctx = await browser.newContext({
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  viewport: { width: 1440, height: 900 },
})
await ctx.addInitScript(() => {
  Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
})

for (const entry of ENTRIES) {
  console.log(`\n→ ${entry}`)
  const page = await ctx.newPage()
  try {
    await page.goto(entry, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    // wait for any CF challenge
    let waited = 0
    while (waited < 10_000) {
      const t = await page.title()
      if (!/just a moment|attention required/i.test(t)) break
      await page.waitForTimeout(500); waited += 500
    }
    const title = await page.title()
    console.log(`  title: ${title.slice(0, 80)}`)

    const links = await page.$$eval('a[href]', as =>
      as.map(a => ({ href: a.getAttribute('href'), text: (a.textContent ?? '').trim().slice(0, 80) }))
    )
    const opLinks = links.filter(l => l.href && /one.piece|op-?\d+/i.test(l.href))
    console.log(`  one-piece links found: ${opLinks.length}`)
    for (const l of opLinks.slice(0, 25)) {
      console.log(`    ${l.href}  -- ${l.text}`)
    }
  } catch (err) {
    console.log(`  ERR: ${err.message}`)
  } finally {
    await page.close()
  }
}

await browser.close()
