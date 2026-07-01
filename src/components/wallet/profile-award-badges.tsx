'use client'

// ProfileAwardBadges - the "Badges" shelf: cosmetic awards (participation,
// placement, one-offs) a wallet has earned, drawn from the code-side catalog
// and the `profile_badges` grant table. Same shelf frame as the trophy case and
// prize shelf (skeleton while loading, discreet empty note, one horizontal row)
// so every profile is the same size.

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { Award } from 'lucide-react'
import { ProfileShelf } from './profile-shelf'
import { badgeOrder, getBadgeDef, type BadgeDef, type BadgeTier } from '@/lib/wallet/badge-catalog'

interface EarnedBadge {
  badgeId: string
  awardedAt: string
}

function tierColor(tier: BadgeTier): string {
  if (tier === 'gold') return '#f5b301'
  if (tier === 'silver') return '#c4cad3'
  if (tier === 'bronze') return '#cd7f32'
  return 'var(--tcw-accent)'
}

export function ProfileAwardBadges({ walletAddress }: { walletAddress: string }) {
  const [ids, setIds] = useState<string[] | null>(null)

  useEffect(() => {
    if (!walletAddress) {
      setIds([])
      return
    }
    let cancelled = false
    fetch(`/api/auth/profile-badges?address=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { badges: [] }))
      .then((d) => {
        if (cancelled) return
        const earned = (d.badges ?? []) as EarnedBadge[]
        const known = earned
          .map((e) => e.badgeId)
          .filter((id) => getBadgeDef(id))
          .sort((a, b) => badgeOrder(a) - badgeOrder(b))
        setIds(known)
      })
      .catch(() => {
        if (!cancelled) setIds([])
      })
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  const state: 'loading' | 'empty' | 'ready' = !ids ? 'loading' : ids.length === 0 ? 'empty' : 'ready'
  const defs = (ids ?? []).map((id) => getBadgeDef(id)).filter((b): b is BadgeDef => Boolean(b))

  return (
    <ProfileShelf
      icon={Award}
      title="Badges"
      state={state}
      emptyText="No badges yet - awards show here."
      skeletonWidth={72}
      skeletonHeight={72}
      skeletonRadius={12}
    >
      {defs.map((b) => (
        <BadgeChip key={b.id} badge={b} />
      ))}
    </ProfileShelf>
  )
}

const TIP_W = 210

function BadgeChip({ badge }: { badge: BadgeDef }) {
  const ref = useRef<HTMLElement>(null)
  const [tip, setTip] = useState<{ left: number; top: number } | null>(null)
  const color = tierColor(badge.tier)

  const show = () => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    const pad = 8
    const center = r.left + r.width / 2
    const left = Math.max(pad, Math.min(center - TIP_W / 2, window.innerWidth - pad - TIP_W))
    setTip({ left, top: r.top - 8 })
  }
  const hide = () => setTip(null)

  const shared = {
    ref: ref as React.Ref<never>,
    title: `${badge.name} - ${badge.description}`,
    onMouseEnter: show,
    onMouseLeave: hide,
    onFocus: show,
    onBlur: hide,
    className: 'flex items-center justify-center transition-transform hover:-translate-y-0.5',
    style: {
      width: 72,
      height: 72,
      padding: 6,
      borderRadius: 12,
      background: `radial-gradient(circle at 50% 35%, color-mix(in srgb, ${color} 16%, var(--bg)) 0%, var(--bg) 78%)`,
      border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      cursor: badge.link ? 'pointer' : 'default',
    } as React.CSSProperties,
  }

  const inner = (
    <>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={badge.image}
        alt={badge.name}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
      {tip &&
        createPortal(
          <div
            className="pointer-events-none"
            style={{ position: 'fixed', left: tip.left, top: tip.top, transform: 'translateY(-100%)', width: TIP_W, zIndex: 300 }}
          >
            <div
              className="p-2.5 text-left"
              style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 8, boxShadow: 'var(--shadow-card)' }}
            >
              <div className="font-display text-xs font-bold" style={{ color }}>
                {badge.name}
              </div>
              <p className="text-[11px] mt-1" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                {badge.description}
              </p>
              {badge.link && (
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

  if (badge.link) {
    return (
      <Link href={badge.link} aria-label={`${badge.name} - view event`} {...shared}>
        {inner}
      </Link>
    )
  }
  return <div {...shared}>{inner}</div>
}
