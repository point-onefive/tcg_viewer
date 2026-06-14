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
 */
export function BrandLockup() {
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
        {/* Mascot chip - lighter panel that anchors him inside the mark */}
        <span
          className="inline-flex items-center justify-center"
          style={{
            background: 'var(--bg)',
            padding: '0 5px',
            border: '1px solid var(--text-primary)',
            borderRight: 'none',
            borderTopLeftRadius: 6,
            borderBottomLeftRadius: 6,
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
          className="inline-flex items-center whitespace-nowrap"
          style={{
            padding: '0 11px',
            fontFamily: 'var(--font-display)',
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
        className="inline-flex select-none"
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
