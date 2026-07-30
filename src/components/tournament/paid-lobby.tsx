'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Coins, Trophy, Users, ArrowRight } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { BonkModuleHeader } from './bonk-ui'
import { apiPaidGames } from '@/lib/tournament/client'
import { getTournamentTheme, HOUSE_THEME_ID } from '@/lib/tournament/theme'
import type { PaidGameSummary } from '@/lib/tournament/types'

// Always-on paid tournaments lobby (/tournaments/play). A SEPARATE surface from
// the featured-events page at /tournaments: it lists open paid games (players
// fund the pot in USDC on Base, the escrow pays out, the platform takes a rake)
// and is available whether or not a featured event is live. It reuses the
// neutral "house" theme + the same shell/section chrome as the live tournament
// page so the two surfaces read as one product. See
// docs/paid-tournaments-escrow.md.

const GAME_LABELS: Record<string, string> = {
  'one-piece': 'One Piece',
  pokemon: 'Pokémon',
  gundam: 'Gundam',
  'dragon-ball': 'Dragon Ball',
  digimon: 'Digimon',
  lorcana: 'Lorcana',
  other: 'TCG',
}

const PAYOUT_LABELS: Record<string, string> = {
  wta: 'Winner take all',
  top3: 'Top 3 paid',
  top6: 'Top 6 paid',
  top8: 'Top 8 paid',
}

function formatUsdc(units: number | null): string {
  if (units == null) return '-'
  const dollars = units / 1_000_000
  return `$${Number.isInteger(dollars) ? dollars.toFixed(0) : dollars.toFixed(2)}`
}

function payoutLabel(g: PaidGameSummary): string {
  if (g.payoutPreset && PAYOUT_LABELS[g.payoutPreset]) return PAYOUT_LABELS[g.payoutPreset]
  const depth = g.payoutBps?.length ?? 0
  if (depth === 1) return 'Winner take all'
  if (depth > 1) return `Top ${depth} paid`
  return 'Payouts TBD'
}

const chip: React.CSSProperties = {
  background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '4px 9px',
}

function GameCard({ g }: { g: PaidGameSummary }) {
  const cap = g.cap ?? null
  const open = g.status !== 'running'
  return (
    <Link
      href={`/tournaments/play/${encodeURIComponent(g.code)}`}
      className="group block w-full max-w-[380px] overflow-hidden transition-transform hover:-translate-y-0.5 sm:w-[340px]"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 16,
      }}
    >
      {/* Themed sun-gradient cap ties each card to the section chrome. */}
      <div aria-hidden style={{ height: 3, background: 'var(--bonk-grad-sun)' }} />

      <div className="flex items-center justify-between gap-2 px-4 pt-3.5 pb-2">
        <span
          className="bonk-mono text-[11px] font-bold uppercase tracking-[0.14em]"
          style={{ color: 'var(--text-muted)' }}
        >
          {GAME_LABELS[g.game] ?? 'TCG'}
        </span>
        <span
          className="rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-[0.12em]"
          style={
            open
              ? { background: 'rgba(34,197,94,0.16)', color: '#22c55e' }
              : { background: 'color-mix(in srgb, var(--bg) 70%, transparent)', color: 'var(--text-muted)' }
          }
        >
          {open ? 'Open' : 'In progress'}
        </span>
      </div>

      <div className="px-4 pb-4">
        <h3 className="mb-3 truncate text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>
          {g.name}
        </h3>

        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tabular-nums" style={{ color: 'var(--bonk-ui-yellow)' }}>
            {formatUsdc(g.entryFeeUsdc)}
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            entry · USDC
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          <span style={chip}>{payoutLabel(g)}</span>
          {g.rakeBps != null && <span style={chip}>{g.rakeBps / 100}% platform fee</span>}
        </div>

        <div className="mt-4 flex items-center justify-between border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          <span className="inline-flex items-center gap-1.5 text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            <Users size={14} style={{ color: 'var(--tcw-accent)' }} aria-hidden />
            {g.fundedCount}
            {cap != null ? ` / ${cap}` : ''}{' '}
            <span className="font-medium" style={{ color: 'var(--text-muted)' }}>funded</span>
          </span>
          <span className="inline-flex items-center gap-1 text-sm font-bold group-hover:underline" style={{ color: 'var(--bonk-ui-yellow)' }}>
            View <ArrowRight size={14} aria-hidden />
          </span>
        </div>
      </div>
    </Link>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="mx-auto max-w-md px-6 py-10 text-center">
      <div
        className="mx-auto mb-4 flex items-center justify-center rounded-full"
        style={{ width: 52, height: 52, background: 'color-mix(in srgb, var(--bonk-ui-yellow) 14%, transparent)', border: '1px solid var(--border-subtle)' }}
      >
        <Coins size={24} style={{ color: 'var(--bonk-ui-yellow)' }} aria-hidden />
      </div>
      <h2 className="mb-2 text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.6 }}>{body}</p>
      <Link
        href="/tournaments"
        className="mt-6 inline-flex items-center gap-1 text-sm font-bold"
        style={{ color: 'var(--bonk-ui-yellow)' }}
      >
        See the featured event <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  )
}

/** Full-bleed neutral hero, mirroring the live tournament page's hero but with
 *  the lobby's own copy. Uses the global .bonk-hero styling + house theme vars
 *  (applied by the shell) so it matches without importing the heavy live page. */
function LobbyHero() {
  return (
    <section className="bonk-hero" aria-label="Paid tournaments">
      <div aria-hidden className="bonk-hero__glow" />
      <div className="bonk-hero__wrap">
        <div className="bonk-hero__inner">
          <div className="bonk-hero__copy">
            <span className="bonk-hero__badge bonk-mono">Always open · USDC on Base</span>
            <h1 className="bonk-hero__title bonk-display">Paid Tournaments</h1>
            <p className="bonk-hero__sub">
              Fund your entry in USDC, compete, and the smart-contract escrow pays the winners
              automatically. Separate from our featured events.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

export function PaidLobby() {
  const [loading, setLoading] = useState(true)
  const [escrowConfigured, setEscrowConfigured] = useState(false)
  const [games, setGames] = useState<PaidGameSummary[]>([])
  const theme = getTournamentTheme(HOUSE_THEME_ID)

  useEffect(() => {
    let alive = true
    apiPaidGames()
      .then((res) => {
        if (!alive) return
        setEscrowConfigured(res.escrowConfigured)
        setGames(res.games)
      })
      .finally(() => alive && setLoading(false))
    return () => {
      alive = false
    }
  }, [])

  const openCount = games.filter((g) => g.status !== 'running').length

  return (
    <TournamentShell hero={<LobbyHero />} theme={theme}>
      {/* Centered column so a handful of lobbies read as a deliberate, tidy
          block instead of stranded top-left. Mobile-first: one centered card. */}
      <div className="mx-auto" style={{ maxWidth: 1040 }}>
        <div className="overflow-hidden" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 16 }}>
          <BonkModuleHeader
            icon={Trophy}
            title="Open lobbies"
            right={
              !loading && escrowConfigured && games.length > 0 ? (
                <span
                  className="bonk-mono inline-flex items-center rounded-full px-2.5 py-1 text-xs font-bold tabular-nums"
                  style={{ background: 'rgba(0,0,0,0.28)', color: 'var(--bonk-band-fg)', border: '1px solid var(--bonk-band-divider)' }}
                >
                  {openCount} open
                </span>
              ) : undefined
            }
          />
          <div className="p-4 sm:p-6">
            {loading ? (
              <div className="py-14 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                Loading open games…
              </div>
            ) : !escrowConfigured ? (
              <Notice
                title="Paid tournaments are coming soon"
                body="The on-chain entry + payout system is being finalized. In the meantime, our featured events are free to enter."
              />
            ) : games.length === 0 ? (
              <Notice
                title="No open games right now"
                body="There aren't any paid games open at the moment. Check back soon - new games open regularly."
              />
            ) : (
              <div className="flex flex-wrap justify-center gap-4 sm:gap-5">
                {games.map((g) => (
                  <GameCard key={g.code} g={g} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </TournamentShell>
  )
}
