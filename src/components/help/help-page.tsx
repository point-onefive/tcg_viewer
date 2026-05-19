'use client'

import Link from 'next/link'
import { ArrowLeft, HelpCircle } from 'lucide-react'
import { ThemeToggle } from '@/components/gallery/theme-toggle'

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
              className="group inline-flex items-center gap-1.5 text-xs font-medium"
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

        <Section title="Quick start">
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              Pick a TCG from the <Kbd>Collection</Kbd> dropdown (top-left of the
              filter row).
            </li>
            <li>
              Narrow with <Kbd>Set</Kbd>, <Kbd>Card type</Kbd>, <Kbd>Color</Kbd>, or{' '}
              <Kbd>Alt art</Kbd>. They compose - turn on as many as you want.
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
            facet.
          </p>
          <DefList
            items={[
              {
                term: 'Collection',
                desc: 'Switches between TCGs (One Piece, Pokémon, Digimon, …). Filters reset on switch so you don\u2019t carry over irrelevant ones.',
              },
              {
                term: 'Set',
                desc: 'Narrows to a single set. The set header in the wall shows release date and card count.',
              },
              {
                term: 'Card type / Color / Alt art',
                desc: 'One Piece for now. Other TCGs will get their own facets as we sit down to pick the right values for each.',
              },
              {
                term: 'Search',
                desc: (
                  <>
                    Fuzzy match on card name and code. Try{' '}
                    <Kbd>OP01-001</Kbd> or just <Kbd>luffy</Kbd>.
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
              Set headers collapse with the chevron beside the set code. The{' '}
              <em>Collapse all</em> link hides every set at once.
            </li>
            <li>
              Active filters appear as removable chips above the first card. The
              chip strip is also where you find the <em>Clear all</em> shortcut.
            </li>
          </ul>
        </Section>

        <Section title="Lightbox">
          <ul className="space-y-2 text-sm leading-relaxed">
            <li>
              Click a card to open. Big art on the left, every alt print (variant)
              as thumbnails on the right.
            </li>
            <li>
              <Kbd>←</Kbd> / <Kbd>→</Kbd> flips through variants. <Kbd>Esc</Kbd>{' '}
              closes.
            </li>
            <li>
              Each variant can be pinned or queued for the tier-list maker
              individually - so you can pin <em>just</em> the leader alt without
              its base art.
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
              Give your chart a title at the top - it sits inside the chart
              frame so it travels with any screenshot you take.
            </li>
            <li>
              Everything runs locally. Nothing uploads.
            </li>
          </ul>
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
            theme, and zoom all live in your browser&rsquo;s local storage.
            Clearing site data clears all of it.
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
