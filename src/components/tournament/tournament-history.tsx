'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Hash, Loader2, Swords, Trophy, Users } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { apiTournamentHistory } from '@/lib/tournament/client'
import { normalizeXHandle } from '@/lib/tournament/x-handle'
import { PlayerAvatar } from '@/components/wallet/player-avatar'
import { countryFlag } from '@/lib/wallet/country'
import type { CompletedTournamentSummary } from '@/lib/tournament/types'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
}

function MetaChip({ icon: Icon, children }: { icon: typeof Hash; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs font-semibold"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-secondary)',
        borderRadius: 5,
        padding: '3px 7px',
      }}
    >
      <Icon size={12} style={{ color: 'var(--tcw-accent)' }} aria-hidden />
      {children}
    </span>
  )
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

export function TournamentHistory() {
  const [events, setEvents] = useState<CompletedTournamentSummary[] | null>(null)

  useEffect(() => {
    let alive = true
    apiTournamentHistory().then((list) => {
      if (alive) setEvents(list)
    })
    return () => {
      alive = false
    }
  }, [])

  return (
    <TournamentShell>
      <div className="mx-auto" style={{ maxWidth: 880 }}>
        <div className="mb-4">
          <Link
            href="/tournaments"
            className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
          >
            <ChevronLeft size={16} aria-hidden /> Current tournament
          </Link>
        </div>

        <div className="mb-6 flex items-center gap-2">
          <Trophy size={20} style={{ color: 'var(--tcw-accent)' }} />
          <h2 className="font-display text-2xl font-bold tracking-tight">Past events</h2>
        </div>

        {events === null ? (
          <div className="flex justify-center gap-2 py-16" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={18} className="animate-spin" /> Loading…
          </div>
        ) : events.length === 0 ? (
          <div className="p-8 text-center" style={card}>
            <p className="font-display text-lg font-bold">No past events yet</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Completed tournaments will be archived here, with final standings and
              published deck lists.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((e) => {
              const champName =
                e.champion &&
                (e.champion.username?.trim() ||
                  normalizeXHandle(e.champion.xHandle || e.champion.displayName))
              return (
                <li key={e.code}>
                  <Link
                    href={`/tournaments/${encodeURIComponent(e.code)}`}
                    className="group block overflow-hidden transition-colors hover:border-[color:var(--tcw-accent)]"
                    style={{ ...card, textDecoration: 'none', color: 'var(--text-primary)' }}
                  >
                    <div
                      style={{
                        height: 3,
                        background:
                          'linear-gradient(90deg, var(--tcw-accent), color-mix(in srgb, var(--tcw-accent) 30%, transparent))',
                      }}
                    />
                    <div className="flex items-center gap-4 p-4">
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-display text-base font-bold sm:text-lg">{e.name}</div>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <MetaChip icon={Hash}>{e.code}</MetaChip>
                          <MetaChip icon={Swords}>{e.format === 'swiss' ? 'Swiss' : 'Single elim'}</MetaChip>
                          <MetaChip icon={Users}>{e.playerCount}</MetaChip>
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                            {fmtDate(e.createdAt)}
                          </span>
                        </div>
                        {e.champion && (
                          <div
                            className="mt-3 inline-flex items-center gap-2 rounded-md px-2.5 py-1.5"
                            style={{
                              background: 'color-mix(in srgb, #f5b301 10%, var(--bg))',
                              border: '1px solid color-mix(in srgb, #f5b301 35%, var(--border-subtle))',
                            }}
                          >
                            <Trophy size={13} style={{ color: '#f5b301', flexShrink: 0 }} aria-hidden />
                            <span
                              className="text-[10px] font-bold uppercase tracking-widest"
                              style={{ color: 'var(--text-muted)' }}
                            >
                              Champion
                            </span>
                            <PlayerAvatar
                              username={e.champion.username}
                              xHandle={e.champion.xHandle}
                              avatarUrl={e.champion.avatarUrl}
                              walletAddress={e.champion.walletAddress ?? undefined}
                              size={20}
                            />
                            <span className="truncate text-sm font-semibold" style={{ maxWidth: 180 }}>
                              {champName}
                            </span>
                            {e.champion.country && (
                              <span aria-hidden style={{ flexShrink: 0, lineHeight: 1 }}>
                                {countryFlag(e.champion.country)}
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                      <ChevronRight
                        size={18}
                        className="transition-transform group-hover:translate-x-0.5"
                        style={{ color: 'var(--text-muted)', flexShrink: 0 }}
                      />
                    </div>
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </TournamentShell>
  )
}
