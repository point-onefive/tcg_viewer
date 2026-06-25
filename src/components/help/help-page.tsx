'use client'

import Image from 'next/image'
import Link from 'next/link'
import { HelpCircle, Medal } from 'lucide-react'
import { BrandLockup } from '@/components/gallery/brand-lockup'
import { SiteNavMenu } from '@/components/gallery/site-nav-menu'
import { XLogo } from '@/components/gallery/x-logo'

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
      {/* Uniform site top bar (brand · theme · hamburger), shared with
          every other page. The page title sits in the sub-bar below. */}
      <header
        className="sticky top-0 z-30 px-4"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-3" style={{ height: 56 }}>
          <BrandLockup />
          <SiteNavMenu topOffset={56} />
        </div>
      </header>

      <div className="mx-auto flex max-w-3xl items-center gap-2 px-4 pt-4">
        <HelpCircle size={20} strokeWidth={2.25} style={{ color: '#E85D2A', flexShrink: 0 }} aria-hidden />
        <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">
          How it works
        </h1>
      </div>

      <main className="mx-auto max-w-3xl px-4 pt-8">
        <Lede>
          A tiny manual for the Card Wall. Skim it, find one thing, leave. No
          videos, no signup, no popup tour ever again.
        </Lede>

        <HeroMosaic />

        <Contents />

        <Section title="Quick start">
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              Pick a TCG from the <Kbd>Collection</Kbd> picker - One Piece,
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
              Sort the wall with the <Kbd>Sort</Kbd> dropdown - by card cost,
              power / HP, rarity, or price. Sorting always runs within each set
              group.
            </li>
            <li>Click any card to open the lightbox and flip through alt arts.</li>
            <li>
              Pin favourites with the bookmark, queue them for the tier-list
              maker with the layers icon, or add them to a deck with the deck
              button.
            </li>
            <li>
              Build decks in the <Kbd>Deck Builder</Kbd>, rank cards in the{' '}
              <Kbd>Tier list maker</Kbd>, or jump into the live{' '}
              <Kbd>Tournament</Kbd> - all reachable from the menu.
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
                desc: 'Every TCG has its own curated vocabulary - Pokémon shows energy types and modern rarity tiers (Common through Special Illustration Rare); Lorcana shows ink colours and its rarity ladder; Digimon and Gundam show their native colour wheels; One Piece keeps Leader / Character / Event / Stage. Switching collection resets these so you don\u2019t carry over irrelevant ones.',
              },
              {
                term: 'Artist (Pokémon)',
                desc: 'Type any illustrator name into the Artist field to filter Pokémon cards by the person who drew them. Works as a typeahead - start typing and matching names surface immediately.',
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
                Pin a variant, queue it for the tier-list maker, or drop it into
                a deck - each action works per variant, so you can grab{' '}
                <em>just</em> the leader alt without its base art.
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
          <p className="mb-3 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The <Kbd>Sealed</Kbd> link (One Piece only) opens a dedicated
            booster-box dashboard. Same daily TCGPlayer feed as singles, but
            rolled up at the box level with a per-box price-history chart.
            New sets and their boxes are picked up automatically the first
            sync after Bandai publishes them, so the dashboard stays current
            without manual edits.
          </p>
          <BoosterBoxMock />
          <ul className="mt-4 space-y-2 text-sm leading-relaxed">
            <li>
              <Kbd>Search</Kbd> filters boxes by set code or name as you type
              (e.g. <Kbd>op05</Kbd> or <Kbd>awakening</Kbd>).
            </li>
            <li>
              <Kbd>Sort</Kbd> reorders by release date, biggest gainers /
              losers, price, or name - handy for spotting what&rsquo;s moving.
            </li>
            <li>
              Each tile shows the live market price, the percent move across
              the tracked window (green up / red down), and a sparkline. Click
              one to expand its full history chart.
            </li>
            <li>
              The <Kbd>Zoom</Kbd> scrubber tunes how many boxes fill each row,
              same as the card wall.
            </li>
          </ul>
        </Section>

        <Section title="Pin board">
          <p className="text-sm leading-relaxed">
            The bookmark icon on any card (or any variant inside the lightbox)
            pins it to your <Kbd>Board</Kbd>. The board lives in a side panel
            that slides in from the right. Pins are <em>per collection</em>, so
            your One Piece pins don&rsquo;t crowd your Pokémon board.
          </p>
        </Section>

        <Section title="Deck builder">
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The <Kbd>Deck Builder</Kbd> link in the menu opens a full-page
            builder. Keep as many decks as you like - they live in your browser,
            scoped per collection, with no account.
          </p>
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              Add cards straight from the lightbox: open any card and tap{' '}
              <Kbd>Deck</Kbd>. One tap drops it on your deck; with several decks
              you pick which one (or spin up a new one).
            </li>
            <li>
              Step copies up or down on each card. A deck holds at most{' '}
              <Kbd>4</Kbd> of a card (just <Kbd>1</Kbd> for a leader), and the
              leader always slots into the first position.
            </li>
            <li>
              Switch decks with the tabs, rename one inline, or{' '}
              <Kbd>Duplicate</Kbd> it as a starting point. The <Kbd>···</Kbd>{' '}
              menu holds the less-used actions (add a custom card, clear, delete).
            </li>
            <li>
              Missing a print? Add a <em>custom proxy</em> with your own name,
              cost, and a pasted or uploaded image - it saves with the deck.
            </li>
            <li>
              <Kbd>Copy list</Kbd> exports a sim-ready text list (one{' '}
              <Kbd>{'{qty}x{cardId}'}</Kbd> line per card, leader first) - paste
              straight into OPTCGSim or any sim that imports by card id.
            </li>
            <li>
              The same <Kbd>Zoom</Kbd> scrubber as the wall tunes card size, and{' '}
              <Kbd>Flatten</Kbd> spreads stacked copies out so you can see the
              whole deck at a glance.
            </li>
            <li>Everything runs locally. Nothing uploads.</li>
          </ul>
          <DeckBuilderMock />
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
              file.
            </li>
            <li>
              Everything runs locally. Nothing uploads.
            </li>
          </ul>
          <TierListMock />
        </Section>

        <Section title="Tournaments">
          <p className="mb-3 text-sm" style={{ color: 'var(--text-secondary)' }}>
            The <Kbd>Tournaments</Kbd> link (One Piece only) opens the current
            live Swiss / single-elim event. One tournament at a time,
            admin-run.
          </p>
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              <strong>Connect your wallet to sign up</strong> while the sign-up
              timer runs. It&rsquo;s free, never touches a blockchain, and just
              proves who you are. Sign-up, the waitlist, and your profile all use
              the same one-tap wallet sign-in.
            </li>
            <li>
              Your <strong><XLogo /> handle</strong> comes straight from your
              profile, so there&rsquo;s nothing to retype and nothing to spoof.
              Every handle links to the real profile in matchups. Haven&rsquo;t
              added one yet? The sign-up card prompts you to set it first.
            </li>
            <li>
              The admin verifies handles before the bracket posts.
            </li>
            <li>
              Follow the live bracket as rounds advance - the in-progress round
              gently pulses, and matchups show clickable @handles so you can DM
              your opponent on <XLogo />, play off-site, and report before the
              round timer runs out.
            </li>
            <li>
              Your wallet <strong>profile</strong> carries your trophy case
              (gold / silver / bronze finishes), any prizes you won, and your
              all-time record across every event.
            </li>
            <li>
              The <Kbd>All-time leaderboard</Kbd> ranks every player by wins
              across all events, so the regulars rise to the top.
            </li>
          </ul>
          <TournamentPodium />
        </Section>

        <Section title="Theme">
          <p className="text-sm leading-relaxed">
            The sun / moon toggle in the header flips dark and light mode. The
            choice persists per device.
          </p>
        </Section>

        <Section title="Privacy">
          <p className="text-sm leading-relaxed">
            Browsing needs no account and no tracking. Pins, the tier-list
            queue, theme, zoom, language, and flatten preference all live in
            your browser&rsquo;s local storage. Clearing site data clears all of
            it. The one opt-in exception is Tournaments, where connecting your
            wallet to sign up shares the <XLogo /> handle on your profile so
            opponents can find you.
          </p>
        </Section>

        <Section title="Feedback">
          <p className="text-sm leading-relaxed">
            Built by one person. Suggestions and DMs welcome - find me on <XLogo /> as{' '}
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
 * Section titles in document order. Single source of truth for the
 * table-of-contents nav: the list below renders the jump links and
 * each `<Section title=...>` below derives its anchor id from the
 * same string, so adding or renaming a section here (and on its
 * Section) keeps the two in lockstep with no manual id wiring.
 */
const HELP_SECTIONS = [
  'Quick start',
  'Filters',
  'The card wall',
  'Lightbox',
  'Pricing',
  'Booster boxes',
  'Pin board',
  'Deck builder',
  'Tier list maker',
  'Tournaments',
  'Theme',
  'Privacy',
  'Feedback',
] as const

/**
 * Compact "jump to" nav rendered just under the hero. A flex-wrapped
 * pill cluster rather than a sticky side rail: it reflows cleanly
 * from a single column on phones to a few rows on desktop with zero
 * layout math, and never competes with the centered prose column for
 * horizontal space. Smooth-scrolls to the target and updates the hash
 * without a hard jump; `scroll-mt-24` on each Section keeps the
 * landing heading clear of the sticky header.
 */
function Contents() {
  function handleJump(e: React.MouseEvent<HTMLAnchorElement>, id: string) {
    e.preventDefault()
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }

  return (
    <nav aria-label="On this page" className="mb-10">
      <div
        className="mb-3 font-display"
        style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: 'var(--text-muted)',
        }}
      >
        On this page
      </div>
      <ul className="flex flex-wrap gap-2">
        {HELP_SECTIONS.map((title) => (
          <li key={title}>
            <a
              href={`#${slugify(title)}`}
              onClick={(e) => handleJump(e, slugify(title))}
              className="help-toc-link inline-flex items-center text-xs font-medium"
              style={{
                color: 'var(--text-secondary)',
                background: 'var(--bg-surface)',
                border: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
                borderRadius: 999,
                padding: '5px 11px',
                lineHeight: 1,
              }}
            >
              {title}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  )
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Section wrapper with the brand-orange accent treatment on the
 * header rule. Sections are visually separated by spacing + the
 * coloured rule rather than heavy dividers, so the page reads as
 * one continuous document rather than a stack of cards.
 *
 * The id (derived from the title) is the jump target for the
 * table-of-contents nav; `scroll-mt-24` keeps the heading clear of
 * the sticky page header when you land on it.
 */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section id={slugify(title)} className="mb-10 scroll-mt-24">
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

// ---------------------------------------------------------------------------
// Deck-builder preview. Mirrors the real deck surface: a leader card slotted
// first behind a faint separator, then character cards with small quantity
// badges (and one shown as a stack to read as multiple copies), plus a subtle
// card-count in the corner the way the live container shows it. Decorative +
// `aria-hidden`; the bullet list above explains every control in words.
// ---------------------------------------------------------------------------

type MockDeckCard = { code: string; qty: number; stack?: boolean }

const DECK_MOCK_LEADER = 'OP01-002'
const DECK_MOCK_CARDS: MockDeckCard[] = [
  { code: 'OP01-016', qty: 4, stack: true },
  { code: 'OP01-025', qty: 4, stack: true },
  { code: 'OP01-013', qty: 2 },
  { code: 'OP01-022', qty: 3 },
  { code: 'OP01-047', qty: 1 },
]

function DeckMiniCard({ code, qty, stack }: MockDeckCard) {
  return (
    <div className="relative shrink-0" style={{ width: 44, aspectRatio: '5 / 7' }}>
      {stack && (
        <div
          className="absolute overflow-hidden"
          style={{
            inset: 0,
            transform: 'translate(3px, 3px)',
            borderRadius: 4,
            background: 'var(--bg)',
            border: '1px solid color-mix(in srgb, var(--text-primary) 22%, transparent)',
          }}
        />
      )}
      <div
        className="absolute overflow-hidden"
        style={{ inset: 0, borderRadius: 4, boxShadow: '0 1px 3px rgba(0,0,0,0.25)' }}
      >
        <Image src={`${CDN_BASE}${code}.png`} alt="" fill sizes="44px" style={{ objectFit: 'cover' }} />
      </div>
      <span
        className="absolute font-display"
        style={{
          right: stack ? -3 : 1,
          bottom: stack ? -3 : 1,
          fontSize: 9,
          fontWeight: 800,
          lineHeight: 1,
          padding: '2px 4px',
          borderRadius: 4,
          background: '#111',
          color: '#fff',
          border: '1px solid rgba(255,255,255,0.18)',
        }}
      >
        ×{qty}
      </span>
    </div>
  )
}

function DeckBuilderMock() {
  const total = DECK_MOCK_CARDS.reduce((s, c) => s + c.qty, 0)
  return (
    <div
      aria-hidden
      className="relative mt-4 overflow-hidden"
      style={{
        borderRadius: 8,
        border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
        background: 'var(--bg-surface)',
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ borderBottom: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)' }}
      >
        <span className="font-display" style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>
          My Red Deck
        </span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>···</span>
      </div>
      <div className="flex items-end gap-2 p-3">
        {/* Leader slotted first, set off by a faint separator. */}
        <div className="flex items-center" style={{ paddingRight: 8, borderRight: '1px solid color-mix(in srgb, #E85D2A 35%, transparent)' }}>
          <DeckMiniCard code={DECK_MOCK_LEADER} qty={1} />
        </div>
        <div className="flex flex-wrap items-end gap-2.5">
          {DECK_MOCK_CARDS.map((c) => (
            <DeckMiniCard key={c.code} {...c} />
          ))}
        </div>
      </div>
      <span
        className="absolute font-display"
        style={{
          right: 8,
          bottom: 6,
          fontSize: 10,
          fontWeight: 700,
          color: 'color-mix(in srgb, #E85D2A 85%, var(--text-muted))',
        }}
      >
        {total} / 50
      </span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Booster-box dashboard preview. Mirrors the real `.sb-tile` layout (box
// shot in a stage, then a foot row with live price + percent-move chip) so
// the reader recognises the Sealed page on sight. Box art comes straight
// from the same TCGPlayer CDN the live dashboard uses; the numbers are a
// representative snapshot, not a live feed. Decorative + `aria-hidden`
// because the bullet list below it explains every control in words.
// ---------------------------------------------------------------------------

const BOX_CDN = 'https://tcgplayer-cdn.tcgplayer.com/product'

type MockBox = { id: string; set: string; price: string; pct: number }

const BOOSTER_BOX_MOCK: MockBox[] = [
  { id: '532106', set: 'OP07', price: '$339.96', pct: 10.7 },
  { id: '563834', set: 'OP09', price: '$666.55', pct: 5.7 },
  { id: '689336', set: 'OP16', price: '$216.01', pct: -16.8 },
]

function BoosterBoxMock() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-3 gap-2 sm:gap-3"
    >
      {BOOSTER_BOX_MOCK.map((box) => {
        const up = box.pct >= 0
        const chip = up ? '#22c55e' : '#ef4444'
        return (
          <div
            key={box.id}
            className="overflow-hidden"
            style={{
              borderRadius: 10,
              border: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
              background: 'var(--bg-surface)',
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <div
              className="relative"
              style={{
                aspectRatio: '1 / 1',
                background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)',
              }}
            >
              <Image
                src={`${BOX_CDN}/${box.id}_in_1000x1000.jpg`}
                alt=""
                fill
                sizes="(max-width: 640px) 30vw, 200px"
                style={{ objectFit: 'contain', padding: 6 }}
              />
            </div>
            <div
              className="flex items-center justify-between gap-1 px-2 py-1.5"
              style={{
                borderTop: '1px solid color-mix(in srgb, var(--text-primary) 8%, transparent)',
              }}
            >
              <span
                className="font-display"
                style={{
                  fontSize: 'clamp(10px, 2.6vw, 13px)',
                  fontWeight: 700,
                  color: 'var(--text-primary)',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {box.price}
              </span>
              <span
                className="font-display shrink-0"
                style={{
                  fontSize: 'clamp(9px, 2.4vw, 12px)',
                  fontWeight: 800,
                  color: chip,
                }}
              >
                {up ? '+' : ''}
                {box.pct.toFixed(1)}%
              </span>
            </div>
            <div
              className="px-2 pb-1.5 font-display"
              style={{
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.08em',
                color: 'var(--text-secondary)',
              }}
            >
              {box.set}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Tournament podium. A wordless stand-in for the trophy case + leaderboard:
// gold / silver / bronze medals on a 1-2-3 podium, using the same medal
// palette the real profile badges use. Decorative + `aria-hidden`.
// ---------------------------------------------------------------------------

type PodiumStep = { place: string; color: string; height: number }

const PODIUM_STEPS: PodiumStep[] = [
  { place: '2nd', color: '#c4cad3', height: 44 },
  { place: '1st', color: '#f5b301', height: 64 },
  { place: '3rd', color: '#cd7f32', height: 32 },
]

function TournamentPodium() {
  return (
    <div
      aria-hidden
      className="mt-4 flex items-end justify-center gap-3"
      style={{
        borderRadius: 10,
        border: '1px solid color-mix(in srgb, var(--text-primary) 12%, transparent)',
        background: 'var(--bg-surface)',
        boxShadow: 'var(--shadow-card)',
        padding: '20px 16px 0',
      }}
    >
      {PODIUM_STEPS.map((step) => (
        <div key={step.place} className="flex flex-col items-center">
          <Medal size={26} style={{ color: step.color }} strokeWidth={2} />
          <div
            className="mt-2 flex w-[58px] items-start justify-center font-display sm:w-[72px]"
            style={{
              height: step.height,
              borderRadius: '6px 6px 0 0',
              background: `linear-gradient(to bottom, color-mix(in srgb, ${step.color} 34%, transparent), color-mix(in srgb, ${step.color} 10%, transparent))`,
              borderTop: `2px solid ${step.color}`,
              paddingTop: 6,
              fontSize: 12,
              fontWeight: 800,
              letterSpacing: '0.06em',
              color: 'var(--text-primary)',
            }}
          >
            {step.place}
          </div>
        </div>
      ))}
    </div>
  )
}
