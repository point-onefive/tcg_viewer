'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Hash, ListChecks, Loader2, Swords, Trophy, Users } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { AwardedPrizesHistory, LeaderChip, RoundBoard, StandingsTable } from './tournament-live'
import { apiSnapshotByCode } from '@/lib/tournament/client'
import { deckCardCount } from '@/lib/tournament/deck-list'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import type { Player, TournamentSnapshot } from '@/lib/tournament/types'

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

  // Champion: standings rank 1 works for both single-elim and Swiss.
  const champion = useMemo(() => {
    const top = [...(snapshot?.standings ?? [])].sort((a, b) => a.rank - b.rank)[0]
    if (!top) return null
    return playerById.get(top.playerId) ?? null
  }, [snapshot, playerById])

  const standings = useMemo(
    () => [...(snapshot?.standings ?? [])].sort((a, b) => a.rank - b.rank),
    [snapshot],
  )

  // Competitors whose now-public deck lists are published (lists publish on
  // completion). Ordered by final placing so the winning decks lead.
  const decks = useMemo(() => {
    const order = [...(snapshot?.standings ?? [])].sort((a, b) => a.rank - b.rank)
    return order
      .map((s) => playerById.get(s.playerId))
      .filter((p): p is Player => Boolean(p && p.deckList && p.deckList.trim() !== ''))
  }, [snapshot, playerById])

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
                    <XLink handle={champion.xHandle || champion.displayName} />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* The real bracket / Swiss board + final standings - the identical
            component the live page uses, rendered read-only from the
            completed snapshot. Single-elim shows the bracket tree; Swiss shows
            round-by-round pairings plus the final standings table. */}
        {snapshot.matches.length > 0 && (
          <RoundBoard
            tournament={tournament}
            rounds={snapshot.rounds}
            matches={snapshot.matches}
            players={snapshot.players}
            activeRound={undefined}
          />
        )}

        {/* Final standings with a Deck (Leader) column - the cleanest read on
            deck performance. Swiss already renders this inside the board above,
            so only add it for single-elim (the bracket has no standings list). */}
        {tournament.format === 'single-elim' && (
          <StandingsTable standings={standings} nameById={playerById} complete />
        )}

        {/* Prizes that were actually handed out (frozen award snapshot, with
            their images preserved at award time). */}
        {awardedPrizes.length > 0 && (
          <div className="mt-6">
            <AwardedPrizesHistory awarded={awardedPrizes} />
          </div>
        )}

        {/* Public deck archive - the metagame record for this event. */}
        <div className="mt-6 p-5" style={card}>
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
                    <span className="flex min-w-0 items-center gap-2">
                      <XLink handle={p.xHandle || p.displayName} />
                      <LeaderChip player={p} />
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
