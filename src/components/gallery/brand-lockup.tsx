// Canonical Card Wall brand lockup: mascot chip + wordmark (with the
// italic lowercase "the" prefix) and the italic orange "beta" tag.
//
// This is the SINGLE source of truth for the logo. Every page header
// (gallery + tier-list + chart-race + tournaments) renders this exact
// component so the logo is byte-for-byte identical everywhere. The tool
// shells previously hand-rolled their own near-copies, which drifted
// (smaller weight, missing "the" prefix) - don't reintroduce that.

/**
 * The clickable logo (links home) plus the beta tag, wrapped together so
 * they read as one identity unit. Drop it straight into a header's left
 * cluster; it renders its own `flex items-center gap-2` wrapper.
 *
 * `mobileCompact` collapses the lockup to just the mascot chip below the
 * `sm` breakpoint (the wordmark + beta tag hide), so a cramped mobile
 * header (e.g. the tournaments bar) stays on a single row.
 */
export function BrandLockup({
  mobileCompact = false,
  hideBetaMobile = false,
}: {
  mobileCompact?: boolean
  /**
   * Hide just the "beta" tag below `sm` (keeping the full wordmark). Used
   * by the tournament bar, where the BONK co-brand lockup needs the extra
   * horizontal room on phones.
   */
  hideBetaMobile?: boolean
}) {
  // When compact, the wordmark + beta only appear at >= sm; below that the
  // mark is the mascot chip alone.
  const wordmarkCls = mobileCompact ? 'hidden sm:inline-flex' : 'inline-flex'
  const betaCls =
    mobileCompact || hideBetaMobile
      ? 'hidden select-none sm:inline-flex'
      : 'inline-flex select-none'
  return (
    <div className="flex items-center gap-2">
      <a
        href="/"
        className="group inline-flex items-stretch overflow-hidden"
        aria-label="The Card Wall - home"
        style={{
          background: 'var(--text-primary)',
          color: 'var(--bg)',
          borderRadius: 6,
          height: 30,
          transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
        }}
      >
        {/* Mascot chip - lighter panel that anchors him inside the mark.
            Left corners always round. Right corners round too in compact mode
            (mobile, wordmark hidden) so the border follows all four corners
            and there are no blank/un-outlined corners; at >= sm the wordmark
            reappears and the right side goes square again to butt flush
            against the dark wordmark panel. */}
        <span
          className={`inline-flex items-center justify-center rounded-l-md ${
            mobileCompact ? 'rounded-r-md sm:rounded-r-none' : ''
          }`}
          style={{
            background: 'var(--bg)',
            padding: '0 5px',
            // Full border so the chip reads as a closed box when the wordmark
            // is hidden (compact mode). In full mode the right edge is colored
            // var(--text-primary), which blends into the dark wordmark panel,
            // so no divider line shows.
            border: '1px solid var(--text-primary)',
          }}
        >
          {/* Explicit width - `width: auto` resolved to 0px in some
              browsers (flex item + attr/CSS sizing conflict), which
              rendered the chip as an empty sliver. 15x22 matches the
              source art's 556x834 aspect. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/images/site-logo.png"
            alt=""
            aria-hidden
            fetchPriority="high"
            loading="eager"
            decoding="async"
            width={15}
            height={22}
            style={{
              width: 15,
              height: 22,
              flexShrink: 0,
              imageRendering: 'pixelated',
              display: 'block',
              transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
            }}
            className="group-hover:scale-110 group-hover:-rotate-3"
          />
        </span>
        {/* Wordmark */}
        <span
          className={`${wordmarkCls} items-center whitespace-nowrap`}
          style={{
            padding: '0 11px',
            // Pin the wordmark to BONK Poppins (ExtraBold) so the bolder
            // "CARD WALL" look from the tournaments header is identical on
            // every page, regardless of the page's --font-display.
            fontFamily: "'BonkPoppins', var(--font-display)",
            fontWeight: 800,
            fontSize: 16,
            lineHeight: 1,
            letterSpacing: '-0.015em',
            textTransform: 'uppercase',
          }}
        >
          <span
            aria-hidden
            style={{
              fontSize: 11,
              fontWeight: 500,
              fontStyle: 'italic',
              letterSpacing: '0.02em',
              textTransform: 'lowercase',
              opacity: 0.65,
              marginRight: 5,
              lineHeight: 1,
            }}
          >
            the
          </span>
          <span>Card Wall</span>
        </span>
      </a>
      <span
        aria-label="Beta release"
        title="Beta release"
        className={betaCls}
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 10,
          fontStyle: 'italic',
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'lowercase',
          color: '#E85D2A',
          opacity: 0.78,
          lineHeight: 1,
          // Tiny optical lift so the italic descender sits on the
          // same baseline as the wordmark inside the lockup.
          transform: 'translateY(1px)',
        }}
      >
        beta
      </span>
    </div>
  )
}
