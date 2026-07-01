'use client'

// ProfilePrizes - the "Prizes won" shelf: the actual prizes a player was awarded
// in completed tournaments, shown as image chips. Tapping a prize enlarges it
// (via onSelect) where the title, context and a "View event" action live, so a
// small chip never has to carry all that on hover.
//
// Reads the frozen award snapshot via /api/auth/prizes (never the live,
// still-changing pool), so what shows here can never be rewritten by a later
// edit to a tournament's prize pool.

import { useEffect, useState } from 'react'
import { Gift } from 'lucide-react'
import { ProfileShelf } from './profile-shelf'
import type { AwardItem } from './award-lightbox'

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

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/** Map an awarded prize to the source-agnostic lightbox item. */
function prizeToAward(p: WonPrize): AwardItem {
  const place = p.rank ? `finished ${ordinal(p.rank)}` : null
  return {
    key: p.id,
    image: p.image,
    title: p.title,
    subtitle: [p.tournamentName, place].filter(Boolean).join(' - '),
    description: p.description || undefined,
    link: p.tournamentCode ? `/tournaments/${encodeURIComponent(p.tournamentCode)}` : undefined,
    accent: medalColor(p.rank) ?? 'var(--tcw-accent)',
  }
}

export function ProfilePrizes({
  walletAddress,
  onSelect,
}: {
  walletAddress: string
  onSelect: (item: AwardItem) => void
}) {
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
        <PrizeChip key={p.id} prize={p} onSelect={() => onSelect(prizeToAward(p))} />
      ))}
    </ProfileShelf>
  )
}

function PrizeChip({ prize, onSelect }: { prize: WonPrize; onSelect: () => void }) {
  const medal = medalColor(prize.rank)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`${prize.title} - enlarge`}
      className="profile-chip flex flex-col overflow-hidden text-left"
      style={{
        width: 84,
        background: 'var(--bg)',
        border: `1px solid ${medal ? `color-mix(in srgb, ${medal} 45%, transparent)` : 'var(--border-subtle)'}`,
        borderTop: `3px solid ${medal ?? 'var(--border-subtle)'}`,
        borderRadius: 10,
        padding: 0,
      }}
    >
      {prize.image ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={prize.image}
          alt={prize.title}
          style={{ width: '100%', height: 64, objectFit: 'contain', display: 'block', background: 'var(--bg-surface)' }}
        />
      ) : (
        <div className="flex items-center justify-center" style={{ width: '100%', height: 64, background: 'var(--bg-surface)' }}>
          <Gift size={22} style={{ color: 'var(--text-muted)' }} />
        </div>
      )}
      <div className="px-1.5 py-1 text-center" style={{ width: '100%' }}>
        <span className="block font-display text-[10px] font-bold truncate" style={{ color: medal ?? 'var(--text-primary)' }}>
          {prize.title}
        </span>
      </div>
    </button>
  )
}
