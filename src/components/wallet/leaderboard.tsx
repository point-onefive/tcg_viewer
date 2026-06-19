'use client'

// Leaderboard - global ranking by wins across all Card Wall tournaments.
// Shown at the top of the tournaments page. Each row opens that player's
// profile in a gentle popup (PlayerProfileView) - same styling as the wallet
// menu's "View profile" modal - rather than navigating to a new page.

import { useEffect, useState } from 'react'
import { Loader2, Medal, ChevronDown } from 'lucide-react'
import { fetchLeaderboard } from '@/lib/wallet/api-client'
import type { WalletStanding } from '@/lib/wallet/db'
import { PlayerAvatar } from './player-avatar'
import { PlayerProfileView } from './player-profile-view'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  boxShadow: 'var(--shadow-card)',
  overflow: 'hidden',
}

const COLLAPSED_COUNT = 5
// How many extra rows each "Show more" click reveals.
const STEP = 10

function medalColor(rank: number): string | null {
  if (rank === 1) return '#f5b301'
  if (rank === 2) return '#c4cad3'
  if (rank === 3) return '#cd7f32'
  return null
}

function RankBadge({ rank }: { rank: number }) {
  const color = medalColor(rank)
  if (color) {
    return (
      <span style={{ width: 26, display: 'inline-flex', justifyContent: 'center' }}>
        <Medal size={18} style={{ color }} />
      </span>
    )
  }
  return (
    <span
      style={{
        width: 26,
        textAlign: 'center',
        fontWeight: 800,
        fontSize: 13,
        color: 'var(--text-muted)',
      }}
    >
      {rank}
    </span>
  )
}

/**
 * Win-rate "tug of war": a proportional green/grey/red bar (wins/draws/losses)
 * with the win percentage to its right. Fills the desktop row so the record no
 * longer floats alone on the far edge. Desktop-only - mobile rows stay compact.
 */
function WinRateBar({ wins, losses, draws }: { wins: number; losses: number; draws: number }) {
  const total = wins + losses + draws
  const pct = total > 0 ? Math.round((wins / total) * 100) : 0
  return (
    <div className="hidden sm:flex items-center gap-2.5" style={{ flex: 1, minWidth: 0 }}>
      <div
        className="flex"
        style={{
          flex: 1,
          height: 6,
          borderRadius: 999,
          overflow: 'hidden',
          background: 'var(--bg)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {total > 0 && (
          <>
            {wins > 0 && <span style={{ flexGrow: wins, flexBasis: 0, background: '#22c55e' }} />}
            {draws > 0 && <span style={{ flexGrow: draws, flexBasis: 0, background: 'var(--text-muted)' }} />}
            {losses > 0 && <span style={{ flexGrow: losses, flexBasis: 0, background: '#ef4444' }} />}
          </>
        )}
      </div>
      <span
        style={{
          width: 34,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: 12,
          fontWeight: 700,
          fontVariantNumeric: 'tabular-nums',
          color: total > 0 ? 'var(--text-secondary)' : 'var(--text-muted)',
        }}
      >
        {total > 0 ? `${pct}%` : '-'}
      </span>
    </div>
  )
}

/** Faint column header, desktop-only, so the rows below read as a table. */
function LeaderboardHeader() {
  const cell: React.CSSProperties = {
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-muted)',
  }
  return (
    <div
      className="hidden sm:flex items-center gap-3 px-4 py-2"
      style={{ borderBottom: '1px solid var(--border-subtle)' }}
    >
      <span style={{ ...cell, width: 26, textAlign: 'center' }}>#</span>
      <span style={{ width: 32, flexShrink: 0 }} aria-hidden />
      <span style={{ ...cell, width: 176, flexShrink: 0 }}>Player</span>
      <span style={{ ...cell, flex: 1, minWidth: 0 }}>Win rate</span>
      <span style={{ ...cell, width: 64, textAlign: 'right' }}>Events</span>
      <span style={{ ...cell, width: 56, textAlign: 'right' }}>W / L</span>
    </div>
  )
}

function LeaderboardRow({
  standing,
  rank,
  onSelect,
}: {
  standing: WalletStanding
  rank: number
  onSelect: (standing: WalletStanding) => void
}) {
  const username = standing.username ?? ''
  return (
    <button
      type="button"
      onClick={() => onSelect(standing)}
      className="flex items-center gap-3 px-3 sm:px-4 transition-colors w-full text-left"
      style={{
        height: 52,
        borderTop: rank === 1 ? 'none' : '1px solid var(--border-subtle)',
        color: 'var(--text-primary)',
        background: 'transparent',
        border: 'none',
        cursor: 'pointer',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <RankBadge rank={rank} />
      <PlayerAvatar
        username={standing.username}
        xHandle={standing.xHandle}
        avatarUrl={standing.avatarUrl}
        walletAddress={standing.walletAddress}
        size={32}
      />
      <span
        className="font-display truncate flex-1 sm:flex-none sm:w-44"
        style={{ fontWeight: 700, fontSize: 14, minWidth: 0 }}
      >
        {username}
      </span>
      <WinRateBar wins={standing.wins} losses={standing.losses} draws={standing.draws} />
      <span className="hidden sm:block" style={{ width: 64, textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
        {standing.tournamentsPlayed} event{standing.tournamentsPlayed === 1 ? '' : 's'}
      </span>
      <span
        className="sm:w-14"
        style={{ fontSize: 13, fontWeight: 700, fontVariantNumeric: 'tabular-nums', textAlign: 'right' }}
      >
        <span style={{ color: '#22c55e' }}>{standing.wins}</span>
        <span style={{ color: 'var(--text-muted)' }}> / </span>
        <span style={{ color: '#ef4444' }}>{standing.losses}</span>
        {standing.draws > 0 && (
          <>
            <span style={{ color: 'var(--text-muted)' }}> / </span>
            <span style={{ color: 'var(--text-secondary)' }}>{standing.draws}</span>
          </>
        )}
      </span>
    </button>
  )
}

export function Leaderboard() {
  const [standings, setStandings] = useState<WalletStanding[] | null>(null)
  const [error, setError] = useState(false)
  const [visibleCount, setVisibleCount] = useState(COLLAPSED_COUNT)
  const [selected, setSelected] = useState<WalletStanding | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchLeaderboard(50)
      .then((rows) => { if (!cancelled) setStandings(rows) })
      .catch(() => { if (!cancelled) setError(true) })
    return () => { cancelled = true }
  }, [])

  // Hide the whole section only if the feature is unavailable (API error).
  if (error) return null

  const total = standings?.length ?? 0
  const visible = (standings ?? []).slice(0, visibleCount)
  const remaining = total - visibleCount
  const canShowMore = remaining > 0
  const canShowLess = visibleCount > COLLAPSED_COUNT
  const nextStep = Math.min(STEP, remaining)
  const isEmpty = standings !== null && standings.length === 0

  return (
    <section aria-label="All-time leaderboard" className="mb-6" style={card}>
      <div
        className="flex items-center gap-2 px-4 py-3"
        style={{
          borderBottom: '1px solid color-mix(in srgb, #E85D2A 25%, var(--border-subtle))',
          background: 'color-mix(in srgb, #E85D2A 8%, var(--bg-surface))',
        }}
      >
        <Medal size={16} style={{ color: '#E85D2A' }} />
        <h2 className="font-display" style={{ fontSize: 15, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)' }}>
          All-time leaderboard
        </h2>
        <span style={{ fontSize: 11, color: 'color-mix(in srgb, #E85D2A 55%, var(--text-muted))', fontWeight: 600 }}>wins across all events</span>
      </div>

      {standings === null ? (
        <div className="flex items-center justify-center gap-2 py-8" style={{ color: 'var(--text-muted)', fontSize: 13 }}>
          <Loader2 size={15} className="animate-spin" /> Loading standings…
        </div>
      ) : isEmpty ? (
        <div className="px-4 py-8 text-center" style={{ color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.6 }}>
          No ranked players yet.
          <br />
          Connect your wallet, set a username, and play to claim a spot.
        </div>
      ) : (
        <>
          <LeaderboardHeader />
          {visible.map((s, i) => (
            <LeaderboardRow key={s.walletAddress} standing={s} rank={i + 1} onSelect={setSelected} />
          ))}
          {(canShowMore || canShowLess) && (
            <div className="flex" style={{ borderTop: '1px solid var(--border-subtle)' }}>
              {canShowMore && (
                <button
                  onClick={() => setVisibleCount((c) => Math.min(c + STEP, total))}
                  className="flex items-center justify-center gap-1.5 flex-1 py-2.5 text-xs font-bold transition-colors"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', cursor: 'pointer' }}
                >
                  Show {nextStep} more
                  <ChevronDown size={14} />
                </button>
              )}
              {canShowMore && remaining > STEP && (
                <button
                  onClick={() => setVisibleCount(total)}
                  className="flex items-center justify-center flex-1 py-2.5 text-xs font-bold transition-colors"
                  style={{
                    color: 'var(--text-secondary)',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderLeft: '1px solid var(--border-subtle)',
                  }}
                >
                  Show all {total}
                </button>
              )}
              {canShowLess && (
                <button
                  onClick={() => setVisibleCount(COLLAPSED_COUNT)}
                  className="flex items-center justify-center gap-1.5 flex-1 py-2.5 text-xs font-bold transition-colors"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    cursor: 'pointer',
                    borderLeft: canShowMore ? '1px solid var(--border-subtle)' : 'none',
                  }}
                >
                  Show less
                  <ChevronDown size={14} style={{ transform: 'rotate(180deg)' }} />
                </button>
              )}
            </div>
          )}
        </>
      )}

      {selected && (
        <PlayerProfileView standing={selected} onClose={() => setSelected(null)} />
      )}
    </section>
  )
}
