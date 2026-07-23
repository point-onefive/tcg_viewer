'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Hash, Loader2, Swords, Trophy, Users } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { AwardedPrizesHistory, RoundBoard, StandingsTable, XProfileLink } from './tournament-live'
import { apiSnapshotByCode } from '@/lib/tournament/client'
import { getTournamentTheme } from '@/lib/tournament/theme'
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
      <Icon size={13} style={{ color: 'var(--tcw-accent)' }} aria-hidden />
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

  if (error) {
    return (
      <TournamentShell>
        <div className="mx-auto" style={{ maxWidth: 1080 }}>
          <div className="mb-4">{backLink}</div>
          <div className="mx-auto max-w-md p-8 text-center" style={card}>
            <Trophy size={32} style={{ color: 'var(--tcw-accent)', margin: '0 auto 12px' }} />
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
  // Retain the event's own theme (palette, fonts, gradients, co-brand lockup)
  // instead of the generic surface, matching how the live page was themed.
  const theme = getTournamentTheme(tournament.theme)

  return (
    <TournamentShell theme={theme}>
      <div className="mx-auto" style={{ maxWidth: 1080 }}>
        <div className="mb-4">{backLink}</div>

        {/* Event hero */}
        <div className="mb-6 overflow-hidden" style={card}>
          <div
            style={{
              height: 3,
              background: 'linear-gradient(90deg, var(--tcw-accent), color-mix(in srgb, var(--tcw-accent) 35%, transparent))',
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
                    <XProfileLink
                      handle={champion.xHandle || champion.displayName}
                      username={champion.username}
                      avatarUrl={champion.avatarUrl}
                      walletAddress={champion.walletAddress}
                      country={champion.country}
                      avatarSize={24}
                    />
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

      </div>
    </TournamentShell>
  )
}
