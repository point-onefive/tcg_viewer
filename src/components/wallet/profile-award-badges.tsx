'use client'

// ProfileAwardBadges - the "Badges" shelf: cosmetic awards a wallet has earned.
// The API merges two sources into one ready-to-render list: static catalog
// badges (participation / historical placements) and dynamic per-tournament
// badges (admin-made, assigned by placement). Same shelf frame as the prize
// shelf (skeleton while loading, discreet empty note, one horizontal row) so
// every profile is the same size. Tapping a badge enlarges it (via onSelect).

import { useEffect, useState } from 'react'
import { Award } from 'lucide-react'
import { ProfileShelf } from './profile-shelf'
import { type BadgeTier, type DisplayBadge } from '@/lib/wallet/badge-catalog'
import type { AwardItem } from './award-lightbox'

function tierColor(tier: BadgeTier): string {
  if (tier === 'gold') return '#f5b301'
  if (tier === 'silver') return '#c4cad3'
  if (tier === 'bronze') return '#cd7f32'
  return 'var(--tcw-accent)'
}

/** Map a display badge to the source-agnostic lightbox item. */
export function badgeToAward(b: DisplayBadge): AwardItem {
  return {
    key: b.key,
    image: b.image,
    title: b.name,
    description: b.description,
    link: b.link,
    accent: tierColor(b.tier),
  }
}

export function ProfileAwardBadges({
  walletAddress,
  onSelect,
}: {
  walletAddress: string
  onSelect: (item: AwardItem) => void
}) {
  const [badges, setBadges] = useState<DisplayBadge[] | null>(null)

  useEffect(() => {
    if (!walletAddress) {
      setBadges([])
      return
    }
    let cancelled = false
    fetch(`/api/auth/profile-badges?address=${encodeURIComponent(walletAddress)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { badges: [] }))
      .then((d) => {
        if (!cancelled) setBadges((d.badges ?? []) as DisplayBadge[])
      })
      .catch(() => {
        if (!cancelled) setBadges([])
      })
    return () => {
      cancelled = true
    }
  }, [walletAddress])

  const state: 'loading' | 'empty' | 'ready' = !badges ? 'loading' : badges.length === 0 ? 'empty' : 'ready'

  return (
    <ProfileShelf
      icon={Award}
      iconColor="#f5b301"
      title="Badges"
      state={state}
      emptyText="No badges yet - awards show here."
      skeletonWidth={72}
      skeletonHeight={72}
      skeletonRadius={14}
    >
      {(badges ?? []).map((b) => (
        <BadgeChip key={b.key} badge={b} onSelect={() => onSelect(badgeToAward(b))} />
      ))}
    </ProfileShelf>
  )
}

function BadgeChip({ badge, onSelect }: { badge: DisplayBadge; onSelect: () => void }) {
  const color = tierColor(badge.tier)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${badge.name} - enlarge`}
      className="profile-chip flex items-center justify-center"
      style={{
        width: 72,
        height: 72,
        padding: 7,
        borderRadius: 14,
        background: `radial-gradient(circle at 50% 32%, color-mix(in srgb, ${color} 16%, var(--bg)) 0%, var(--bg) 78%)`,
        border: `1px solid color-mix(in srgb, ${color} 38%, transparent)`,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={badge.image}
        alt={badge.name}
        style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
      />
    </button>
  )
}
