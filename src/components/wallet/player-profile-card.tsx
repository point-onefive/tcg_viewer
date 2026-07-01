import Link from 'next/link'
import { ArrowLeft, Trophy, Globe } from 'lucide-react'
import { PlayerAvatar } from './player-avatar'
import { ProfilePrizes } from './profile-prizes'
import { ProfileAwardBadges } from './profile-award-badges'
import { ProfileAvailability } from './profile-availability'
import { XLogo } from '@/components/gallery/x-logo'
import { xProfileUrl, formatXLabel } from '@/lib/tournament/x-handle'
import { regionLabel } from '@/lib/tournament/region'
import { countryFlag, countryName } from '@/lib/wallet/country'
import type { WalletStanding } from '@/lib/wallet/db'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
  boxShadow: 'var(--shadow-card)',
}

function StatBlock({ value, label, accent }: { value: number; label: string; accent?: string }) {
  return (
    <div
      style={{
        flex: 1,
        textAlign: 'center',
        padding: '14px 8px',
        background: 'var(--bg)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 10,
      }}
    >
      <div className="font-display" style={{ fontSize: 26, fontWeight: 800, color: accent ?? 'var(--text-primary)', lineHeight: 1 }}>
        {value}
      </div>
      <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginTop: 6 }}>
        {label}
      </div>
    </div>
  )
}

/** Presentational player profile. Public, shareable. */
export function PlayerProfileCard({ standing }: { standing: WalletStanding }) {
  const xUrl = standing.xHandle ? xProfileUrl(standing.xHandle) : ''
  const total = standing.wins + standing.losses + standing.draws
  const winRate = total > 0 ? Math.round((standing.wins / total) * 100) : 0

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text-primary)' }}>
      <div className="mx-auto px-4 py-10" style={{ maxWidth: 520 }}>
        <Link
          href="/tournaments"
          className="inline-flex items-center gap-1.5 text-sm font-semibold mb-6"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={15} /> Tournaments
        </Link>

        <div style={card}>
          <div style={{ height: 4, background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))', borderRadius: '12px 12px 0 0' }} />

          <div className="p-6 sm:p-8">
            {/* Identity */}
            <div className="flex items-center gap-4">
              <PlayerAvatar
                username={standing.username}
                xHandle={standing.xHandle}
                avatarUrl={standing.avatarUrl}
                walletAddress={standing.walletAddress}
                size={72}
              />
              <div className="min-w-0">
                <h1 className="font-display flex items-center gap-2" style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.1 }}>
                  <span className="min-w-0 truncate">{standing.username ?? 'Anonymous player'}</span>
                  {standing.country && (
                    <span style={{ flexShrink: 0 }} title={countryName(standing.country)} aria-label={countryName(standing.country)}>
                      {countryFlag(standing.country)}
                    </span>
                  )}
                </h1>
                {xUrl && (
                  <a
                    href={xUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-1.5 text-sm font-semibold"
                    style={{ color: 'var(--text-secondary)' }}
                  >
                    <XLogo size={13} />
                    {formatXLabel(standing.xHandle ?? '')}
                  </a>
                )}
              </div>
            </div>

            {/* Record */}
            <div className="flex gap-2.5 mt-6">
              <StatBlock value={standing.wins} label="Wins" accent="#22c55e" />
              <StatBlock value={standing.losses} label="Losses" accent="#ef4444" />
              {standing.draws > 0 && <StatBlock value={standing.draws} label="Draws" />}
            </div>

            {/* Secondary stats */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mt-5 text-sm" style={{ color: 'var(--text-secondary)' }}>
              <span className="inline-flex items-center gap-1.5">
                <Trophy size={14} style={{ color: '#E85D2A' }} />
                {standing.tournamentsPlayed} tournament{standing.tournamentsPlayed === 1 ? '' : 's'} played
              </span>
              {total > 0 && (
                <span>
                  <strong style={{ color: 'var(--text-primary)' }}>{winRate}%</strong> win rate
                </span>
              )}
              {standing.region && (
                <span className="inline-flex items-center gap-1.5">
                  <Globe size={14} style={{ color: '#3b82f6' }} />
                  {regionLabel(standing.region)}
                </span>
              )}
              {standing.country && (
                <span className="inline-flex items-center gap-1.5">
                  <span aria-hidden>{countryFlag(standing.country)}</span>
                  {countryName(standing.country)}
                </span>
              )}
            </div>

            {/* Availability: self-declared play hours, converted to viewer's tz */}
            <ProfileAvailability availability={standing.availability} />

            {/* Two uniform shelves (always rendered): prizes and badges. Placement
                lives in the badges now (king/silver/bronze); click a prize or
                badge to open that event's past-event page. */}
            <ProfilePrizes walletAddress={standing.walletAddress} />
            <ProfileAwardBadges walletAddress={standing.walletAddress} />
          </div>
        </div>
      </div>
    </div>
  )
}
