'use client'

import Image from 'next/image'
import Link from 'next/link'
import { ArrowLeft, HelpCircle } from 'lucide-react'
import { ThemeToggle } from '@/components/gallery/theme-toggle'

// All in-page illustrative card art is served from the same R2 CDN
// the main gallery uses, so cards are CDN-cached + WebP-optimized by
// Next's image pipeline the same way the gallery tiles are. Pinned
// to this constant so a future migration only touches one line.
const CDN_BASE = 'https://pub-6d5072ccd26a467db70791436c203abb.r2.dev/cards/'

/**
 * Tiny in-app reference manual. Reads like a one-pager so you can
 * skim it in 60 seconds and leave. Replaces the old onboarding tour
 * (which had to be edited every time we changed the UI) with a
 * single document anyone - first-timer, returning user, or future
 * me - can land on from the help icon in the header.
 *
 * Authoring notes:
 *   - Keep each section to a few short bullets. The site has a lot
 *     of small features, not a few big ones, so density wins over
 *     prose.
 *   - Don't duplicate UI labels verbatim if the label might change.
 *     Use the *concept* ("the bookmark icon") rather than parsable
 *     copy that we'd have to keep in sync.
 *   - Use the same brand-orange accent (#E85D2A) the rest of the
 *     site reserves for "this is intentional and live".
 */
export function HelpPage() {
  return (
    <div
      className="relative min-h-screen pb-24"
      style={{
        background: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* Header mirrors the tier-list page's pattern: brand lockup,
          page title with its own icon, light utility cluster on the
          right. Keeps the brand identity consistent across all
          first-class pages without rebuilding the full filter chrome
          of the main gallery header. */}
      <header
        className="sticky top-0 z-20 px-4 py-3"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/"
              className="footer-btn group inline-flex items-center gap-1.5 text-xs font-medium"
              style={{
                color: 'var(--text-muted)',
                background: 'var(--bg-surface)',
                border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
                borderRadius: 6,
                height: 30,
                padding: '0 10px',
              }}
              aria-label="Back to The Card Wall"
            >
              <ArrowLeft size={14} aria-hidden />
              <span>Back to the wall</span>
            </Link>
            <div
              aria-hidden
              className="hidden sm:block"
              style={{ width: 1, height: 22, background: 'var(--text-muted)', opacity: 0.4 }}
            />
            <div className="flex items-center gap-2">
              <HelpCircle size={18} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
              <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">
                How it works
              </h1>
            </div>
          </div>
          <ThemeToggle />
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 pt-8">
        <Lede>
          A tiny manual for the Card Wall. Skim it, find one thing, leave. No
          videos, no signup, no popup tour ever again.
        </Lede>

        <HeroMosaic />

        <Section title="Quick start">
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              Pick a TCG from the <Kbd>Collection</Kbd> picker — One Piece,
              Pokémon, Lorcana, Digimon, Dragon Ball Super, and Gundam are all
              here.
            </li>
            <li>
              For One Piece, choose <Kbd>EN</Kbd> or <Kbd>JP</Kbd> to swap
              catalogues and artwork. Other collections are English-only.
            </li>
            <li>
              Narrow with <Kbd>Set</Kbd>, <Kbd>Card type</Kbd>, <Kbd>Rarity</Kbd>,{' '}
              <Kbd>Color</Kbd>, <Kbd>Alt art</Kbd>, or <Kbd>Flatten</Kbd>. They
              compose - turn on as many as you want.
            </li>
            <li>
              Sort the wall with the <Kbd>Sort</Kbd> dropdown — by card cost,
              power / HP, rarity, or price. Sorting always runs within each set
              group.
            </li>
            <li>Click any card to open the lightbox and flip through alt arts.</li>
            <li>
              Pin favourites with the bookmark, or queue them for the tier-list
              maker with the layers icon.
            </li>
          </ul>
        </Section>

        <Section title="Filters">
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The second header row holds every narrowing control. Combine freely;
            removing a chip in the strip above the first card clears just that
            facet. Search alone auto-expands every set so hits aren&rsquo;t buried
            under collapsed headers.
          </p>
          <DefList
            items={[
              {
                term: 'Collection',
                desc: 'Switches between TCGs (One Piece, Pokémon, Lorcana, Digimon, Dragon Ball Super, Gundam). Filters reset on switch so you don\u2019t carry over irrelevant ones.',
              },
              {
                term: 'Set',
                desc: 'Narrows to a single set. The set header in the wall shows release date and a tile count.',
              },
              {
                term: 'Card type / Rarity / Color',
                desc: 'Every TCG has its own curated vocabulary — Pokémon shows energy types and modern rarity tiers (Common through Special Illustration Rare); Lorcana shows ink colours and its rarity ladder; Digimon and Gundam show their native colour wheels; One Piece keeps Leader / Character / Event / Stage. Switching collection resets these so you don\u2019t carry over irrelevant ones.',
              },
              {
                term: 'Artist (Pokémon)',
                desc: 'Type any illustrator name into the Artist field to filter Pokémon cards by the person who drew them. Works as a typeahead — start typing and matching names surface immediately.',
              },
              {
                term: 'Alt art',
                desc: (
                  <>
                    When active, only cards that have at least one alternate
                    print are shown. The matching cards get a coloured ring on
                    the wall tile. With <Kbd>Flatten</Kbd> on, the same toggle
                    hides base prints and shows variant tiles only. Available for
                    One Piece, Digimon, Dragon Ball, and Gundam (Pokémon and
                    Lorcana ship parallels as separate cards, so no toggle there).
                  </>
                ),
              },
              {
                term: 'Flatten',
                desc: (
                  <>
                    Breaks every alt print out as its own wall tile instead of
                    tucking variants inside the lightbox only. Combine with{' '}
                    <Kbd>Alt art</Kbd> to browse promos and parallels as a mosaic.
                    Each variant tile gets a small print label (e.g.{' '}
                    <Kbd>p1</Kbd>).
                  </>
                ),
              },
              {
                term: 'Sort',
                desc: (
                  <>
                    Orders cards <em>within</em> each set group. Options vary by
                    collection: <Kbd>Cost ↓</Kbd> / <Kbd>Power ↓</Kbd> (or{' '}
                    <Kbd>HP ↓</Kbd> for Pokémon, <Kbd>Strength ↓</Kbd> for
                    Lorcana), <Kbd>Rarity ↓</Kbd>, and <Kbd>Price ↓</Kbd>. The
                    default follows the official set order.
                  </>
                ),
              },
              {
                term: 'Language',
                desc: (
                  <>
                    <em>One Piece only.</em> <Kbd>EN</Kbd> shows the English
                    catalogue (Bandai EN + Asia-EN). <Kbd>JP</Kbd> shows the
                    Japanese catalogue with the richest promo coverage. Other
                    collections are English-only.
                  </>
                ),
              },
              {
                term: 'Search',
                desc: (
                  <>
                    Substring match on name, code, set name, card text (effect /
                    trigger), types, attributes, artist, and localized names.
                    Try <Kbd>OP01-001</Kbd>, <Kbd>luffy</Kbd>, <Kbd>when attacking</Kbd>,
                    or an artist&rsquo;s name.
                  </>
                ),
              },
            ]}
          />
        </Section>

        <Section title="The card wall">
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              The <Kbd>Zoom</Kbd> slider on the right of the filter row runs
              from ~2 cards per row (big) to a stamp-album mosaic at ~30 per row
              (tiny). Default sits around 6.
            </li>
            <li>
              The <Kbd>Sort</Kbd> dropdown reorders cards within each set group
              by cost, power / HP, rarity, or price. Switch back to{' '}
              <Kbd>Default</Kbd> to restore the official set order.
            </li>
            <li>
              Set headers collapse with the chevron beside the set code. The{' '}
              <em>Collapse all</em> link hides every set at once. Collapse state
              is respected even while filters or search are active.
            </li>
            <li>
              In flattened mode the header counts <em>prints</em> (each alt tile)
              instead of unique cards.
            </li>
            <li>
              Active filters appear as removable chips above the first card. The
              chip strip is also where you find the <em>Clear all</em> shortcut.
            </li>
            <li>
              Cards with alternate prints show a subtle coloured ring around the
              tile. Click any to explore every variant in the lightbox.
            </li>
          </ul>
        </Section>

        <Section title="Lightbox">
          <div className="grid gap-6 sm:grid-cols-[1fr_auto] sm:items-center">
            <ul className="space-y-2 text-sm leading-relaxed">
              <li>
                Click a card to open. The active print fills the center; every
                other variant fans out around it.
              </li>
              <li>
                <Kbd>←</Kbd> / <Kbd>→</Kbd> steps through variants inside the
                card, or through wall tiles when <Kbd>Flatten</Kbd> is on.{' '}
                <Kbd>Esc</Kbd> closes.
              </li>
              <li>
                Each variant can be pinned or queued for the tier-list maker
                individually, so you can pin <em>just</em> the leader alt
                without its base art.
              </li>
              <li>
                Below the fan you&rsquo;ll find the set name, the navigation
                arrows, the illustrator credit (where available), and the live
                pricing strip.
              </li>
            </ul>
            <AltArtStack />
          </div>
        </Section>

        <Section title="Pricing">
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Cards in the lightbox for One Piece, Pokémon, and Lorcana show a
            live pricing strip. Prices refresh once a day from TCGPlayer
            market data and the daily snapshot is appended to a per-card
            history so the trend chart fills in as time goes on.
          </p>
          <DefList
            items={[
              {
                term: 'TCGPlayer market',
                desc: 'The active subtype (Foil / Normal / Holofoil) market price the way TCGPlayer publishes it, with NM listing count when available and a relative freshness stamp.',
              },
              {
                term: 'Trend',
                desc: 'Sparkline of recent daily market snapshots for the same card. Each daily sync adds one point. Brand-new cards show "Builds with each daily sync" until enough days have accumulated.',
              },
              {
                term: 'Phantom market',
                desc: 'When the listed market is far above any recent sale comp the headline price renders struck through with a small warning. Treat the number as aspirational, not actionable.',
              },
              {
                term: 'Low-confidence match',
                desc: (
                  <>
                    A small banner above the strip when we can&rsquo;t cleanly
                    pair the wall variant to a single TCGPlayer product (e.g.
                    promos with multiple printings of the same card code).
                    The price is still shown but treat it as a rough signal,
                    not the truth.
                  </>
                ),
              },
              {
                term: 'No graded matrix',
                desc: (
                  <>
                    PSA / BGS / CGC / SGC pricing was removed. The third-party
                    feed we relied on was too stale (often 30+ days behind on
                    chase cards) and excluded PSA Vault auctions, which is
                    where most modern PSA 10 sales now happen. Until we wire
                    in an eBay sold-listings source directly, only raw market
                    data is shown.
                  </>
                ),
              },
              {
                term: 'Errata cards',
                desc: (
                  <>
                    Cards with the <Kbd>Errata</Kbd> pill have two distinct
                    printings (pre-errata and post-errata) that trade as
                    separate markets. Listing data doesn&rsquo;t cleanly
                    separate them, so the price you see is a blended signal.
                    Click the pill for details and always verify the printing
                    before transacting.
                  </>
                ),
              },
            ]}
          />
        </Section>

        <Section title="Booster boxes">
          <p className="text-sm leading-relaxed">
            The <Kbd>Sealed</Kbd> link in the header opens a dedicated
            booster-box dashboard. Same daily TCGPlayer feed as singles, but
            rolled up at the box level with a per-box price history chart.
            New One Piece sets (and their booster boxes) are picked up
            automatically the first sync after Bandai publishes them, so the
            dashboard stays current without manual edits.
          </p>
        </Section>

        <Section title="Pin board">
          <p className="text-sm leading-relaxed">
            The bookmark icon on any card (or any variant inside the lightbox)
            pins it to your <Kbd>Board</Kbd>. The board lives in a side panel
            that slides in from the right. Pins are <em>per collection</em>, so
            your One Piece pins don&rsquo;t crowd your Pokémon board.
          </p>
        </Section>

        <Section title="Tier list maker">
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The <Kbd>Tiers</Kbd> link in the header opens a full-page S/A/B/C
            ranker.
          </p>
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              Add cards from the gallery via the layers icon on each tile, or
              upload / paste images directly on the tier-list page.
            </li>
            <li>
              Drag images between tiers, drag tier rows by their grip handle to
              reorder, rename or recolour any tier.
            </li>
            <li>
              Use <Kbd>Select</Kbd> in the pool to pick multiple cards at once,
              then assign the whole selection to any tier in one tap.
            </li>
            <li>
              Both the pool and the chart have independent <Kbd>Zoom</Kbd>{' '}
              scrubbers so you can browse a dense pool while keeping chart tiles
              large enough to read.
            </li>
            <li>
              Give your chart a title at the top - it sits inside the chart
              frame so it travels with any screenshot you take.
            </li>
            <li>
              <Kbd>Copy PNG</Kbd> copies the chart to your clipboard (paste
              straight into a tweet or DM). <Kbd>Save PNG</Kbd> downloads a
              file. <Kbd>Border: On</Kbd> wraps the chart in a rotating
              mascot-palette gradient ring before export.
            </li>
            <li>
              Everything runs locally. Nothing uploads.
            </li>
          </ul>
          <TierListMock />
        </Section>

        <Section title="Theme">
          <p className="text-sm leading-relaxed">
            The sun / moon toggle in the header flips dark and light mode. The
            choice persists per device.
          </p>
        </Section>

        <Section title="Privacy">
          <p className="text-sm leading-relaxed">
            No accounts, no signup, no tracking. Pins, the tier-list queue,
            theme, zoom, language, and flatten preference all live in your
            browser&rsquo;s local storage. Clearing site data clears all of it.
          </p>
        </Section>

        <Section title="Feedback">
          <p className="text-sm leading-relaxed">
            Built by one person. Suggestions and DMs welcome - find me on X as{' '}
            <a
              href="https://x.com/point_onefive"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-1 underline-offset-4 transition-opacity hover:opacity-80"
              style={{ color: '#E85D2A', fontWeight: 600 }}
            >
              @point_onefive
            </a>
            .
          </p>
        </Section>

        <p
          className="mt-12 text-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Missing something? <Link href="/" className="underline">Go back to the wall</Link> and click
          around - odds are it&rsquo;s right there.
        </p>
      </main>
    </div>
  )
}

/**
 * Oversized lede paragraph that sits between the page header and the
 * first section. Renders at display-font weight so it reads as the
 * opening hook of the document, not body copy.
 */
function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="mb-10"
      style={{
        fontFamily: 'var(--font-display)',
        fontSize: 18,
        lineHeight: 1.5,
        color: 'var(--text-secondary)',
        letterSpacing: '-0.005em',
      }}
    >
      {children}
    </p>
  )
}

/**
 * Section wrapper with the brand-orange accent treatment on the
 * header rule. Sections are visually separated by spacing + the
 * coloured rule rather than heavy dividers, so the page reads as
 * one continuous document rather than a stack of cards.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-10">
      <div className="mb-3 flex items-center gap-3">
        <h2
          className="font-display"
          style={{
            fontSize: 14,
            fontWeight: 800,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
          }}
        >
          {title}
        </h2>
        <div
          aria-hidden
          className="flex-1"
          style={{
            height: 1,
            background:
              'linear-gradient(to right, color-mix(in srgb, #E85D2A 50%, transparent), transparent)',
          }}
        />
      </div>
      {children}
    </section>
  )
}

/**
 * Definition list rendered as a 2-column grid on roomy viewports and
 * a stacked list on narrow ones. Better than a `<dl>` for our needs
 * because the term column is fixed-width visually, but the underlying
 * markup stays semantic enough for screen readers (each term/desc is
 * just adjacent block elements with the right ARIA roles).
 */
function DefList({ items }: { items: Array<{ term: string; desc: React.ReactNode }> }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-[140px_1fr]">
      {items.map((item) => (
        <div key={item.term} className="contents">
          <dt
            className="font-display"
            style={{
              fontWeight: 700,
              fontSize: 13,
              color: 'var(--text-primary)',
              lineHeight: 1.5,
            }}
          >
            {item.term}
          </dt>
          <dd
            style={{
              color: 'var(--text-secondary)',
              lineHeight: 1.55,
            }}
          >
            {item.desc}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * Inline pill for UI labels and short literal strings (search codes,
 * keyboard keys). Visually distinct from regular text so the reader's
 * eye lands on "what to click" without us bolding everything.
 */
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: '0.85em',
        padding: '1px 6px',
        borderRadius: 4,
        background: 'color-mix(in srgb, var(--text-primary) 8%, transparent)',
        border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
        color: 'var(--text-primary)',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Illustrative visuals. Each one renders real card art from the live R2 CDN
// so the help page shows what the user is about to see, not generic stock
// imagery. We pick One Piece OP01 cards because:
//
//   * The OP01 set is the entry point for most visitors (default collection).
//   * The cards are visually distinctive (Luffy / Zoro / Sanji / Nami have
//     immediate brand recognition even for non-One-Piece fans).
//   * OP01 alt arts are some of the best-looking pieces in the bundle, so
//     they double as "look how nice this art is" eye candy.
//
// All three components are decorative and use `alt=""` + `aria-hidden`
// because the surrounding prose already does the explaining. A screen
// reader gets the doc; the sighted user gets the doc + pretty pictures.
// ---------------------------------------------------------------------------

type HeroCard = { code: string; rotate: number; offsetY: number; z: number }

const HERO_MOSAIC_CARDS: HeroCard[] = [
  { code: 'OP01-001_p1', rotate: -7, offsetY: 6,  z: 1 },
  { code: 'OP01-003_p1', rotate: -3, offsetY: -4, z: 3 },
  { code: 'OP01-013_p2', rotate: 1,  offsetY: 2,  z: 5 },
  { code: 'OP01-016_p3', rotate: -1, offsetY: -2, z: 5 },
  { code: 'OP01-013_p4', rotate: 4,  offsetY: -4, z: 3 },
  { code: 'OP01-047_p4', rotate: 7,  offsetY: 6,  z: 1 },
]

/**
 * Fanned strip of six alt-art cards directly below the page lede.
 * Functions as a wordless tagline: "this is what you're about to
 * spend your evening clicking through". Cards slightly overlap with
 * alternating rotation so the strip reads as a hand of cards rather
 * than a stock product grid. The negative horizontal margin lets the
 * strip break out past the prose container on roomy viewports for
 * extra heroic feel; capped via overflow-hidden on the wrapper so
 * it never introduces a horizontal scrollbar on mobile.
 */
function HeroMosaic() {
  return (
    <div className="-mx-4 mb-10 overflow-hidden">
      <div
        aria-hidden
        className="flex items-center justify-center"
        style={{ gap: 'clamp(2px, 0.8vw, 8px)' }}
      >
        {HERO_MOSAIC_CARDS.map((c) => (
          <div
            key={c.code}
            className="relative shrink-0 overflow-hidden"
            style={{
              width: 'clamp(70px, 13vw, 118px)',
              aspectRatio: '5 / 7',
              borderRadius: 10,
              transform: `rotate(${c.rotate}deg) translateY(${c.offsetY}px)`,
              boxShadow:
                '0 10px 28px rgba(0,0,0,0.32), 0 0 0 1px color-mix(in srgb, var(--text-primary) 8%, transparent)',
              zIndex: c.z,
            }}
          >
            <Image
              src={`${CDN_BASE}${c.code}.png`}
              alt=""
              fill
              sizes="(max-width: 640px) 14vw, 118px"
              style={{ objectFit: 'cover' }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Two cards offset behind one another. Direct visual for the
 * "variants stack" concept the Lightbox section talks about - the
 * gallery uses the same pattern on cards that have alt arts, so the
 * shape is already familiar by the time the user reads about it.
 * Sized so it sits to the right of the bullet list at sm+ widths
 * and gets its own row below the list on phones.
 */
function AltArtStack() {
  return (
    <div
      aria-hidden
      className="relative mx-auto"
      style={{ width: 156, aspectRatio: '5 / 7' }}
    >
      {/* Back card peeks out so the reader can tell at a glance that
          there are two distinct prints here, not a single tilted
          card. */}
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: 10,
          transform: 'translate(10px, 8px) rotate(4deg)',
          boxShadow: '0 6px 18px rgba(0,0,0,0.25)',
        }}
      >
        <Image
          src={`${CDN_BASE}OP01-013_p1.png`}
          alt=""
          fill
          sizes="156px"
          style={{ objectFit: 'cover' }}
        />
      </div>
      <div
        className="absolute inset-0 overflow-hidden"
        style={{
          borderRadius: 10,
          boxShadow:
            '0 14px 36px rgba(0,0,0,0.35), 0 0 0 1px color-mix(in srgb, var(--text-primary) 10%, transparent)',
        }}
      >
        <Image
          src={`${CDN_BASE}OP01-013.png`}
          alt=""
          fill
          sizes="156px"
          style={{ objectFit: 'cover' }}
        />
      </div>
    </div>
  )
}

type MockTier = { label: string; color: string; cards: string[] }

const TIER_MOCK_ROWS: MockTier[] = [
  // Tier colors lifted from DEFAULT_TIERS in tier-list-maker.tsx so
  // the mock looks exactly like what the user gets if they land on
  // /tier-list and add nothing. Single-card S row is a deliberate
  // joke: of course Luffy is solo S tier.
  { label: 'S', color: '#ff5a5f', cards: ['OP01-003'] },
  { label: 'A', color: '#f6b352', cards: ['OP01-001', 'OP01-013_p2'] },
  { label: 'B', color: '#f6e58d', cards: ['OP01-016', 'OP01-022', 'OP01-002_p1'] },
]

/**
 * Compact, decorative tier-list visual. Mirrors the layout language
 * of the real tier-list maker (colored letter cell + thumb row) at
 * roughly half scale so it sits comfortably inside the help-page
 * prose column. Decorative only - this never animates, never accepts
 * input, and is `aria-hidden` because the surrounding bullet list
 * already explains every mechanic in plain text.
 */
function TierListMock() {
  return (
    <div
      aria-hidden
      className="mt-4 overflow-hidden"
      style={{
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
        background: 'var(--bg-surface)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      {TIER_MOCK_ROWS.map((row, idx) => (
        <div
          key={row.label}
          className="flex"
          style={{
            borderTop:
              idx === 0
                ? 'none'
                : '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)',
          }}
        >
          <div
            className="flex w-[46px] shrink-0 items-center justify-center font-display"
            style={{
              background: row.color,
              color: '#111',
              fontWeight: 900,
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            {row.label}
          </div>
          <div className="flex flex-wrap items-center gap-1.5 p-2">
            {row.cards.map((code) => (
              <div
                key={code}
                className="relative overflow-hidden"
                style={{
                  width: 38,
                  aspectRatio: '5 / 7',
                  borderRadius: 3,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                }}
              >
                <Image
                  src={`${CDN_BASE}${code}.png`}
                  alt=""
                  fill
                  sizes="38px"
                  style={{ objectFit: 'cover' }}
                />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
