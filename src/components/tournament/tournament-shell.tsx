'use client'

import { BrandLockup } from '@/components/gallery/brand-lockup'
import { SiteNavMenu } from '@/components/gallery/site-nav-menu'
import { WalletHeaderWidget } from '@/components/wallet/wallet-header-widget'

// Page chrome shared by every tournament screen. The top bar is the exact
// same "logo · theme · hamburger" nav as every other page (rendered OUTSIDE
// the bonk-theme scope so it stays byte-for-byte uniform). The BONK hero +
// content below carry the sponsor theme. The wallet widget sits in the
// right cluster just before the shared menu.

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
  bonk = false,
}: {
  children: React.ReactNode
  /** Optional italic tagline + pill row shown under the header. */
  lede?: React.ReactNode
  /** Optional full-bleed hero banner rendered flush under the header. */
  hero?: React.ReactNode
  /** Optional extra controls in the header's right cluster. */
  right?: React.ReactNode
  /** Apply the BONK sponsorship theme (scoped palette, fonts, gradient). */
  bonk?: boolean
}) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text-primary)' }}>
      {/* Uniform site top bar - identical to every other page. Kept OUTSIDE
          the bonk-theme wrapper below so the BONK pill/mono button language
          never touches the nav: the theme toggle, hamburger, and dropdown
          render exactly as they do elsewhere. */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex items-center justify-between gap-3 px-4" style={{ maxWidth: 1800, height: 56 }}>
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <BrandLockup hideBetaMobile />
            {bonk && (
              // Partnership lockup: Card Wall  x  BONK (brand.bonkcoin.com
              // co-brand guidance). The "x" separator + BONK mark sit
              // immediately after the Card Wall lockup.
              <span className="bonk-lockup" aria-label="in partnership with BONK">
                <span className="bonk-lockup__x" aria-hidden>✕</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src="/bonk/web-img/master_logo.png"
                  alt="BONK"
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
            <SiteNavMenu />
          </div>
        </div>
      </header>

      {/* Everything below the nav carries the BONK sponsor theme. */}
      <div className={bonk ? 'bonk-theme' : undefined}>
        {hero}

        {lede && (
          <section aria-label="About this page" className="mx-auto max-w-3xl px-4 pt-8 pb-2 text-center">
            {lede}
          </section>
        )}

        <div className="mx-auto px-4 pt-6 pb-24" style={{ maxWidth: 1800 }}>{children}</div>
      </div>
    </div>
  )
}

export { ctrlBase as tournamentCtrl }
