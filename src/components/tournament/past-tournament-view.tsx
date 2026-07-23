'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronLeft, Hash, Loader2, Swords, Trophy, Users } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import {
  BonkFooter,
  BonkHero,
  HowItWorks,
  MetaChip,
  PollCard,
  PrizePool,
  RoundBoard,
  StandingsTable,
  StatusPill,
  XProfileLink,
} from './tournament-live'
import { BonkModuleHeader, BonkSceneBody } from '@/components/tournament/bonk-ui'
import { apiSnapshotByCode } from '@/lib/tournament/client'
import { getTournamentTheme } from '@/lib/tournament/theme'
import { DEFAULT_POLL_QUESTION, POLL_OPTIONS } from '@/lib/tournament/poll'
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

  // The competitor count is the actual field, matching the live page: rejected
  // and dropped sign-ups are out, so it counts only approved players who stayed
  // in. Using the raw players array over-counts (it includes rejected/dropped
  // rows that never really competed).
  const competitorCount = useMemo(
    () =>
      (snapshot?.players ?? []).filter(
        (p) => p.approvalStatus === 'approved' && !p.dropped,
      ).length,
    [snapshot?.players],
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
  // Retain the event's own theme (palette, fonts, gradients, hero, co-brand
  // lockup) and replay the same concluded layout the live page shows: full
  // hero banner, prize podium with winners, bracket/standings, poll results,
  // playbook, and footer - so revisiting a past event feels identical to how
  // it looked the day it wrapped.
  const theme = getTournamentTheme(tournament.theme)

  return (
    <TournamentShell theme={theme} hero={<BonkHero theme={theme} />}>
      <div className="mx-auto" style={{ maxWidth: 1080 }}>
        <div className="mb-4">{backLink}</div>

        {/* Event hero - themed module card, mirroring the live event header. */}
        <div className="mb-6 overflow-hidden" style={{ ...card, borderRadius: 16 }}>
          <BonkModuleHeader
            icon={Trophy}
            title={tournament.name}
            right={
              <span className="hidden sm:block">
                <StatusPill status={tournament.status} />
              </span>
            }
          />
          <BonkSceneBody
            scene={theme.scenes.eventDark ?? null}
            sceneLight={theme.scenes.eventLight ?? null}
            position="center 28%"
            className="p-5 sm:p-6"
          >
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
              <MetaChip icon={Hash} iconColor="var(--bonk-ui-yellow)">{tournament.code}</MetaChip>
              <MetaChip icon={Swords} iconColor="var(--bonk-ui-orange)">
                {tournament.format === 'swiss' ? 'Swiss' : 'Single elim'}
              </MetaChip>
              <MetaChip icon={Users} iconColor="#22c55e">
                {competitorCount}
                <span className="hidden sm:inline"> competitors</span>
              </MetaChip>
              <MetaChip icon={Trophy} iconColor="var(--bonk-pink)">
                {fmtDate(tournament.createdAt)}
              </MetaChip>
            </div>

            {champion && (
              <div
                className="mt-5 flex items-center gap-3 rounded-md p-3.5"
                style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', border: '1px solid #f5b301' }}
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

            {tournament.rules && (
              <p
                className="mt-5 whitespace-pre-wrap rounded-md p-3.5 text-sm"
                style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', lineHeight: 1.5 }}
              >
                {tournament.rules}
              </p>
            )}
          </BonkSceneBody>
        </div>

        {/* Prize pool podium - the branded prize cards with the winners folded
            in (the same view the live page shows at conclusion). */}
        {tournament.prizes.length > 0 && (
          <PrizePool
            prizes={tournament.prizes}
            awarded={awardedPrizes}
            lockup={theme.prizePoolLockup}
            scene={theme.scenes.prizeDark}
          />
        )}

        {/* The real bracket / Swiss board + final standings - the identical
            component the live page uses, rendered read-only from the completed
            snapshot. */}
        {snapshot.matches.length > 0 && (
          <RoundBoard
            tournament={tournament}
            rounds={snapshot.rounds}
            matches={snapshot.matches}
            players={snapshot.players}
            activeRound={undefined}
          />
        )}

        {/* Final standings with a Deck (Leader) column for single-elim (Swiss
            already renders standings inside the board above). */}
        {tournament.format === 'single-elim' && (
          <StandingsTable standings={standings} nameById={playerById} complete />
        )}

        {/* Community poll - final results, read-only. */}
        <PollCard
          code={tournament.code}
          poll={snapshot.poll}
          question={tournament.pollQuestion ?? DEFAULT_POLL_QUESTION}
          options={tournament.pollOptions ?? POLL_OPTIONS}
          canVote={false}
          signedUp={false}
          pollOpen={false}
          onVoted={() => {}}
        />

        {/* Playbook + closing co-brand strip, same as the live page. */}
        <HowItWorks theme={theme} />
        <BonkFooter theme={theme} />
      </div>
    </TournamentShell>
  )
}
