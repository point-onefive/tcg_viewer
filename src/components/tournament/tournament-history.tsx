'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, ChevronRight, Hash, Loader2, Swords, Trophy, Users } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { apiTournamentHistory } from '@/lib/tournament/client'
import { formatXLabel } from '@/lib/tournament/x-handle'
import type { CompletedTournamentSummary } from '@/lib/tournament/types'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
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
          <ul className="flex flex-col gap-2.5">
            {events.map((e) => (
              <li key={e.code}>
                <Link
                  href={`/tournaments/${encodeURIComponent(e.code)}`}
                  className="flex items-center gap-4 p-4 transition-colors"
                  style={{ ...card, textDecoration: 'none', color: 'var(--text-primary)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-display text-base font-bold">{e.name}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2">
                      <span
                        className="inline-flex items-center gap-1 text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Hash size={12} /> {e.code}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Swords size={12} /> {e.format === 'swiss' ? 'Swiss' : 'Single elim'}
                      </span>
                      <span
                        className="inline-flex items-center gap-1 text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <Users size={12} /> {e.playerCount}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {fmtDate(e.createdAt)}
                      </span>
                    </div>
                    {e.champion && (
                      <div className="mt-2 inline-flex items-center gap-1.5 text-sm">
                        <Trophy size={14} style={{ color: '#f5b301' }} aria-hidden />
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {formatXLabel(e.champion.xHandle || e.champion.displayName)}
                        </span>
                      </div>
                    )}
                  </div>
                  <ChevronRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </TournamentShell>
  )
}
