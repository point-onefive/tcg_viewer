'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Coins, Trophy, ArrowRight, Award, X } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { apiActiveStatus, apiPaidGames } from '@/lib/tournament/client'
import { getTournamentTheme, HOUSE_THEME_ID } from '@/lib/tournament/theme'

// Chooser landing for /tournaments. Splits the two tournament products into a
// free "Sponsored" side (featured community events) and a "Paid" side (USDC
// entry on Base, escrow pays the winner on-chain). It reuses the neutral house
// theme + the same shell chrome as the rest of the tournament UI so the three
// surfaces read as one product. Both status probes degrade gracefully and never
// throw, so the page always renders sensible defaults.

/**
 * Modal explaining the progression loop: grind paid tables -> earn badges + XP
 * -> qualify for invite-only sponsored events. Nudges players toward the paid
 * surface, which is the always-on, self-sustaining side of the product.
 */
function QualifyModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="qualify-title"
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md overflow-hidden rounded-2xl"
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
      >
        <div aria-hidden style={{ height: 3, background: GOLD.bar }} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-3 top-4 flex h-7 w-7 items-center justify-center rounded-lg"
          style={{ color: 'var(--text-muted)', background: 'transparent' }}
        >
          <X size={16} aria-hidden />
        </button>
        <div className="p-5">
          <div className="mb-3 flex items-center gap-2">
            <Award size={18} style={{ color: GOLD.ink }} aria-hidden />
            <h3 id="qualify-title" className="text-lg font-black" style={{ color: 'var(--text-primary)' }}>
              Earn your seat
            </h3>
          </div>
          <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
            Sponsored events are invite-only. Grind the paid tables to earn{' '}
            <strong style={{ color: 'var(--text-primary)' }}>badges</strong> and{' '}
            <strong style={{ color: 'var(--text-primary)' }}>XP</strong>, climb the leaderboard, and unlock
            entry to featured sponsored tournaments.
          </p>
          <p className="mt-3 text-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
            Badge weightings rotate each season, so the more you play, the better your odds of qualifying.
          </p>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Link
              href="/tournaments/paid"
              className="rounded-lg px-3.5 py-2 text-sm font-bold"
              style={{ background: BLUE.iconBg, color: BLUE.ink }}
            >
              Play paid tables
            </Link>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3.5 py-2 text-sm font-bold"
              style={{ background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
            >
              Got it
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Full-bleed neutral hero, mirroring the lobby's hero with the chooser copy. */
function HomeHero() {
  const [qualifyOpen, setQualifyOpen] = useState(false)
  return (
    <>
      <section className="bonk-hero" aria-label="Tournaments">
        <div aria-hidden className="bonk-hero__glow" />
        <div
          aria-hidden
          className="tcw-hero-scene"
          style={{ backgroundImage: 'url(/tournaments/chooser-hero.webp)' }}
        />
        <div className="bonk-hero__wrap">
          <div className="bonk-hero__inner">
            <div className="bonk-hero__copy">
              <span className="bonk-hero__badge bonk-mono">Tournaments</span>
              <h1 className="bonk-hero__title bonk-display">Pick your table</h1>
              <p className="bonk-hero__sub">
                Two ways to play. Free featured community events{' '}
                <button
                  type="button"
                  onClick={() => setQualifyOpen(true)}
                  style={{
                    font: 'inherit',
                    color: GOLD.ink,
                    fontWeight: 700,
                    background: 'transparent',
                    border: 0,
                    padding: 0,
                    cursor: 'pointer',
                    textDecoration: 'underline',
                    textDecorationStyle: 'dotted',
                    textUnderlineOffset: '3px',
                  }}
                >
                  when available
                </button>
                , or paid games with a USDC pot on Base that the escrow pays out automatically.
              </p>
            </div>
          </div>
        </div>
      </section>
      <QualifyModal open={qualifyOpen} onClose={() => setQualifyOpen(false)} />
    </>
  )
}

const cardBase: React.CSSProperties = {
  border: '1px solid var(--border-subtle)',
  borderRadius: 16,
}

// Per-path brand hue. Both cards keep identical shape / type / rhythm; only the
// hue changes, so the two products read as distinct at a glance while staying
// perfectly symmetrical. Warm gold = free community side; Base-blue = the
// on-chain paid side ("USDC on Base"). Green stays reserved for live/open status.
type Accent = {
  /** Top edge bar gradient. */
  bar: string
  /** Icon glyph + Enter + footer link color. */
  ink: string
  /** Icon tile background wash. */
  iconBg: string
  /** Faint corner glow layered over the card surface. */
  glow: string
}
const GOLD: Accent = {
  bar: 'linear-gradient(90deg, #f59e0b 0%, #fbbf24 100%)',
  ink: '#fbbf24',
  iconBg: 'color-mix(in srgb, #fbbf24 16%, transparent)',
  glow: 'radial-gradient(130% 90% at 100% 0%, rgba(245, 158, 11, 0.12) 0%, transparent 58%)',
}
const BLUE: Accent = {
  bar: 'linear-gradient(90deg, #2563eb 0%, #38bdf8 100%)',
  ink: '#60a5fa',
  iconBg: 'color-mix(in srgb, #60a5fa 16%, transparent)',
  glow: 'radial-gradient(130% 90% at 100% 0%, rgba(56, 132, 255, 0.15) 0%, transparent 58%)',
}

/** Symmetric footer row: muted note on the left, accent-colored link on the right. */
function FooterRow({ note, href, label, ink }: { note: string; href: string; label: string; ink: string }) {
  return (
    <span className="flex items-center justify-between gap-2 text-xs" style={{ color: 'var(--text-muted)' }}>
      <span>{note}</span>
      <Link href={href} className="inline-flex items-center gap-1 font-bold" style={{ color: ink }}>
        {label} <ArrowRight size={12} aria-hidden />
      </Link>
    </span>
  )
}

/** Small green "Live now" pulse pill for an active featured event. */
function LivePill() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em]"
      style={{ background: 'rgba(34,197,94,0.16)', color: '#22c55e' }}
    >
      <span aria-hidden className="relative flex" style={{ width: 8, height: 8 }}>
        <span
          className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"
          style={{ background: '#22c55e' }}
        />
        <span className="relative inline-flex rounded-full" style={{ width: 8, height: 8, background: '#22c55e' }} />
      </span>
      Live now
    </span>
  )
}

function ChooserCard({
  href,
  icon: Icon,
  eyebrow,
  title,
  subtitle,
  status,
  secondary,
  accent,
}: {
  href: string
  icon: typeof Trophy
  eyebrow: string
  title: string
  subtitle: string
  /** Right-aligned status node in the header (live pill, open count, etc.). */
  status?: React.ReactNode
  /** Muted footer row under the main call to action. Always rendered so both cards match. */
  secondary: React.ReactNode
  /** Per-path brand hue. */
  accent: Accent
}) {
  return (
    <div
      className="flex w-full max-w-[420px] flex-col overflow-hidden sm:w-[380px]"
      style={{ ...cardBase, background: `${accent.glow}, var(--bg-surface)` }}
    >
      <div aria-hidden style={{ height: 3, background: accent.bar }} />
      <Link
        href={href}
        className="group flex flex-1 flex-col px-5 pt-4 pb-5 transition-transform hover:-translate-y-0.5"
      >
        <div className="mb-3 flex min-h-[28px] items-center justify-between gap-2">
          <span
            className="bonk-mono text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{ color: 'var(--text-muted)' }}
          >
            {eyebrow}
          </span>
          {status}
        </div>

        <div className="mb-3 flex items-center gap-2.5">
          <span
            className="flex items-center justify-center rounded-xl"
            style={{
              width: 40,
              height: 40,
              background: accent.iconBg,
              border: '1px solid var(--border-subtle)',
            }}
          >
            <Icon size={20} style={{ color: accent.ink }} aria-hidden />
          </span>
          <h2 className="text-2xl font-black" style={{ color: 'var(--text-primary)' }}>
            {title}
          </h2>
        </div>

        <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          {subtitle}
        </p>

        <span
          className="mt-5 inline-flex items-center gap-1 text-sm font-bold group-hover:underline"
          style={{ color: accent.ink }}
        >
          Enter <ArrowRight size={15} aria-hidden />
        </span>
      </Link>
      <div className="border-t px-5 py-3" style={{ borderColor: 'var(--border-subtle)' }}>
        {secondary}
      </div>
    </div>
  )
}

export function TournamentsHome() {
  const theme = getTournamentTheme(HOUSE_THEME_ID)

  const [activeLoaded, setActiveLoaded] = useState(false)
  const [active, setActive] = useState<{ live: boolean; status?: string }>({ live: false })

  const [paidLoaded, setPaidLoaded] = useState(false)
  const [paidConfigured, setPaidConfigured] = useState(false)
  const [openCount, setOpenCount] = useState(0)

  useEffect(() => {
    let alive = true
    apiActiveStatus()
      .then((res) => {
        if (alive) setActive(res)
      })
      .finally(() => alive && setActiveLoaded(true))
    apiPaidGames()
      .then((res) => {
        if (!alive) return
        setPaidConfigured(res.configured && res.escrowConfigured)
        setOpenCount(res.games.filter((g) => g.status !== 'running').length)
      })
      .finally(() => alive && setPaidLoaded(true))
    return () => {
      alive = false
    }
  }, [])

  // Sponsored side: green "Live now" pill when a featured event is running,
  // otherwise a muted pointer to the archive.
  const sponsoredStatus = activeLoaded && active.live ? <LivePill /> : undefined
  const sponsoredSecondary =
    activeLoaded && active.live ? (
      <FooterRow note="Live event in progress." href="/tournaments/sponsored" label="Watch" ink={GOLD.ink} />
    ) : (
      <FooterRow note="No live event right now." href="/tournaments/history" label="See past events" ink={GOLD.ink} />
    )

  // Paid side always has a footer too, so both cards share the same structure.
  // Points at the public deck-check tool as an on-chain "provably fair" signal.
  const paidSecondary = <FooterRow note="Provably fair, on-chain." href="/tools/deck-check" label="Verify a match" ink={BLUE.ink} />

  // Paid side: an open-lobby count when the escrow backend is live, a subdued
  // "Coming soon" when it is not.
  const paidStatus = !paidLoaded ? undefined : !paidConfigured ? (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em]"
      style={{ background: 'color-mix(in srgb, var(--bg) 70%, transparent)', color: 'var(--text-muted)' }}
    >
      Coming soon
    </span>
  ) : (
    <span
      className="rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] tabular-nums"
      style={{ background: 'rgba(34,197,94,0.16)', color: '#22c55e' }}
    >
      {openCount > 0 ? `${openCount} open` : 'Always open'}
    </span>
  )

  return (
    <TournamentShell hero={<HomeHero />} theme={theme}>
      <div className="mx-auto flex flex-col items-center gap-4 sm:gap-5 md:flex-row md:items-stretch md:justify-center" style={{ maxWidth: 900 }}>
        <ChooserCard
          href="/tournaments/sponsored"
          icon={Trophy}
          eyebrow="Free to enter"
          title="Sponsored"
          subtitle="Free to join. Featured community events with themed prizes and published deck lists."
          status={sponsoredStatus}
          secondary={sponsoredSecondary}
          accent={GOLD}
        />
        <ChooserCard
          href="/tournaments/paid"
          icon={Coins}
          eyebrow="USDC on Base"
          title="Paid"
          subtitle="USDC entry on Base. Winner paid automatically on-chain by a smart-contract escrow."
          status={paidStatus}
          secondary={paidSecondary}
          accent={BLUE}
        />
      </div>
    </TournamentShell>
  )
}
