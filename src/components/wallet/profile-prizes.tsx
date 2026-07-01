'use client'

// ProfilePrizes - the "prize shelf": the actual prizes a player was awarded in
// completed tournaments, shown as image badges. A prize image alone often
// can't convey the value/context, so the title + description reveal on hover.
//
// Reads the frozen award snapshot via /api/auth/prizes (never the live,
// still-changing pool), so what shows here can never be rewritten by a later
// edit to a tournament's prize pool.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Gift } from 'lucide-react'
import { ProfileShelf } from './profile-shelf'

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

  const state: 'loading' | 'empty' | 'ready' = !prizes ? 'loading' : prizes.length === 0 ? 'empty' : 'ready'

  // Always render the shelf (uniform profile size). One swipeable row so even a
  // big winner's shelf stays one line tall and never scrolls vertically.
  return (
    <ProfileShelf
      icon={Gift}
      iconColor="#E85D2A"
      title="Prizes won"
      state={state}
      emptyText="No prizes won yet - awards show here."
      skeletonWidth={84}
      skeletonHeight={88}
    >
      {(prizes ?? []).map((p) => (
        <PrizeBadge key={p.id} prize={p} />
      ))}
    </ProfileShelf>
  )
}

const TIP_W = 200

function PrizeBadge({ prize }: { prize: WonPrize }) {
  const medal = medalColor(prize.rank)
  const href = prize.tournamentCode ? `/tournaments/${encodeURIComponent(prize.tournamentCode)}` : null

  const rootRef = useRef<HTMLElement>(null)
  // The hover card renders through a portal in fixed coords so it is never
  // clipped by the horizontal scroller's `overflow` (which would otherwise hide
  // a card that sits above the row). null = hidden.
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)

  const showTip = () => {
    const r = rootRef.current?.getBoundingClientRect()
    if (!r) return
    const pad = 8
    const center = r.left + r.width / 2
    const left = Math.max(pad, Math.min(center - TIP_W / 2, window.innerWidth - pad - TIP_W))
    setTip({ left, top: r.top - 8 })
  }
  const hideTip = () => setTip(null)

  const shared = {
    ref: rootRef as React.Ref<never>,
    className: 'flex flex-col overflow-hidden text-left',
    style: {
      width: 84,
      background: 'var(--bg)',
      border: `1px solid ${medal ? `color-mix(in srgb, ${medal} 45%, transparent)` : 'var(--border-subtle)'}`,
      borderTop: `3px solid ${medal ?? 'var(--border-subtle)'}`,
      borderRadius: 8,
      cursor: href ? 'pointer' : 'default',
      padding: 0,
    } as React.CSSProperties,
    onMouseEnter: showTip,
    onMouseLeave: hideTip,
    onFocus: showTip,
    onBlur: hideTip,
  }

  const inner = (
    <>
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
      <div className="px-1.5 py-1 text-center" style={{ width: '100%' }}>
        <span
          className="block font-display text-[10px] font-bold truncate"
          style={{ color: medal ?? 'var(--text-primary)' }}
        >
          {prize.title}
        </span>
      </div>

      {/* Hover card: the context an image can't carry. Portaled + fixed so the
          scroller's overflow can never clip it; clamped to the viewport. */}
      {tip &&
        createPortal(
          <div
            className="pointer-events-none"
            style={{
              position: 'fixed',
              left: tip.left,
              top: tip.top,
              transform: 'translateY(-100%)',
              width: TIP_W,
              zIndex: 300,
            }}
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
              {href && (
                <div className="text-[10px] mt-1.5 font-semibold" style={{ color: 'var(--text-muted)' }}>
                  View event &rarr;
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  )

  if (href) {
    return (
      <Link href={href} aria-label={`${prize.title} - view event`} {...shared}>
        {inner}
      </Link>
    )
  }
  return <div {...shared}>{inner}</div>
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}
