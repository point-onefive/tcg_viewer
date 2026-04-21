'use client'

/**
 * Minimal footer. Matches nav pill language: rounded-rect controls, 30px
 * height, same surface/border tokens. No invented links or handles, only
 * the real point_onefive X account for feedback.
 */
export function Footer() {
  const year = new Date().getFullYear()

  return (
    <footer
      className="relative w-full"
      style={{
        marginTop: 48,
        padding: '20px 16px 28px',
        borderTop: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg) 94%, transparent)',
      }}
    >
      <div
        className="mx-auto flex flex-col md:flex-row items-center justify-between gap-3"
        style={{ maxWidth: 1800 }}
      >
        {/* Left: wordmark + copyright */}
        <div
          className="flex items-center gap-2 text-[11px]"
          style={{ color: 'var(--text-secondary)', letterSpacing: '0.02em' }}
        >
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 700,
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              color: 'var(--text-primary)',
            }}
          >
            CARD WALL
          </span>
          <span style={{ opacity: 0.5 }}>·</span>
          <span>© {year}</span>
        </div>

        {/* Middle: attribution (real, no fake links) */}
        <div
          className="text-center text-[11px]"
          style={{ color: 'var(--text-muted)', maxWidth: 520 }}
        >
          Card names, images, and trademarks are the property of
          their respective owners. This site is an unofficial fan gallery.
        </div>

        {/* Right: X / feedback link */}
        <a
          href="https://x.com/point_onefive"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-3 text-[11px] font-medium transition-[background,color] duration-150"
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            height: 30,
            letterSpacing: '0.02em',
          }}
          aria-label="Feedback on X (@point_onefive)"
          title="Feedback, suggestions, enhancements"
        >
          {/* Official X logo glyph */}
          <svg
            width="11"
            height="11"
            viewBox="0 0 1200 1227"
            fill="currentColor"
            aria-hidden
          >
            <path d="M714.2 519.3 1160.9 0H1055L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9L515.5 750.2l327.3 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l305 436.2 47.5 67.9 395.9 566.3H892.4L569.2 687.8Z" />
          </svg>
          <span>Feedback</span>
        </a>
      </div>
    </footer>
  )
}
