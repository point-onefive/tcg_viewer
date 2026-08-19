'use client'

import { BrandLockup } from '@/components/gallery/brand-lockup'
import { SiteNavMenu } from '@/components/gallery/site-nav-menu'
import { WalletHeaderWidget } from '@/components/wallet/wallet-header-widget'
import type { TournamentTheme } from '@/lib/tournament/theme'
import { TournamentThemeProvider } from './theme-context'

// Page chrome shared by every tournament screen. The top bar is the exact
// same "logo · theme · hamburger" nav as every other page. When a `theme` is
// supplied the hero + content below carry that event's theme (scoped palette,
// fonts, gradients, and - for dark-only themes - a forced dark surface). The
// wallet widget sits in the right cluster just before the shared menu.

const ctrlBase: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
}

export function TournamentShell({
  children,
  lede,
  hero,
  right,
  theme,
}: {
  children: React.ReactNode
  /** Optional italic tagline + pill row shown under the header. */
  lede?: React.ReactNode
  /** Optional full-bleed hero banner rendered flush under the header. */
  hero?: React.ReactNode
  /** Optional extra controls in the header's right cluster. */
  right?: React.ReactNode
  /** Apply an event theme (scoped palette, fonts, gradients, co-brand). */
  theme?: TournamentTheme
}) {
  // Dark-only themes force the whole tournament surface (header + content) to
  // the dark palette regardless of the global toggle, by carrying
  // data-theme="dark" on the root. The [data-theme="dark"] token block cascades
  // to this subtree via inherited CSS custom properties.
  const forceDark = theme?.colorMode === 'dark-only'
  // Palette overrides -> inline CSS custom properties on the themed wrapper.
  const themeVars = theme?.cssVars as React.CSSProperties | undefined

  return (
    <div
      style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text-primary)' }}
      {...(forceDark ? { 'data-theme': 'dark' } : {})}
    >
      {/* Uniform site top bar - identical to every other page. */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex items-center justify-between gap-3 px-4" style={{ maxWidth: 1800, height: 56 }}>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandLockup />
            {theme?.navLockup && (
              // Co-brand partnership lockup: Card Wall  x  <partner>. The "x"
              // separator + partner mark sit immediately after the Card Wall
              // lockup (per brand co-brand guidance).
              <span className="bonk-lockup" aria-label={`in partnership with ${theme.navLockup.alt}`}>
                <span className="bonk-lockup__x" aria-hidden>✕</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={theme.navLockup.logo}
                  alt={theme.navLockup.alt}
                  width={32}
                  height={32}
                  className="block h-[26px] w-auto sm:h-8"
                />
              </span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {right}
            <WalletHeaderWidget />
            {/* Dark-only themes have no light variant, so hide the light/dark
                toggle entirely rather than offer a control that does nothing. */}
            <SiteNavMenu showTheme={!forceDark} />
          </div>
        </div>
      </header>

      {/* Everything below the nav carries the event theme. */}
      <div className={theme ? 'bonk-theme' : undefined} style={themeVars}>
        {theme ? (
          <TournamentThemeProvider theme={theme}>
            {hero}
            {lede && (
              <section aria-label="About this page" className="mx-auto max-w-3xl px-4 pt-8 pb-2 text-center">
                {lede}
              </section>
            )}
            <div className="mx-auto px-4 pt-6 pb-24" style={{ maxWidth: 1800 }}>{children}</div>
          </TournamentThemeProvider>
        ) : (
          <>
            {hero}
            {lede && (
              <section aria-label="About this page" className="mx-auto max-w-3xl px-4 pt-8 pb-2 text-center">
                {lede}
              </section>
            )}
            <div className="mx-auto px-4 pt-6 pb-24" style={{ maxWidth: 1800 }}>{children}</div>
          </>
        )}
      </div>
    </div>
  )
}

export { ctrlBase as tournamentCtrl }
