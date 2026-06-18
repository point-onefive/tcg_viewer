'use client'

// ProfilePrizes - the "prize shelf": the actual prizes a player was awarded in
// completed tournaments, shown as image badges. A prize image alone often
// can't convey the value/context, so the title + description reveal on hover.
//
// Reads the frozen award snapshot via /api/auth/prizes (never the live,
// still-changing pool), so what shows here can never be rewritten by a later
// edit to a tournament's prize pool.

import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'

interface WonPrize {
  id: string
  tournamentCode: string
  tournamentName: string
  game: string
  rank: number | null
  title: string
  description: string
  image: string | null
  awardedAt: string
}

function medalColor(rank: number | null): string | null {
  if (rank === 1) return '#f5b301'
  if (rank === 2) return '#c4cad3'
  if (rank === 3) return '#cd7f32'
  return null
}

export function ProfilePrizes({ walletAddress }: { walletAddress: string }) {
  const [prizes, setPrizes] = useState<WonPrize[] | null>(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!walletAddress) return
    let cancelled = false
    fetch(`/api/auth/prizes?address=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { prizes: [] }))
      .then((d) => {
        if (!cancelled) setPrizes((d.prizes ?? []) as WonPrize[])
      })
      .catch(() => {
        if (!cancelled) setPrizes([])
      })
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  // Still loading the first time: show a skeleton in the prize-shelf shape so
  // the modal reserves the space instead of popping the tiles in late.
  if (!prizes) return <PrizesSkeleton />

  // Nothing won. In production we render nothing so the profile stays clean. In
  // development we show a faint shell so the layout can be previewed before any
  // tournament has handed out prizes.
  if (prizes.length === 0) {
    if (process.env.NODE_ENV === 'production') return null
    return <PrizesEmptyPreview />
  }

  // Cap the shelf so a big winner doesn't blow out the modal; the rest are one
  // tap away.
  const CAP = 8
  const visible = expanded ? prizes : prizes.slice(0, CAP)
  const hiddenCount = prizes.length - visible.length

  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Gift size={13} style={{ color: '#E85D2A' }} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Prizes won
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        {visible.map((p) => (
          <PrizeBadge key={p.id} prize={p} />
        ))}
      </div>

      {prizes.length > CAP && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="mt-2 text-[11px] font-bold uppercase tracking-wider transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-muted)', cursor: 'pointer' }}
        >
          {expanded ? 'Show less' : `Show ${hiddenCount} more`}
        </button>
      )}
    </div>
  )
}

// ── Loading skeleton: prize-shelf shaped placeholder while prizes fetch ──────
function PrizesSkeleton() {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Gift size={13} style={{ color: '#E85D2A' }} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Prizes won
        </span>
      </div>
      <div className="flex flex-wrap gap-2.5">
        <div className="profile-skel" style={{ width: 84, height: 88 }} />
        <div className="profile-skel" style={{ width: 84, height: 88 }} />
        <div className="profile-skel" style={{ width: 84, height: 88 }} />
      </div>
    </div>
  )
}

// ── Dev-only empty preview: the shell, with no real data ─────────────────────
// Only rendered when NODE_ENV !== 'production', so prod profiles with no prizes
// still render nothing.
function PrizesEmptyPreview() {
  return (
    <div className="mt-6">
      <div className="flex items-center gap-1.5 mb-2.5">
        <Gift size={13} style={{ color: '#E85D2A' }} />
        <span
          className="text-[11px] font-bold uppercase tracking-wider"
          style={{ color: 'var(--text-muted)' }}
        >
          Prizes won
        </span>
      </div>
      <div className="flex items-center gap-2.5">
        <div
          className="flex flex-col items-center justify-center"
          style={{
            width: 84,
            height: 88,
            background: 'var(--bg)',
            border: '1px dashed var(--border-subtle)',
            borderRadius: 8,
            opacity: 0.7,
          }}
        >
          <Gift size={22} style={{ color: 'var(--text-muted)' }} />
        </div>
        <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
          No prizes yet - awards show here
        </span>
      </div>
    </div>
  )
}

function PrizeBadge({ prize }: { prize: WonPrize }) {
  const medal = medalColor(prize.rank)
  const tooltip = [prize.title, prize.tournamentName, prize.description]
    .filter(Boolean)
    .join(' - ')

  return (
    <div className="group relative" style={{ width: 84 }}>
      <div
        className="flex flex-col overflow-hidden"
        style={{
          background: 'var(--bg)',
          border: `1px solid ${medal ? `color-mix(in srgb, ${medal} 45%, transparent)` : 'var(--border-subtle)'}`,
          borderTop: `3px solid ${medal ?? 'var(--border-subtle)'}`,
          borderRadius: 8,
          cursor: 'default',
        }}
      >
        {prize.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={prize.image}
            alt={prize.title}
            style={{
              width: '100%',
              height: 64,
              objectFit: 'contain',
              display: 'block',
              background: 'var(--bg-surface)',
            }}
          />
        ) : (
          <div
            className="flex items-center justify-center"
            style={{ width: '100%', height: 64, background: 'var(--bg-surface)' }}
          >
            <Gift size={22} style={{ color: 'var(--text-muted)' }} />
          </div>
        )}
        <div className="px-1.5 py-1 text-center">
          <span
            className="block font-display text-[10px] font-bold truncate"
            style={{ color: medal ?? 'var(--text-primary)' }}
            title={prize.title}
          >
            {prize.title}
          </span>
        </div>
      </div>

      {/* Hover card: the context an image can't carry. */}
      <div
        className="pointer-events-none absolute left-1/2 z-20 hidden -translate-x-1/2 group-hover:block"
        style={{ bottom: 'calc(100% + 8px)', width: 200 }}
      >
        <div
          className="p-2.5 text-left"
          style={{
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 8,
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <div className="font-display text-xs font-bold" style={{ color: 'var(--text-primary)' }}>
            {prize.title}
          </div>
          <div className="text-[11px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            {prize.tournamentName}
            {prize.rank ? ` - finished ${ordinal(prize.rank)}` : ''}
          </div>
          {prize.description && (
            <p
              className="text-[11px] mt-1.5 whitespace-pre-wrap"
              style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}
            >
              {prize.description}
            </p>
          )}
        </div>
      </div>

      {/* Native tooltip fallback for touch / no-hover. */}
      <span className="sr-only" title={tooltip} />
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
