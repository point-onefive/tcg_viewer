'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { TournamentShell } from './tournament-shell'
import { apiPaidGames } from '@/lib/tournament/client'
import type { PaidGameSummary } from '@/lib/tournament/types'

// Always-on paid tournaments lobby (/tournaments/play). A SEPARATE surface from
// the featured-events page at /tournaments: it lists open paid games (players
// fund the pot in USDC on Base, the escrow pays out, the platform takes a rake)
// and is available whether or not a featured event is live. See
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

function GameCard({ g }: { g: PaidGameSummary }) {
  const cap = g.cap ?? null
  return (
    <Link
      href={`/tournaments/play/${encodeURIComponent(g.code)}`}
      className="group block overflow-hidden transition-transform hover:-translate-y-0.5"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 12,
      }}
    >
      <div className="flex items-center justify-between gap-2 px-4 py-2.5" style={{ borderBottom: '1px solid var(--border-subtle)' }}>
        <span className="text-[11px] font-bold uppercase tracking-[0.14em]" style={{ color: 'var(--text-muted)' }}>
          {GAME_LABELS[g.game] ?? 'TCG'}
        </span>
        <span
          className="text-[11px] font-bold uppercase tracking-wide"
          style={{ color: g.status === 'running' ? 'var(--text-muted)' : 'var(--tcw-accent, #f59e0b)' }}
        >
          {g.status === 'running' ? 'In progress' : 'Open'}
        </span>
      </div>

      <div className="px-4 py-4">
        <h3 className="mb-3 truncate text-lg font-extrabold" style={{ color: 'var(--text-primary)' }}>
          {g.name}
        </h3>

        <div className="flex items-baseline gap-2">
          <span className="text-3xl font-black tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {formatUsdc(g.entryFeeUsdc)}
          </span>
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            entry · USDC
          </span>
        </div>

        <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
          <span className="rounded-md px-2 py-1" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
            {payoutLabel(g)}
          </span>
          {g.rakeBps != null && (
            <span className="rounded-md px-2 py-1" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
              {g.rakeBps / 100}% platform fee
            </span>
          )}
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-sm font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            {g.fundedCount}
            {cap != null ? ` / ${cap}` : ''}{' '}
            <span className="font-medium" style={{ color: 'var(--text-muted)' }}>funded</span>
          </span>
          <span className="text-sm font-bold group-hover:underline" style={{ color: 'var(--tcw-accent, #f59e0b)' }}>
            View →
          </span>
        </div>
      </div>
    </Link>
  )
}

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div
      className="mx-auto max-w-xl rounded-xl px-6 py-10 text-center"
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}
    >
      <h2 className="mb-2 text-xl font-extrabold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{body}</p>
      <Link
        href="/tournaments"
        className="mt-6 inline-block text-sm font-bold"
        style={{ color: 'var(--tcw-accent, #f59e0b)' }}
      >
        See the featured event →
      </Link>
    </div>
  )
}

export function PaidLobby() {
  const [loading, setLoading] = useState(true)
  const [escrowConfigured, setEscrowConfigured] = useState(false)
  const [games, setGames] = useState<PaidGameSummary[]>([])

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

  const lede = (
    <p className="text-base" style={{ color: 'var(--text-secondary)' }}>
      <span className="font-extrabold" style={{ color: 'var(--text-primary)' }}>Play for the pot.</span>{' '}
      Fund your entry in USDC on Base, compete, and the smart-contract escrow pays
      the winners automatically. Always open - separate from our featured events.
    </p>
  )

  return (
    <TournamentShell lede={lede}>
      {loading ? (
        <div className="py-16 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {games.map((g) => (
            <GameCard key={g.code} g={g} />
          ))}
        </div>
      )}
    </TournamentShell>
  )
}
