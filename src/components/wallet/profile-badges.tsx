'use client'

// ProfileBadges - a player's "trophy case": the gold / silver / bronze medals
// earned by finishing top-3 in completed tournaments. Rendered on both the
// profile modal and the public profile page.
//
// Badges are fetched by wallet address from /api/auth/badges (public data).
// Clicking a medal opens that event's final standings in a modal, reusing the
// existing public snapshot endpoint - no extra storage, always in sync with
// what the bracket showed.

import { useEffect, useState } from 'react'
import { Loader2, Medal, X } from 'lucide-react'
import { ModalPortal } from '@/components/ui/modal-portal'
import { apiSnapshotByCode } from '@/lib/tournament/client'
import type { TournamentSnapshot } from '@/lib/tournament/types'
import { ProfileShelf } from './profile-shelf'

interface TournamentBadge {
  tournamentCode: string
  tournamentName: string
  game: string
  rank: number
  playersCount: number
  awardedAt: string
}

const MEDAL = {
  1: { color: '#f5b301', label: 'Gold', place: '1st' },
  2: { color: '#c4cad3', label: 'Silver', place: '2nd' },
  3: { color: '#cd7f32', label: 'Bronze', place: '3rd' },
} as const

function medalFor(rank: number) {
  return MEDAL[rank as 1 | 2 | 3] ?? MEDAL[3]
}

export function ProfileBadges({ walletAddress }: { walletAddress: string }) {
  const [badges, setBadges] = useState<TournamentBadge[] | null>(null)
  const [open, setOpen] = useState<TournamentBadge | null>(null)

  useEffect(() => {
    if (!walletAddress) return
    let cancelled = false
    fetch(`/api/auth/badges?address=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { badges: [] }))
      .then((d) => {
        if (!cancelled) setBadges((d.badges ?? []) as TournamentBadge[])
      })
      .catch(() => {
        if (!cancelled) setBadges([])
      })
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  const state: 'loading' | 'empty' | 'ready' = !badges ? 'loading' : badges.length === 0 ? 'empty' : 'ready'

  // Always render the shelf (uniform profile size). One swipeable row so even a
  // prolific winner's case stays one line tall and never scrolls vertically.
  return (
    <>
      <ProfileShelf
        icon={Medal}
        title="Trophy case"
        state={state}
        emptyText="No podium finishes yet - top-3 results show here."
        skeletonWidth={190}
        skeletonHeight={46}
      >
        {(badges ?? []).map((b) => {
          const m = medalFor(b.rank)
          return (
            <button
              key={`${b.tournamentCode}-${b.rank}`}
              onClick={() => setOpen(b)}
              className="inline-flex items-center gap-2 px-3 py-2 text-left transition-opacity hover:opacity-90"
              style={{
                background: `color-mix(in srgb, ${m.color} 12%, var(--bg))`,
                border: `1px solid color-mix(in srgb, ${m.color} 38%, transparent)`,
                borderRadius: 8,
                cursor: 'pointer',
                width: 190,
              }}
              title={`${m.place} of ${b.playersCount} - ${b.tournamentName}`}
            >
              <Medal size={18} style={{ color: m.color, flexShrink: 0 }} />
              <span className="min-w-0 flex-1">
                <span
                  className="block font-display text-xs font-bold leading-tight truncate"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {b.tournamentName}
                </span>
                <span className="block text-[11px] font-semibold" style={{ color: m.color }}>
                  {m.place}
                  {b.playersCount > 0 ? (
                    <span style={{ color: 'var(--text-muted)' }}> of {b.playersCount}</span>
                  ) : null}
                </span>
              </span>
            </button>
          )
        })}
      </ProfileShelf>

      {open && <BadgeResultModal badge={open} onClose={() => setOpen(null)} />}
    </>
  )
}

// ── Result modal: final standings for the event a badge was earned in ────────

function BadgeResultModal({ badge, onClose }: { badge: TournamentBadge; onClose: () => void }) {
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiSnapshotByCode(badge.tournamentCode)
      .then((s) => {
        if (!cancelled) setSnapshot(s)
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Could not load results')
      })
    return () => {
      cancelled = true
    }
  }, [badge.tournamentCode])

  const m = medalFor(badge.rank)
  const standings = snapshot?.standings ?? []

  return (
    <ModalPortal onClose={onClose} label="Tournament results" maxWidth={460}>
      <div
        style={{
          height: 4,
          background: `linear-gradient(90deg, ${m.color}, color-mix(in srgb, ${m.color} 35%, transparent))`,
          flexShrink: 0,
        }}
      />
      <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 12px 0', flexShrink: 0 }}>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            background: 'var(--bg)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '50%',
            width: 30,
            height: 30,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            color: 'var(--text-secondary)',
          }}
        >
          <X size={16} />
        </button>
      </div>

      <div style={{ padding: '0 24px 24px', overflowY: 'auto' }}>
        <div className="flex items-center gap-2.5">
          <Medal size={22} style={{ color: m.color, flexShrink: 0 }} />
          <div className="min-w-0">
            <h2 className="font-display" style={{ fontSize: 20, fontWeight: 800, lineHeight: 1.15 }}>
              {badge.tournamentName}
            </h2>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Finished <span style={{ color: m.color, fontWeight: 700 }}>{m.place}</span>
              {badge.playersCount > 0 ? ` of ${badge.playersCount}` : ''}
            </p>
          </div>
        </div>

        <div
          className="text-[11px] font-bold uppercase tracking-wider mt-5 mb-2"
          style={{ color: 'var(--text-muted)' }}
        >
          Final standings
        </div>

        {error ? (
          <p className="text-sm py-3" style={{ color: '#ef4444' }}>
            {error}
          </p>
        ) : !snapshot ? (
          <div className="flex items-center gap-2 text-sm py-4" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={15} className="animate-spin" /> Loading results…
          </div>
        ) : standings.length === 0 ? (
          <p className="text-sm py-3" style={{ color: 'var(--text-muted)' }}>
            No standings recorded for this event.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {standings.map((row) => {
              const podium = row.rank <= 3 ? medalFor(row.rank) : null
              return (
                <li
                  key={row.playerId}
                  className="flex items-center gap-2.5 px-3 py-2"
                  style={{
                    background: podium
                      ? `color-mix(in srgb, ${podium.color} 10%, var(--bg))`
                      : 'var(--bg)',
                    border: `1px solid ${
                      podium
                        ? `color-mix(in srgb, ${podium.color} 30%, transparent)`
                        : 'var(--border-subtle)'
                    }`,
                    borderRadius: 7,
                  }}
                >
                  <span
                    className="inline-flex items-center justify-center font-display text-xs font-bold tabular-nums shrink-0"
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 6,
                      background: podium ? podium.color : 'color-mix(in srgb, var(--text-primary) 12%, transparent)',
                      color: podium ? '#1a1a1a' : 'var(--text-primary)',
                    }}
                  >
                    {row.rank}
                  </span>
                  <span className="font-semibold text-sm truncate min-w-0">{row.displayName}</span>
                  <span className="ml-auto text-xs tabular-nums shrink-0" style={{ color: 'var(--text-muted)' }}>
                    {row.wins}W / {row.losses}L{row.draws > 0 ? ` / ${row.draws}D` : ''}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </ModalPortal>
  )
}
