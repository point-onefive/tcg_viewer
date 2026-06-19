'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Hash, ListChecks, Loader2, Swords, Trophy, Users } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { apiSnapshotByCode } from '@/lib/tournament/client'
import { deckCardCount } from '@/lib/tournament/deck-list'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import type { Player, StandingRow, TournamentSnapshot } from '@/lib/tournament/types'

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
      month: 'long',
      day: 'numeric',
    })
  } catch {
    return ''
  }
}

function XLink({ handle }: { handle: string }) {
  const url = xProfileUrl(handle)
  const label = formatXLabel(handle)
  if (!url) return <span style={{ fontWeight: 600 }}>{label}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}
    >
      {label}
    </a>
  )
}

function placeAccent(rank: number): { bg: string; fg: string } {
  if (rank === 1) return { bg: '#f5b301', fg: '#1a1a1a' }
  if (rank === 2) return { bg: '#c4cad3', fg: '#1a1a1a' }
  if (rank === 3) return { bg: '#cd7f32', fg: '#fff' }
  return { bg: 'color-mix(in srgb, var(--text-primary) 14%, transparent)', fg: 'var(--text-primary)' }
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
        padding: '4px 8px',
      }}
    >
      <Icon size={13} style={{ color: '#E85D2A' }} aria-hidden />
      {children}
    </span>
  )
}

const backLink = (
  <Link
    href="/tournaments/history"
    className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
    style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
  >
    <ChevronLeft size={16} aria-hidden /> All past events
  </Link>
)

export function PastTournamentView({ code }: { code: string }) {
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    setSnapshot(null)
    setError(null)
    apiSnapshotByCode(code)
      .then((s) => {
        if (alive) setSnapshot(s)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : 'Could not load this event.')
      })
    return () => {
      alive = false
    }
  }, [code])

  const playerById = useMemo(() => {
    const m = new Map<string, Player>()
    for (const p of snapshot?.players ?? []) m.set(p.id, p)
    return m
  }, [snapshot])

  const standings: StandingRow[] = useMemo(
    () => [...(snapshot?.standings ?? [])].sort((a, b) => a.rank - b.rank),
    [snapshot],
  )

  const champion = standings.find((s) => s.rank === 1) ?? null
  const handleFor = (s: StandingRow): string =>
    playerById.get(s.playerId)?.xHandle || s.displayName

  // Competitors that have a now-public deck list (events publish lists on
  // completion). Ordered by final standings so the winning decks lead.
  const decks = useMemo(() => {
    return standings
      .map((s) => playerById.get(s.playerId))
      .filter((p): p is Player => Boolean(p && p.deckList && p.deckList.trim() !== ''))
  }, [standings, playerById])

  if (error) {
    return (
      <TournamentShell>
        <div className="mx-auto" style={{ maxWidth: 1080 }}>
          <div className="mb-4">{backLink}</div>
          <div className="mx-auto max-w-md p-8 text-center" style={card}>
            <Trophy size={32} style={{ color: '#E85D2A', margin: '0 auto 12px' }} />
            <p className="font-display text-lg font-bold">Event not found</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {error}
            </p>
          </div>
        </div>
      </TournamentShell>
    )
  }

  if (!snapshot) {
    return (
      <TournamentShell>
        <div className="flex justify-center gap-2 py-20" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      </TournamentShell>
    )
  }

  const { tournament, awardedPrizes } = snapshot

  return (
    <TournamentShell>
      <div className="mx-auto" style={{ maxWidth: 1080 }}>
        <div className="mb-4">{backLink}</div>

        {/* Event hero */}
        <div className="mb-6 overflow-hidden" style={card}>
          <div
            style={{
              height: 3,
              background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))',
            }}
          />
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-2xl font-bold leading-none tracking-tight sm:text-3xl">
                {tournament.name}
              </h2>
              <span
                style={{
                  background: 'rgba(120,120,120,0.18)',
                  color: 'var(--text-secondary)',
                  fontSize: 11,
                  fontWeight: 800,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  padding: '3px 9px',
                  borderRadius: 5,
                }}
              >
                Complete
              </span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <MetaChip icon={Hash}>{tournament.code}</MetaChip>
              <MetaChip icon={Swords}>
                {tournament.format === 'swiss' ? 'Swiss' : 'Single elim'}
              </MetaChip>
              <MetaChip icon={Users}>{snapshot.players.length} competitors</MetaChip>
              <MetaChip icon={Trophy}>{fmtDate(tournament.createdAt)}</MetaChip>
            </div>

            {champion && (
              <div
                className="mt-5 flex items-center gap-3 rounded-md p-3.5"
                style={{ background: 'var(--bg)', border: '1px solid #f5b301' }}
              >
                <Trophy size={20} style={{ color: '#f5b301' }} aria-hidden />
                <div>
                  <div
                    className="text-xs font-bold uppercase tracking-wider"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    Champion
                  </div>
                  <div className="text-base font-bold">
                    <XLink handle={handleFor(champion)} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Final standings */}
        <div className="mb-6 p-5" style={card}>
          <div className="mb-4 flex items-center gap-2">
            <Trophy size={16} style={{ color: '#E85D2A' }} />
            <h3 className="font-display font-bold">Final standings</h3>
          </div>
          {standings.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No standings were recorded for this event.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {standings.map((s) => {
                const accent = placeAccent(s.rank)
                return (
                  <li
                    key={s.playerId}
                    className="flex items-center gap-3 rounded-md p-2.5"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
                  >
                    <span
                      className="inline-flex items-center justify-center font-display text-xs font-bold tabular-nums"
                      style={{
                        minWidth: 26,
                        height: 26,
                        borderRadius: 5,
                        background: accent.bg,
                        color: accent.fg,
                      }}
                    >
                      {s.rank}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm">
                      <XLink handle={handleFor(s)} />
                      {s.dropped && (
                        <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                          (dropped)
                        </span>
                      )}
                    </span>
                    <span
                      className="text-xs tabular-nums"
                      style={{ color: 'var(--text-secondary)' }}
                    >
                      {s.wins}-{s.losses}
                      {s.draws > 0 ? `-${s.draws}` : ''}
                    </span>
                    <span
                      className="text-xs font-bold tabular-nums"
                      style={{ color: 'var(--text-primary)', minWidth: 44, textAlign: 'right' }}
                    >
                      {s.points} pts
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {/* Awarded prizes */}
        {awardedPrizes.length > 0 && (
          <div className="mb-6 p-5" style={card}>
            <div className="mb-4 flex items-center gap-2">
              <Trophy size={16} style={{ color: '#E85D2A' }} />
              <h3 className="font-display font-bold">Prizes awarded</h3>
            </div>
            <ul className="flex flex-col gap-2">
              {awardedPrizes.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-3 rounded-md p-3"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-bold">{a.title}</div>
                    {a.description && (
                      <div className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                        {a.description}
                      </div>
                    )}
                  </div>
                  {a.xHandle && (
                    <span className="text-sm">
                      <XLink handle={a.xHandle} />
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Public deck archive */}
        <div className="p-5" style={card}>
          <div className="mb-1 flex items-center gap-2">
            <ListChecks size={16} style={{ color: '#E85D2A' }} />
            <h3 className="font-display font-bold">Deck lists</h3>
          </div>
          <p className="mb-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            Deck lists stay private during play and are published once the event
            ends. Ordered by final placing.
          </p>
          {decks.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No deck lists were published for this event.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {decks.map((p) => (
                <details
                  key={p.id}
                  className="rounded-md"
                  style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
                >
                  <summary
                    className="flex cursor-pointer items-center justify-between gap-3 p-3 text-sm"
                    style={{ listStyle: 'none' }}
                  >
                    <span className="min-w-0 truncate font-semibold">
                      {formatXLabel(p.xHandle || p.displayName)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {deckCardCount(p.deckList ?? '')} cards
                    </span>
                  </summary>
                  <pre
                    className="max-h-72 overflow-auto whitespace-pre-wrap p-3 text-xs"
                    style={{
                      borderTop: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      fontFamily: 'var(--font-mono, monospace)',
                    }}
                  >
                    {p.deckList}
                  </pre>
                </details>
              ))}
            </div>
          )}
        </div>
      </div>
    </TournamentShell>
  )
}
