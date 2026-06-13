'use client'

import Link from 'next/link'
import { Trophy } from 'lucide-react'
import { ThemeToggle } from '@/components/gallery/theme-toggle'

// Page chrome shared by every tournament screen. Mirrors the tier-list /
// chart-race header: sticky blurred bar with the brand lockup + beta tag, a
// vertical rule, the page title (trophy + "Tournaments"), and a right-side
// control cluster. Keeps the tool visually native to the rest of the site.

const ctrlBase: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
}

function BrandLockup() {
  return (
    <span
      className="inline-flex items-stretch overflow-hidden"
      style={{ background: 'var(--text-primary)', color: 'var(--bg)', borderRadius: 6, height: 30 }}
    >
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
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/site-logo.png"
          alt=""
          aria-hidden
          width={15}
          height={22}
          style={{ width: 15, height: 22, flexShrink: 0, imageRendering: 'pixelated', display: 'block' }}
        />
      </span>
      <span
        className="inline-flex items-center font-display"
        style={{ padding: '0 9px 0 7px', fontSize: 13, fontWeight: 800, letterSpacing: '0.02em' }}
      >
        Card Wall
      </span>
    </span>
  )
}

export function TournamentShell({
  children,
  lede,
  right,
}: {
  children: React.ReactNode
  /** Optional italic tagline + pill row shown under the header. */
  lede?: React.ReactNode
  /** Optional extra controls in the header's right cluster. */
  right?: React.ReactNode
}) {
  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text-primary)' }}>
      <header
        className="sticky top-0 z-20 py-3"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Link href="/" className="group inline-flex" aria-label="The Card Wall - home">
                <span className="transition-transform group-hover:scale-[1.02]">
                  <BrandLockup />
                </span>
              </Link>
              <span
                aria-label="Beta release"
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
                  transform: 'translateY(1px)',
                }}
              >
                beta
              </span>
            </div>
            <div
              aria-hidden
              className="hidden sm:block"
              style={{ width: 1, height: 22, background: 'var(--text-muted)', opacity: 0.4, margin: '0 4px' }}
            />
            <Link href="/tournaments" className="flex items-center gap-2">
              <Trophy size={18} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
              <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">Tournaments</h1>
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {right}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {lede && (
        <section aria-label="About this page" className="mx-auto max-w-3xl px-4 pt-8 pb-2 text-center">
          {lede}
        </section>
      )}

      <div className="mx-auto max-w-6xl px-4 pt-6 pb-24">{children}</div>
    </div>
  )
}

export { ctrlBase as tournamentCtrl }
