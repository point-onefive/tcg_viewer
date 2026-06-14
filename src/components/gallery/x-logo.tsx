// The X (formerly Twitter) brand glyph. Use this anywhere we refer to
// the X platform instead of typing a literal letter "X". Inherits the
// current text color via `fill="currentColor"` and scales with the
// surrounding font when `size` is left at its `em` default, so it sits
// inline in a sentence like a glyph.

export function XLogo({
  size = '0.9em',
  className,
  style,
  title = 'X',
}: {
  size?: number | string
  className?: string
  style?: React.CSSProperties
  /** Accessible label; screen readers announce this in place of the glyph. */
  title?: string
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 1200 1227"
      fill="currentColor"
      role="img"
      aria-label={title}
      className={className}
      style={{ display: 'inline-block', verticalAlign: '-0.1em', ...style }}
    >
      <path d="M714.2 519.3 1160.9 0H1055L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9L515.5 750.2l327.3 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l305 436.2 47.5 67.9 395.9 566.3H892.4L569.2 687.8Z" />
    </svg>
  )
}
