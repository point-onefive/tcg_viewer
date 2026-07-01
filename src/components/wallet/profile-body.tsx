'use client'

// ProfileBody - the shared inner content for BOTH the profile popup
// (PlayerProfileView) and the full-page profile (PlayerProfileCard), so the two
// can never drift apart. It renders, top to bottom:
//   1. identity   - avatar + name (+ country flag) + X handle + region
//   2. stat bar   - one compact segmented strip of numeric stats (social proof)
//   3. availability - self-declared play hours in the viewer's timezone
//   4. badges + prizes shelves
//
// Tapping any badge/prize calls `onSelectAward`; the parent owns the lightbox so
// it can cover the whole card (no nested modal). Content-only: the parent
// supplies the frame (accent bar, close button, padding).

import { Globe } from 'lucide-react'
import { PlayerAvatar } from './player-avatar'
import { ProfilePrizes } from './profile-prizes'
import { ProfileAwardBadges } from './profile-award-badges'
import { ProfileAvailability } from './profile-availability'
import type { AwardItem } from './award-lightbox'
import { XLogo } from '@/components/gallery/x-logo'
import { xProfileUrl, formatXLabel } from '@/lib/tournament/x-handle'
import { regionLabel } from '@/lib/tournament/region'
import { countryFlag, countryName } from '@/lib/wallet/country'
import type { WalletStanding } from '@/lib/wallet/db'

/** One cell in the segmented stat strip. */
function Stat({ value, label, accent }: { value: string | number; label: string; accent?: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, textAlign: 'center', padding: '11px 6px' }}>
      <div className="font-display tabular-nums" style={{ fontSize: 21, fontWeight: 800, color: accent ?? 'var(--text-primary)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)', marginTop: 5 }}>
        {label}
      </div>
    </div>
  )
}

export function ProfileBody({
  standing,
  onSelectAward,
}: {
  standing: WalletStanding
  onSelectAward: (item: AwardItem) => void
}) {
  const xUrl = standing.xHandle ? xProfileUrl(standing.xHandle) : ''
  const total = standing.wins + standing.losses + standing.draws
  const winRate = total > 0 ? Math.round((standing.wins / total) * 100) : 0

  // 3-5 numeric stats in one strip: instant "should I care?" social proof.
  const stats: { value: string | number; label: string; accent?: string }[] = [
    { value: standing.wins, label: 'Wins', accent: '#22c55e' },
    { value: standing.losses, label: 'Losses', accent: '#ef4444' },
    ...(standing.draws > 0 ? [{ value: standing.draws, label: 'Draws' }] : []),
    { value: `${winRate}%`, label: 'Win %', accent: 'var(--tcw-accent)' },
    { value: standing.tournamentsPlayed, label: standing.tournamentsPlayed === 1 ? 'Event' : 'Events' },
  ]

  return (
    <>
      {/* 1. Identity */}
      <div className="flex items-center gap-4">
        <PlayerAvatar
          username={standing.username}
          xHandle={standing.xHandle}
          avatarUrl={standing.avatarUrl}
          walletAddress={standing.walletAddress}
          size={72}
        />
        <div className="min-w-0">
          <h1 className="font-display flex items-center gap-2" style={{ fontSize: 23, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
            <span className="min-w-0 truncate">{standing.username ?? 'Anonymous player'}</span>
            {standing.country && (
              <span style={{ flexShrink: 0 }} title={countryName(standing.country)} aria-label={countryName(standing.country)}>
                {countryFlag(standing.country)}
              </span>
            )}
          </h1>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-1.5">
            {xUrl && (
              <a
                href={xUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm font-semibold"
                style={{ color: 'var(--text-secondary)' }}
              >
                <XLogo size={13} />
                {formatXLabel(standing.xHandle ?? '')}
              </a>
            )}
            {standing.region && (
              <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-muted)' }}>
                <Globe size={13} style={{ color: '#3b82f6' }} />
                {regionLabel(standing.region)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* 2. Stat bar - one segmented strip, dividers between cells. */}
      <div
        className="flex mt-5"
        style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 12, overflow: 'hidden' }}
      >
        {stats.map((s, i) => (
          <div key={s.label} style={{ flex: 1, minWidth: 0, borderLeft: i === 0 ? 'none' : '1px solid var(--border-subtle)' }}>
            <Stat value={s.value} label={s.label} accent={s.accent} />
          </div>
        ))}
      </div>

      {/* 3. Availability */}
      <ProfileAvailability availability={standing.availability} />

      {/* 4. Shelves: badges first, then prizes. Tap enlarges via the lightbox. */}
      <ProfileAwardBadges walletAddress={standing.walletAddress} onSelect={onSelectAward} />
      <ProfilePrizes walletAddress={standing.walletAddress} onSelect={onSelectAward} />
    </>
  )
}
