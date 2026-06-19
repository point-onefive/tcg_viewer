'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarClock, Check, ChevronRight, Gift, Hash, ListChecks, Loader2, PieChart, Swords, Trophy, UserPlus, Users, Wallet, X } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import {
  apiActiveSnapshot,
  apiCastVote,
  apiEnroll,
  apiOwnDeck,
  apiSubmitDeckList,
  apiReportResult,
  loadVotedChoice,
  loadVoterId,
  saveVotedChoice,
} from '@/lib/tournament/client'
import { POLL_OPTIONS, type PollResults } from '@/lib/tournament/poll'
import { deckCardCount, MAX_DECK_CHARS } from '@/lib/tournament/deck-list'
import { XLogo } from '@/components/gallery/x-logo'
import { DiscordLogo } from '@/components/tournament/discord-logo'
import { Leaderboard } from '@/components/wallet/leaderboard'
import { ModalPortal } from '@/components/ui/modal-portal'
import { WaitlistCard } from '@/components/tournament/waitlist-card'
import { WalletConnectButton } from '@/components/wallet/wallet-connect-button'
import { PlayerProfileModal } from '@/components/wallet/player-profile-modal'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import { computeStandings } from '@/lib/tournament/pairing'
import type { Match, Player, Round, StandingRow, Tournament, TournamentPrize, TournamentSnapshot, AwardedPrize } from '@/lib/tournament/types'

const POLL_MS = 12_000
const SIGNED_UP_KEY = 'tcw_tournament_signed_up'
// Minimum competitors to reveal before the "Load more" toggle. The actual
// cap is rounded UP from this to a whole number of grid rows (see useRosterCap)
// so the collapsed roster never leaves an orphaned, half-empty last row.
const ROSTER_MIN_VISIBLE = 5

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
}

function fmtCountdown(iso: string | null): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return '0:00:00'
  const s = Math.floor(diff / 1000)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

function useCountdown(iso: string | null) {
  const [label, setLabel] = useState(() => fmtCountdown(iso))
  useEffect(() => {
    setLabel(fmtCountdown(iso))
    const t = setInterval(() => setLabel(fmtCountdown(iso)), 1000)
    return () => clearInterval(t)
  }, [iso])
  return label
}

function XProfileLink({ handle, className }: { handle: string; className?: string }) {
  const url = xProfileUrl(handle)
  if (!url) return <span className={className}>{formatXLabel(handle)}</span>
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={className}
      style={{ color: 'var(--text-primary)', fontWeight: 600, textDecoration: 'none' }}
    >
      {formatXLabel(handle)}
    </a>
  )
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string; breathe?: boolean }> = {
    enrolling: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Sign-ups open' },
    running: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Round in progress', breathe: true },
    complete: { bg: 'rgba(120,120,120,0.18)', fg: 'var(--text-secondary)', label: 'Complete' },
  }
  const s = map[status] ?? map.complete
  return (
    <span
      className={s.breathe ? 'status-pill-breathe' : undefined}
      style={{
        background: s.bg,
        color: s.fg,
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '3px 9px',
        borderRadius: 5,
      }}
    >
      {s.label}
    </span>
  )
}

/** Medal accent for a placing badge (top 3 get gold/silver/bronze). */
function placeAccent(i: number): { bg: string; fg: string } {
  if (i === 0) return { bg: '#f5b301', fg: '#1a1a1a' }
  if (i === 1) return { bg: '#c4cad3', fg: '#1a1a1a' }
  if (i === 2) return { bg: '#cd7f32', fg: '#fff' }
  return { bg: 'color-mix(in srgb, var(--text-primary) 14%, transparent)', fg: 'var(--text-primary)' }
}

/** Small labeled fact chip used in the event hero meta row. */
function MetaChip({
  icon: Icon,
  children,
  hideOnMobile = false,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  children: React.ReactNode
  /** Drop the chip below `sm` so the meta row stays on one mobile line. */
  hideOnMobile?: boolean
}) {
  return (
    <span
      className={`${hideOnMobile ? 'hidden sm:inline-flex' : 'inline-flex'} items-center gap-1 px-2 py-0.5 text-[11px] font-semibold sm:gap-1.5 sm:px-2.5 sm:py-1 sm:text-xs`}
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 5, color: 'var(--text-secondary)' }}
    >
      <Icon size={12} style={{ color: 'var(--text-muted)' }} />
      {children}
    </span>
  )
}

/** Framed countdown stat (sign-ups closing / round ending). */
function CountdownStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="w-full shrink-0 px-4 py-2.5 text-center sm:w-auto"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6, minWidth: 132 }}
    >
      <div className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>
        {label}
      </div>
      <div className="font-display text-2xl font-bold tabular-nums leading-tight" style={{ color: '#E85D2A' }}>
        {value}
      </div>
    </div>
  )
}

/** Solid medal color for a placing (top 3 get gold/silver/bronze). */
function medalColor(i: number): string | null {
  if (i === 0) return '#f5b301'
  if (i === 1) return '#c4cad3'
  if (i === 2) return '#cd7f32'
  return null
}

/** Public, read-only prize pool. Centered, medal-accented showcase. */
function PrizePool({ prizes }: { prizes: TournamentPrize[] }) {
  return (
    <div className="mb-6 p-5" style={card}>
      <div className="flex items-center justify-center gap-2 mb-4">
        <Gift size={18} style={{ color: '#E85D2A' }} />
        <h3 className="font-display text-lg font-bold tracking-tight">Prize pool</h3>
      </div>
      <div
        className="flex flex-wrap justify-center"
        style={{ gap: 16, maxWidth: 800, margin: '0 auto' }}
      >
        {prizes.map((prize, i) => {
          const accent = placeAccent(i)
          const medal = medalColor(i)
          return (
            <div
              key={i}
              className="flex flex-col overflow-hidden"
              style={{
                width: 'min(100%, 240px)',
                flex: '0 0 auto',
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderTop: `3px solid ${medal ?? 'var(--border-subtle)'}`,
                borderRadius: 6,
                boxShadow: medal ? `0 0 0 1px color-mix(in srgb, ${medal} 30%, transparent)` : 'none',
              }}
            >
              {prize.image && (
                // Preserve the original aspect ratio (no crop). Capped height
                // keeps the section compact; contain letterboxes any shape.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={prize.image}
                  alt={prize.title}
                  style={{
                    width: '100%',
                    maxHeight: 160,
                    objectFit: 'contain',
                    display: 'block',
                    background: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                />
              )}
              <div className="flex flex-col gap-1.5 p-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center justify-center font-display text-[11px] font-bold"
                    style={{ minWidth: 22, height: 22, borderRadius: 5, background: accent.bg, color: accent.fg }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-display font-bold text-sm">{prize.title}</span>
                </div>
                {prize.description && (
                  <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {prize.description}
                  </p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Public, read-only history of the prizes that were actually handed out, shown
 * only once an event is complete and its prizes have been resolved to winners.
 * Reads the frozen award snapshot (never the live pool), grouped by prize slot
 * so a single prize split across several winners renders as one card.
 */
function AwardedPrizesHistory({ awarded }: { awarded: AwardedPrize[] }) {
  // Group by slot so one prize with many winners is a single card.
  const groups = useMemo(() => {
    const bySlot = new Map<number, AwardedPrize[]>()
    for (const a of awarded) {
      const arr = bySlot.get(a.slotIndex) ?? []
      arr.push(a)
      bySlot.set(a.slotIndex, arr)
    }
    return Array.from(bySlot.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([slotIndex, winners]) => ({ slotIndex, winners }))
  }, [awarded])

  if (groups.length === 0) return null

  return (
    <div className="mb-6 p-5" style={card}>
      <div className="flex items-center justify-center gap-2 mb-1.5">
        <Trophy size={18} style={{ color: '#f5b301' }} />
        <h3 className="font-display text-lg font-bold tracking-tight">Prizes awarded</h3>
      </div>
      <p className="text-center text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Final results - the prizes handed out for this event.
      </p>
      <div className="flex flex-wrap justify-center" style={{ gap: 16, maxWidth: 820, margin: '0 auto' }}>
        {groups.map(({ slotIndex, winners }) => {
          const medal = medalColor(slotIndex)
          const sample = winners[0]
          return (
            <div
              key={slotIndex}
              className="flex flex-col overflow-hidden"
              style={{
                width: 'min(100%, 240px)',
                flex: '0 0 auto',
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderTop: `3px solid ${medal ?? 'var(--border-subtle)'}`,
                borderRadius: 6,
                boxShadow: medal ? `0 0 0 1px color-mix(in srgb, ${medal} 30%, transparent)` : 'none',
              }}
            >
              {sample.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sample.image}
                  alt={sample.title}
                  style={{
                    width: '100%',
                    maxHeight: 160,
                    objectFit: 'contain',
                    display: 'block',
                    background: 'var(--bg-surface)',
                    borderBottom: '1px solid var(--border-subtle)',
                  }}
                />
              )}
              <div className="flex flex-col gap-2 p-3">
                <div className="flex items-center gap-2">
                  <span
                    className="inline-flex items-center justify-center font-display text-[11px] font-bold"
                    style={{ minWidth: 22, height: 22, borderRadius: 5, background: placeAccent(slotIndex).bg, color: placeAccent(slotIndex).fg }}
                  >
                    {slotIndex + 1}
                  </span>
                  <span className="font-display font-bold text-sm">{sample.title}</span>
                </div>
                {sample.description && (
                  <p className="text-xs whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    {sample.description}
                  </p>
                )}
                <div className="flex flex-col gap-1 pt-1" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                  <span className="text-[10px] uppercase tracking-wide font-bold" style={{ color: 'var(--text-muted)' }}>
                    {winners.length > 1 ? 'Winners' : 'Winner'}
                  </span>
                  {winners.map((w) => (
                    <span key={w.id} className="text-xs font-semibold">
                      {w.xHandle ? (
                        <XProfileLink handle={w.xHandle} />
                      ) : (
                        <span style={{ color: 'var(--text-primary)' }}>{w.displayName ?? 'Player'}</span>
                      )}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Win / Loss (/ Draw for Swiss) report buttons shared across card states. */
function ReportButtons({
  busy,
  onReport,
  allowDraw,
}: {
  busy: 'win' | 'loss' | 'draw' | null
  onReport: (r: 'win' | 'loss' | 'draw') => void
  allowDraw: boolean
}) {
  const btn = (
    result: 'win' | 'loss' | 'draw',
    label: string,
    accent: string,
  ) => (
    <button
      type="button"
      disabled={busy !== null}
      onClick={() => onReport(result)}
      className="footer-btn inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-bold"
      style={{
        flex: 1,
        minWidth: 96,
        borderRadius: 8,
        background: `color-mix(in srgb, ${accent} 12%, var(--bg-surface))`,
        border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
        color: accent,
        opacity: busy !== null && busy !== result ? 0.5 : 1,
        cursor: busy !== null ? 'default' : 'pointer',
      }}
    >
      {busy === result ? <Loader2 size={15} className="animate-spin" /> : null}
      {label}
    </button>
  )
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {btn('win', 'I won', '#22c55e')}
      {btn('loss', 'I lost', '#ef4444')}
      {allowDraw && btn('draw', 'Draw', '#a3a3a3')}
    </div>
  )
}

/**
 * Player-facing result reporting for the signed-in player's current match.
 * Both players self-report; matching verdicts auto-confirm and advance the
 * bracket, a conflict flags the match for admin review, and a single report
 * holds provisionally until the opponent confirms.
 */
function MyMatchCard({
  code,
  match,
  myPlayerId,
  opponent,
  format,
  onReported,
}: {
  code: string
  match: Match
  myPlayerId: string
  opponent: Player | null
  format: Tournament['format']
  onReported: () => Promise<void> | void
}) {
  const [busy, setBusy] = useState<'win' | 'loss' | 'draw' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const isP1 = match.player1Id === myPlayerId
  const myReport = isP1 ? match.player1Report : match.player2Report
  const theirReport = isP1 ? match.player2Report : match.player1Report
  const oppLabel = opponent ? formatXLabel(opponent.xHandle) : 'your opponent'

  const report = useCallback(
    async (result: 'win' | 'loss' | 'draw') => {
      setBusy(result)
      setError(null)
      try {
        await apiReportResult(code, match.id, result)
        await onReported()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not report result')
      } finally {
        setBusy(null)
      }
    },
    [code, match.id, onReported],
  )

  const shell = (accent: string, children: React.ReactNode) => (
    <div className="mb-6 overflow-hidden" style={card}>
      <div style={{ height: 3, background: `linear-gradient(90deg, ${accent}, color-mix(in srgb, ${accent} 35%, transparent))` }} />
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  )

  const header = (
    <div className="flex items-center gap-2 mb-1">
      <Swords size={18} style={{ color: '#E85D2A' }} />
      <h3 className="font-display text-lg font-bold tracking-tight">Your match</h3>
    </div>
  )

  const vsLine = (
    <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
      vs{' '}
      {opponent ? (
        <XProfileLink handle={opponent.xHandle} className="font-semibold" />
      ) : (
        <span className="font-semibold">{oppLabel}</span>
      )}
    </p>
  )

  // Bye - nothing to report.
  if (!match.player2Id || match.status === 'bye') {
    return shell('#22c55e', (
      <>
        {header}
        <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
          You have a bye this round and advance automatically.
        </p>
      </>
    ))
  }

  // Finalized.
  if (match.status === 'confirmed') {
    const draw = match.winnerId === null
    const iWon = match.winnerId === myPlayerId
    const accent = draw ? '#a3a3a3' : iWon ? '#22c55e' : '#ef4444'
    const label = draw ? 'Draw' : iWon ? 'You won' : 'You lost'
    return shell(accent, (
      <>
        {header}
        {vsLine}
        <div className="mt-3 inline-flex items-center gap-2 rounded-md px-3 py-2"
          style={{ background: `color-mix(in srgb, ${accent} 12%, var(--bg))`, border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)` }}>
          <Check size={16} style={{ color: accent }} />
          <span className="font-display font-bold text-sm" style={{ color: accent }}>{label}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· result confirmed</span>
        </div>
      </>
    ))
  }

  // Reports conflict - admin review.
  if (match.status === 'disputed') {
    return shell('#f59e0b', (
      <>
        {header}
        {vsLine}
        <p className="mt-3 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Your reports don&rsquo;t match, so an admin will review and finalize this
          match. No further action needed for now.
        </p>
      </>
    ))
  }

  // I already reported - waiting on my opponent.
  if (myReport) {
    const mine = myReport === 'win' ? 'a win' : myReport === 'loss' ? 'a loss' : 'a draw'
    return shell('#E85D2A', (
      <>
        {header}
        {vsLine}
        <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 size={15} className="animate-spin" style={{ color: '#E85D2A' }} />
          You reported {mine}. Waiting for {oppLabel} to confirm.
        </div>
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Made a mistake? Re-report below to correct it.
        </p>
        <ReportButtons busy={busy} onReport={report} allowDraw={format === 'swiss'} />
        {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
      </>
    ))
  }

  // Default: opponent may have reported; show the buttons.
  return shell('#E85D2A', (
    <>
      {header}
      {vsLine}
      {theirReport && (
        <p className="mt-3 rounded-md px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, #E85D2A 8%, var(--bg))', border: '1px solid color-mix(in srgb, #E85D2A 22%, transparent)', color: 'var(--text-secondary)' }}>
          {oppLabel} reported {theirReport === 'win' ? 'a win' : theirReport === 'loss' ? 'a loss' : 'a draw'}. Report your result to confirm - if it matches, the bracket advances right away.
        </p>
      )}
      <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        How did your match go?
      </p>
      <ReportButtons busy={busy} onReport={report} allowDraw={format === 'swiss'} />
      {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
    </>
  ))
}

/** Punchy "how the event runs" explainer so there are no surprises. */
function HowItWorks() {
  const discordUrl = 'https://discord.gg/9meqsjre'
  const steps: { lead: React.ReactNode; body: React.ReactNode; danger?: boolean }[] = [
    {
      lead: 'Join the waitlist',
      body: 'Between events, connect your wallet to claim a spot for the next one. When it opens you are dropped in automatically, so there is no timer to watch.',
    },
    {
      lead: 'Sign up',
      body: 'When an event is live, connect your wallet during the sign-up window to enter. Your X handle is pulled straight from your profile, so there is nothing to retype.',
    },
    {
      lead: 'Get verified',
      body: 'An admin approves every handle. Once you\u2019re in, you can vote on the prize split.',
    },
    { lead: 'Round 1 posts', body: 'When sign-ups close, the bracket goes live automatically.' },
    {
      lead: (
        <>
          Play on{' '}
          <a href="https://optcgsim.com/" target="_blank" rel="noopener noreferrer" style={{ color: '#E85D2A' }}>
            OPTCG Sim
          </a>
        </>
      ),
      body: 'Coordinate with your opponent and always play the most recent ruleset. Each round gets a generous timer for completion.',
    },
    {
      lead: 'Report results',
      body: 'After your match, both players tap Win or Loss on the "Your match" card. If you agree, it logs instantly and the bracket advances. If you disagree, an admin reviews it.',
    },
    {
      lead: 'Play fair',
      body: 'Any foul play or suspected cheating is a permanent ban.',
      danger: true,
    },
  ]
  return (
    <div className="mb-6 overflow-hidden" style={card}>
      <div style={{ height: 3, background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))' }} />
      <div className="p-5 sm:p-6">
        <div className="flex items-center gap-2 mb-4">
          <ListChecks size={18} style={{ color: '#E85D2A' }} />
          <h3 className="font-display text-lg font-bold tracking-tight">How it works</h3>
        </div>
        <div className="flex flex-col gap-2.5">
          {steps.map((s, i) => {
            const accent = s.danger ? '#ef4444' : '#E85D2A'
            return (
              <div key={i} className="flex items-start gap-2.5">
                <span
                  className="shrink-0 inline-flex items-center justify-center font-display text-xs font-bold tabular-nums"
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 6,
                    background: `color-mix(in srgb, ${accent} 12%, var(--bg))`,
                    border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
                    color: accent,
                    marginTop: 1,
                  }}
                >
                  {i + 1}
                </span>
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  <span className="font-display font-bold" style={{ color: s.danger ? '#ef4444' : 'var(--text-primary)' }}>
                    {s.lead}
                  </span>
                  <span className="mx-1.5" style={{ color: 'var(--text-muted)' }}>·</span>
                  {s.body}
                </p>
              </div>
            )
          })}
        </div>
        <div
          className="mt-4 pt-4"
          style={{ borderTop: '1px solid var(--border-subtle)' }}
        >
          <a
            href={discordUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-start gap-3 rounded-md px-3 py-2.5 transition-opacity hover:opacity-90"
            style={{
              background: 'color-mix(in srgb, #5865F2 10%, var(--bg))',
              border: '1px solid color-mix(in srgb, #5865F2 22%, transparent)',
            }}
          >
            <DiscordLogo size={20} style={{ color: '#5865F2', marginTop: 1 }} />
            <span className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              <span
                className="font-display text-[10px] font-bold uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                Optional
              </span>
              <span className="block mt-0.5">
                <span className="font-display font-bold" style={{ color: 'var(--text-primary)' }}>
                  Discord
                </span>{' '}
                is available if you want to screenshare, spectate, or chat during your match. Not required.
              </span>
            </span>
          </a>
        </div>
      </div>
    </div>
  )
}

/**
 * Prize-distribution poll. Phase C eligibility: any browser that signed up for
 * the live event can cast one vote (deduped server-side per browser). Results
 * are read from the live snapshot, so they refresh on the page's normal poll.
 */
function PollCard({
  code,
  poll,
  canVote,
  signedUp,
  pollOpen,
  onVoted,
}: {
  code: string
  poll: PollResults
  canVote: boolean
  signedUp: boolean
  pollOpen: boolean
  onVoted: () => void
}) {
  const [results, setResults] = useState<PollResults>(poll)
  const [voted, setVoted] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Keep tallies in sync with the latest snapshot poll between local updates.
  useEffect(() => setResults(poll), [poll])
  useEffect(() => setVoted(loadVotedChoice(code)), [code])

  const total = results.totalVotes
  const showResults = total > 0 || voted != null || !canVote
  // Highest vote count, so we can glow the leading option(s).
  const leadCount = total > 0 ? Math.max(...POLL_OPTIONS.map((o) => results.counts[o.id] ?? 0)) : 0

  async function handleVote(choice: string) {
    if (!canVote || voted || busy) return
    setBusy(choice)
    setError(null)
    try {
      const updated = await apiCastVote(loadVoterId(), choice)
      setResults(updated)
      setVoted(choice)
      saveVotedChoice(code, choice)
      onVoted()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not record your vote.'
      // If the server says we already voted, lock the UI accordingly.
      if (/already voted/i.test(msg)) {
        setVoted(choice)
        saveVotedChoice(code, choice)
      }
      setError(msg)
    } finally {
      setBusy(null)
    }
  }

  const interactive = canVote && !voted

  return (
    <div className="mb-6 p-5" style={card}>
      <div className="flex items-center justify-center gap-2 mb-1.5">
        <PieChart size={18} style={{ color: '#E85D2A' }} />
        <h3 className="font-display text-lg font-bold tracking-tight">How should the prize be split?</h3>
      </div>
      <p className="mb-4 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
        {interactive
          ? 'Cast your vote - one per player.'
          : voted
            ? 'Thanks for voting - one vote per player.'
            : !pollOpen
              ? 'Voting has closed - final results below.'
              : signedUp
                ? 'Voting is closed for this event.'
                : 'Sign up for this tournament to vote.'}
      </p>

      <div className="mx-auto grid grid-cols-1 gap-3 sm:grid-cols-3" style={{ maxWidth: 660 }}>
        {POLL_OPTIONS.map((opt) => {
          const count = results.counts[opt.id] ?? 0
          const pct = total > 0 ? Math.round((count / total) * 100) : 0
          const mine = voted === opt.id
          const loading = busy === opt.id
          const winning = showResults && leadCount > 0 && count === leadCount

          const inner = (
            <>
              {/* Share-of-vote fill anchored to the bottom edge of the card. */}
              {showResults && (
                <span
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 0,
                    bottom: 0,
                    height: 4,
                    width: `${pct}%`,
                    background: mine
                      ? '#E85D2A'
                      : winning
                        ? '#22c55e'
                        : 'color-mix(in srgb, var(--text-primary) 22%, transparent)',
                    transition: 'width 260ms ease',
                  }}
                />
              )}
              <div className="relative flex flex-1 flex-col gap-1.5">
                <div className="flex items-start justify-between gap-1.5">
                  <span className="font-display text-sm font-bold leading-tight">{opt.label}</span>
                  {mine && <Check size={14} strokeWidth={3} style={{ color: '#E85D2A', flexShrink: 0 }} />}
                </div>
                <span className="flex-1 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {opt.blurb}
                </span>
                <div className="flex items-end justify-between gap-1.5">
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                  ) : showResults ? (
                    <>
                      <span className="font-display text-2xl font-bold leading-none tabular-nums">{pct}%</span>
                      <span className="text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {count} {count === 1 ? 'vote' : 'votes'}
                      </span>
                    </>
                  ) : (
                    <span className="text-xs font-bold uppercase tracking-wide" style={{ color: '#E85D2A' }}>
                      Vote
                    </span>
                  )}
                </div>
              </div>
            </>
          )

          const baseStyle: React.CSSProperties = {
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            padding: 14,
            minHeight: 128,
            borderRadius: 8,
            background: 'var(--bg)',
            border: `1px solid ${
              winning
                ? '#22c55e'
                : mine
                  ? 'color-mix(in srgb, #E85D2A 55%, transparent)'
                  : 'var(--border-subtle)'
            }`,
            boxShadow: winning
              ? '0 0 0 1px #22c55e, 0 0 16px color-mix(in srgb, #22c55e 38%, transparent)'
              : undefined,
            transition: 'box-shadow 260ms ease, border-color 260ms ease',
            textAlign: 'left',
            width: '100%',
          }

          if (interactive) {
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => handleVote(opt.id)}
                disabled={busy != null}
                className="footer-btn"
                style={{ ...baseStyle, cursor: busy ? 'wait' : 'pointer' }}
              >
                {inner}
              </button>
            )
          }
          return (
            <div key={opt.id} style={baseStyle}>
              {inner}
            </div>
          )
        })}
      </div>

      {error && (
        <p className="mt-3 text-center text-sm" style={{ color: '#ef4444' }}>
          {error}
        </p>
      )}
      <p className="mt-3 text-center text-[11px]" style={{ color: 'var(--text-muted)' }}>
        {total} total {total === 1 ? 'vote' : 'votes'}
      </p>
    </div>
  )
}

export function TournamentLive() {
  const { status: walletStatus, profile } = useWalletAuth()
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Whether the "Why connect a wallet?" explainer modal is open.
  const [showWalletInfo, setShowWalletInfo] = useState(false)
  // Whether the profile editor modal is open (for adding an X handle before
  // sign-up). Mirrors the waitlist card's add-handle flow.
  const [editingProfile, setEditingProfile] = useState(false)
  // Which tournament code this browser has signed up for. Scoping to the code
  // (and persisting it) means a *new* tournament correctly shows the sign-up
  // form again instead of a stale "you're in the queue" from a past event.
  const [signedUpCode, setSignedUpCode] = useState<string | null>(null)
  // Deck list the player is committing to (required at sign-up). Locked once
  // submitted - the server refuses to overwrite an existing list.
  const [deckDraft, setDeckDraft] = useState('')
  // Post-entry deck submission (waitlist conversions who entered without one)
  // and viewing one's own locked list during the event.
  const [submitDeckBusy, setSubmitDeckBusy] = useState(false)
  const [ownDeckModal, setOwnDeckModal] = useState<
    { loading: true } | { loading: false; text: string | null } | null
  >(null)
  // Roster starts capped (top N) with a "Load more" so a big field doesn't
  // dominate the page; one tap reveals everyone.
  const [rosterExpanded, setRosterExpanded] = useState(false)
  // The roster is a responsive auto-fill grid, so its column count changes
  // with the viewport. We measure the live column count and round the visible
  // cap up to a whole number of rows, so the collapsed view always fills
  // complete rows (no ugly trailing blanks like a lone card after a full row).
  const rosterListRef = useRef<HTMLUListElement>(null)
  const [rosterCols, setRosterCols] = useState(1)

  useEffect(() => {
    try {
      setSignedUpCode(localStorage.getItem(SIGNED_UP_KEY))
    } catch {
      /* ignore unavailable storage */
    }
  }, [])

  const refresh = useCallback(async () => {
    try {
      const snap = await apiActiveSnapshot()
      setSnapshot(snap)
      setLoadError(null)
    } catch (err) {
      setSnapshot(null)
      setLoadError(err instanceof Error ? err.message : 'Could not load tournament')
    }
  }, [])

  // A finished or cancelled tournament's snapshot is immutable, so once we've
  // seen the final state there's nothing left to poll for.
  const isFinished =
    snapshot?.tournament.status === 'complete' || snapshot?.tournament.status === 'cancelled'

  useEffect(() => {
    // Always fetch once on mount / when completion state flips.
    refresh()
    // Nothing more will ever change for a finished event: stop polling.
    if (isFinished) return

    let timer: ReturnType<typeof setInterval> | null = null
    const start = () => {
      if (timer == null) timer = setInterval(refresh, POLL_MS)
    }
    const stop = () => {
      if (timer != null) {
        clearInterval(timer)
        timer = null
      }
    }
    // Don't burn requests while nobody's looking: pause polling when the tab is
    // hidden and resume (with an immediate catch-up refresh) when it returns.
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        stop()
      } else {
        refresh()
        start()
      }
    }
    if (document.visibilityState === 'visible') start()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [refresh, isFinished])

  const tournament = snapshot?.tournament
  const signupCountdown = useCountdown(
    tournament?.status === 'enrolling' ? tournament.enrollClosesAt : null,
  )
  const activeRound = snapshot?.rounds.find((r) => r.status === 'active')
  const roundCountdown = useCountdown(activeRound?.endsAt ?? null)

  const visiblePlayers = useMemo(
    () => (snapshot?.players ?? []).filter((p) => p.approvalStatus !== 'rejected'),
    [snapshot?.players],
  )

  const signupOpen = Boolean(
    tournament?.status === 'enrolling' &&
      tournament.enrollClosesAt &&
      new Date(tournament.enrollClosesAt) > new Date(),
  )

  useEffect(() => {
    const el = rosterListRef.current
    if (!el) return
    const measure = () => {
      const cols = getComputedStyle(el)
        .gridTemplateColumns.split(' ')
        .filter(Boolean).length
      setRosterCols(cols > 0 ? cols : 1)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
    // Re-attach when the list mounts (players load) or its grid template
    // changes (sign-up vs competitors uses a different minmax).
  }, [visiblePlayers.length, signupOpen])
  const rosterCap = useMemo(
    () => Math.ceil(ROSTER_MIN_VISIBLE / rosterCols) * rosterCols,
    [rosterCols],
  )

  // Signed up if this browser recorded it for the current event, OR the
  // signed-in wallet's X handle already appears in the roster. The second
  // check makes "you're in" survive across devices and cleared storage now
  // that sign-up is wallet-backed.
  const signedUp = Boolean(
    (tournament && signedUpCode === tournament.code) ||
      (profile?.xHandle &&
        visiblePlayers.some(
          (p) => p.xHandle.toLowerCase() === profile.xHandle!.toLowerCase(),
        )),
  )

  // Resolve the signed-in wallet to its player row (by X handle). Used both for
  // the deck-list prompts and to find the player's active-round match so we can
  // surface a "report your result" card at the top while the event is running.
  const playerById = useMemo(() => {
    const m = new Map<string, Player>()
    for (const p of snapshot?.players ?? []) m.set(p.id, p)
    return m
  }, [snapshot?.players])

  const myPlayer = useMemo(() => {
    if (!profile?.xHandle) return null
    const h = profile.xHandle.toLowerCase()
    return visiblePlayers.find((p) => p.xHandle.toLowerCase() === h) ?? null
  }, [profile?.xHandle, visiblePlayers])

  // Drives the post-entry "submit your deck list" prompt (waitlist conversions
  // enter without one). Deck contents are redacted from the public snapshot, so
  // we only know `hasDeckList` here, never the text.
  const owesDeckList = Boolean(myPlayer && !myPlayer.hasDeckList)

  const myActiveMatch = useMemo(() => {
    if (!myPlayer || !activeRound) return null
    return (
      (snapshot?.matches ?? []).find(
        (m) =>
          m.roundId === activeRound.id &&
          (m.player1Id === myPlayer.id || m.player2Id === myPlayer.id),
      ) ?? null
    )
  }, [myPlayer, activeRound, snapshot?.matches])

  const myOpponent = useMemo(() => {
    if (!myPlayer || !myActiveMatch) return null
    const oppId =
      myActiveMatch.player1Id === myPlayer.id
        ? myActiveMatch.player2Id
        : myActiveMatch.player1Id
    return oppId ? playerById.get(oppId) ?? null : null
  }, [myPlayer, myActiveMatch, playerById])

  async function doEnroll() {
    if (!tournament) return
    const deck = deckDraft.trim()
    if (!deck) {
      setActionError('Paste your deck list to sign up.')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await apiEnroll(tournament.code, deck)
      setSignedUpCode(tournament.code)
      try {
        localStorage.setItem(SIGNED_UP_KEY, tournament.code)
      } catch {
        /* ignore unavailable storage */
      }
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sign-up failed')
    } finally {
      setBusy(false)
    }
  }

  // Submit a deck list AFTER entry (waitlist conversions who came in without
  // one). Set-once on the server, so this only appears while the list is null.
  async function doSubmitDeck() {
    if (!tournament) return
    const deck = deckDraft.trim()
    if (!deck) {
      setActionError('Paste your deck list to submit.')
      return
    }
    setSubmitDeckBusy(true)
    setActionError(null)
    try {
      await apiSubmitDeckList(tournament.code, deck)
      setDeckDraft('')
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not submit deck list')
    } finally {
      setSubmitDeckBusy(false)
    }
  }

  // Pull up the caller's own locked list (private to the owner + host).
  async function viewOwnDeck() {
    if (!tournament) return
    setOwnDeckModal({ loading: true })
    try {
      const res = await apiOwnDeck(tournament.code)
      setOwnDeckModal({ loading: false, text: res.deckList })
    } catch {
      setOwnDeckModal({ loading: false, text: null })
    }
  }

  const lede = (
    <>
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(12px, 3.2vw, 24px)',
          fontStyle: 'italic',
          fontWeight: 700,
          lineHeight: 1.3,
          color: 'var(--text-secondary)',
        }}
      >
        <span style={{ color: '#E85D2A', fontWeight: 800, marginRight: 3 }}>“</span>
        Sign in with your <Wallet width="0.95em" height="0.95em" style={{ display: 'inline-block', verticalAlign: '-0.12em', color: '#E85D2A' }} aria-label="wallet" />,{' '}
        <br className="sm:hidden" />
        link your <XLogo /> handle for authenticity
        <span style={{ color: '#E85D2A', fontWeight: 800, marginLeft: 3 }}>”</span>
      </p>

      <button
        type="button"
        onClick={() => setShowWalletInfo(true)}
        className="inline-flex items-center gap-1 mt-3 text-xs font-semibold transition-opacity hover:opacity-80"
        style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
      >
        <Wallet size={12} aria-hidden style={{ opacity: 0.8 }} />
        Why connect a wallet?
      </button>

      {showWalletInfo && (
        <ModalPortal onClose={() => setShowWalletInfo(false)} label="Why connect a wallet?" maxWidth={400}>
          {/* Close button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 12px 0', flexShrink: 0 }}>
            <button
              onClick={() => setShowWalletInfo(false)}
              aria-label="Close"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '50%',
                width: 30,
                height: 30,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                color: 'var(--text-secondary)',
              }}
            >
              <X size={16} />
            </button>
          </div>

          <div style={{ padding: '0 24px 24px', overflowY: 'auto' }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                margin: '0 auto 14px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'color-mix(in srgb, #E85D2A 16%, var(--bg))',
                color: '#E85D2A',
              }}
            >
              <Wallet size={24} aria-hidden />
            </div>
            <h2
              className="font-display"
              style={{ fontSize: 19, fontWeight: 800, letterSpacing: '-0.01em', textAlign: 'center', marginBottom: 12 }}
            >
              Why connect a wallet?
            </h2>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-secondary)', textAlign: 'left' }}>
              Think of it as a username you already own. Connecting your wallet just
              proves it&apos;s you, then you sign a quick message to confirm. It&apos;s
              completely free, never touches a blockchain, and there&apos;s no payment
              or gas fee, ever.
            </p>
            <p style={{ fontSize: 13.5, lineHeight: 1.65, color: 'var(--text-secondary)', textAlign: 'left', marginTop: 12 }}>
              We only use it to keep your win/loss record tied to you across events.
              Linking your <XLogo size="0.9em" /> handle on top just adds a familiar
              face so opponents know who they&apos;re playing.
            </p>
          </div>
        </ModalPortal>
      )}
    </>
  )

  if (loadError && !snapshot) {
    return (
      <TournamentShell lede={lede}>
        <div className="mx-auto" style={{ maxWidth: 1080 }}>
          <div className="mx-auto mb-6 max-w-md p-8 text-center" style={card}>
            <Trophy size={32} style={{ color: '#E85D2A', margin: '0 auto 12px' }} />
            <p className="font-display text-lg font-bold">No active tournament</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {loadError.includes('No tournament') ? 'Check back when the next event opens, or get in line below.' : loadError}
            </p>
          </div>
          <WaitlistCard />
        </div>
      </TournamentShell>
    )
  }

  if (!snapshot || !tournament) {
    return (
      <TournamentShell lede={lede}>
        <div className="flex justify-center py-20 gap-2" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      </TournamentShell>
    )
  }

  return (
    <TournamentShell lede={lede}>
      <div className="mx-auto" style={{ maxWidth: 1080 }}>
      {/* Global leaderboard across all tournaments */}
      <Leaderboard />

      {/* Next-event waitlist. Shown only when the current event is not actively
          enrolling, so it never competes with the live sign-up form below. */}
      {!signupOpen && <WaitlistCard />}

      {/* Event hero */}
      <div className="mb-6 overflow-hidden" style={card}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))' }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-2xl font-bold leading-none tracking-tight sm:text-3xl">{tournament.name}</h2>
                <StatusPill status={tournament.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MetaChip icon={Hash}>{tournament.code}</MetaChip>
                <MetaChip icon={Swords}>{tournament.format === 'swiss' ? 'Swiss' : 'Single elim'}</MetaChip>
                <MetaChip icon={Users}>
                  {visiblePlayers.length}
                  {tournament.maxPlayers ? ` / ${tournament.maxPlayers}` : ''}
                  <span className="hidden sm:inline"> signed up</span>
                </MetaChip>
                <MetaChip icon={Check} hideOnMobile>Admin-verified</MetaChip>
              </div>
            </div>
            {signupOpen && <CountdownStat label="Sign-ups close in" value={signupCountdown} />}
            {tournament.status === 'running' && activeRound && (
              <CountdownStat label={`Round ${activeRound.number} ends in`} value={roundCountdown} />
            )}
          </div>
          {tournament.rules && (
            <p className="mt-5 whitespace-pre-wrap rounded-md p-3.5 text-sm" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {tournament.rules}
            </p>
          )}
          {tournament.contactUrl && (
            <p className="mt-3 text-sm">
              <a href={tournament.contactUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold" style={{ color: '#E85D2A' }}>
                <CalendarClock size={14} /> Coordination link (Discord / stream)
              </a>
            </p>
          )}
        </div>
      </div>

      {tournament.prizes.length > 0 && <PrizePool prizes={tournament.prizes} />}

      {tournament.status === 'running' && myPlayer && myActiveMatch && (
        <MyMatchCard
          code={tournament.code}
          match={myActiveMatch}
          myPlayerId={myPlayer.id}
          opponent={myOpponent}
          format={tournament.format}
          onReported={refresh}
        />
      )}

      <PollCard
        code={tournament.code}
        poll={snapshot.poll}
        canVote={signedUp && tournament.status !== 'complete' && tournament.pollOpen}
        signedUp={signedUp}
        pollOpen={tournament.pollOpen}
        onVoted={refresh}
      />

      <HowItWorks />

      <div className={signupOpen ? 'grid gap-6 lg:grid-cols-[1fr_1.2fr]' : ''}>
        {/* Sign up */}
        {signupOpen && (
          <div className="p-5" style={card}>
            <div className="flex items-center gap-2 mb-4">
              <UserPlus size={16} style={{ color: '#E85D2A' }} />
              <h3 className="font-display font-bold">Sign up</h3>
            </div>
            {signedUp ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  You&rsquo;re in the queue
                  {profile?.xHandle ? ` as @${profile.xHandle}` : ''}. Your handle
                  will be verified before the bracket is posted.
                </p>
                {owesDeckList ? (
                  <div className="flex flex-col gap-2 rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid rgba(232,93,42,0.4)' }}>
                    <p className="text-xs font-bold" style={{ color: '#E85D2A' }}>
                      One more step: submit your deck list before the bracket is
                      drawn, or you can&rsquo;t be paired.
                    </p>
                    <DeckListField
                      value={deckDraft}
                      onChange={setDeckDraft}
                      disabled={submitDeckBusy}
                    />
                    {actionError && <p className="text-sm" style={{ color: '#ef4444' }}>{actionError}</p>}
                    <button
                      onClick={() => void doSubmitDeck()}
                      disabled={submitDeckBusy}
                      className="footer-btn py-2 text-sm font-bold"
                      style={{ background: '#E85D2A', color: '#fff', borderRadius: 6, opacity: submitDeckBusy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                    >
                      {submitDeckBusy ? (
                        <>
                          <Loader2 size={14} className="animate-spin" /> Locking in…
                        </>
                      ) : (
                        'Lock in my deck list'
                      )}
                    </button>
                  </div>
                ) : myPlayer ? (
                  <button
                    type="button"
                    onClick={() => void viewOwnDeck()}
                    className="inline-flex items-center gap-1.5 self-start text-xs font-semibold transition-opacity hover:opacity-80"
                    style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                  >
                    <ListChecks size={13} aria-hidden /> View my locked deck list
                  </button>
                ) : null}
              </div>
            ) : walletStatus === 'loading' ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={15} className="animate-spin" /> Checking your wallet…
              </div>
            ) : walletStatus !== 'signed-in' || !profile ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Connect your wallet to sign up. It links your <XLogo /> handle so
                  matchups are verified and your record follows you across events.
                </p>
                <WalletConnectButton idleLabel="Connect Wallet to sign up" />
              </div>
            ) : !profile.xHandle ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  Add your <XLogo /> handle to your profile, then sign up with one tap.
                  It becomes a clickable link in matchups.
                </p>
                <button
                  onClick={() => setEditingProfile(true)}
                  className="footer-btn py-2.5 text-sm font-bold"
                  style={{ background: '#E85D2A', color: '#fff', borderRadius: 6 }}
                >
                  Add X handle
                </button>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                  Signing up as <span className="font-bold" style={{ color: 'var(--text-secondary)' }}>@{profile.xHandle}</span>{' '}
                  - your <XLogo /> handle becomes a clickable link in matchups.
                </p>
                <DeckListField
                  value={deckDraft}
                  onChange={setDeckDraft}
                  disabled={busy}
                />
                {actionError && <p className="text-sm" style={{ color: '#ef4444' }}>{actionError}</p>}
                <button
                  onClick={() => void doEnroll()}
                  disabled={busy}
                  className="footer-btn py-2.5 text-sm font-bold"
                  style={{ background: '#E85D2A', color: '#fff', borderRadius: 6, opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  {busy ? (
                    <>
                      <Loader2 size={14} className="animate-spin" /> Submitting…
                    </>
                  ) : (
                    `Join tournament as @${profile.xHandle}`
                  )}
                </button>
              </div>
            )}
            {editingProfile && (
              <PlayerProfileModal onClose={() => setEditingProfile(false)} />
            )}
          </div>
        )}

        {/* Roster: balanced beside the form while enrolling, full-width
            multi-column once sign-ups close so it never orphans. */}
        <div className="p-5" style={card}>
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex items-center gap-2">
              <Users size={16} style={{ color: '#E85D2A' }} />
              <h3 className="font-display font-bold">{signupOpen ? 'Sign-ups' : 'Competitors'}</h3>
            </div>
            <span
              className="inline-flex items-center justify-center font-display text-xs font-bold tabular-nums"
              style={{ minWidth: 24, height: 22, padding: '0 7px', borderRadius: 5, background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
            >
              {visiblePlayers.length}
            </span>
          </div>
          {visiblePlayers.length === 0 ? (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No sign-ups yet.</p>
          ) : (
            <>
              <ul
                ref={rosterListRef}
                className="grid gap-1.5"
                style={
                  signupOpen
                    ? { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }
                    : { gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }
                }
              >
                {(rosterExpanded ? visiblePlayers : visiblePlayers.slice(0, rosterCap)).map((p, i) => (
                  <PlayerRow key={p.id} player={p} index={i} />
                ))}
              </ul>
              {visiblePlayers.length > rosterCap && (
                <button
                  type="button"
                  onClick={() => setRosterExpanded((v) => !v)}
                  className="mt-3 w-full py-2 text-xs font-bold uppercase tracking-wider transition-colors"
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                    color: 'var(--text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  {rosterExpanded
                    ? 'Show less'
                    : `Load ${visiblePlayers.length - rosterCap} more`}
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Round board */}
      {tournament.status !== 'enrolling' && snapshot.matches.length > 0 && (
        <RoundBoard
          tournament={tournament}
          rounds={snapshot.rounds}
          matches={snapshot.matches}
          players={snapshot.players}
          activeRound={activeRound}
        />
      )}

      {/* Prize history - only after the event is complete + prizes resolved */}
      {tournament.status === 'complete' && snapshot.awardedPrizes.length > 0 && (
        <div className="mt-6">
          <AwardedPrizesHistory awarded={snapshot.awardedPrizes} />
        </div>
      )}

      {ownDeckModal && (
        <ModalPortal onClose={() => setOwnDeckModal(null)} label="Your deck list" maxWidth={460}>
          <div className="flex items-center gap-2 mb-3">
            <ListChecks size={16} style={{ color: '#E85D2A' }} />
            <h3 className="font-display font-bold">Your locked deck list</h3>
          </div>
          {ownDeckModal.loading ? (
            <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
              <Loader2 size={15} className="animate-spin" /> Loading…
            </div>
          ) : ownDeckModal.text ? (
            <>
              <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                {deckCardCount(ownDeckModal.text)} cards - this is the list you are
                committed to for the whole event.
              </p>
              <pre
                className="max-h-72 overflow-auto whitespace-pre-wrap rounded-md p-3 text-xs"
                style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)' }}
              >
                {ownDeckModal.text}
              </pre>
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No deck list on file yet.
            </p>
          )}
        </ModalPortal>
      )}
      </div>
    </TournamentShell>
  )
}

/**
 * Required deck-list input for the sign-up + post-entry submit flows. Plain
 * textarea with the OPTCG Sim format hint and a live card count. Validation is
 * light (server stores verbatim) - the count is display-only.
 */
function DeckListField({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  disabled?: boolean
}) {
  const count = deckCardCount(value)
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex items-center gap-1.5 text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
        <ListChecks size={13} style={{ color: '#E85D2A' }} /> Deck list (required)
      </label>
      <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        In OPTCG Sim, open your deck and hit{' '}
        <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Copy Deck list to Clipboard</span>,
        then paste it here. This is the deck you are locked into for the whole
        event - it can&rsquo;t be changed once submitted.
      </p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        maxLength={MAX_DECK_CHARS}
        rows={6}
        spellCheck={false}
        placeholder={'1xOP01-001\n4xOP01-016\n4xST01-006\n…'}
        className="w-full rounded-md p-2.5 text-xs"
        style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)', resize: 'vertical' }}
      />
      <span className="self-end text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
        {count > 0 ? `${count} cards` : 'Paste your list'}
      </span>
    </div>
  )
}

function RoundBoard({
  tournament,
  rounds,
  matches,
  players,
  activeRound,
}: {
  tournament: Tournament
  rounds: Round[]
  matches: Match[]
  players: Player[]
  activeRound: Round | undefined
}) {
  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  if (tournament.format === 'single-elim') {
    return <ElimBracket tournament={tournament} rounds={rounds} matches={matches} nameById={nameById} />
  }
  return (
    <SwissBoard
      rounds={rounds}
      matches={matches}
      players={players}
      nameById={nameById}
      activeRound={activeRound}
      swissRounds={tournament.swissRounds}
      complete={tournament.status === 'complete'}
    />
  )
}

function SectionHeader({
  title,
  subtitle,
  right,
}: {
  title: string
  subtitle?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
      <div>
        <div className="flex items-center gap-2">
          <Swords size={18} style={{ color: '#E85D2A' }} />
          <h3 className="font-display text-lg font-bold tracking-tight">{title}</h3>
        </div>
        {subtitle && (
          <p className="mt-1.5 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}>
            {subtitle}
          </p>
        )}
      </div>
      {right}
    </div>
  )
}

function SwissBoard({
  rounds,
  matches,
  players,
  nameById,
  activeRound,
  swissRounds,
  complete,
}: {
  rounds: Round[]
  matches: Match[]
  players: Player[]
  nameById: Map<string, Player>
  activeRound: Round | undefined
  swissRounds: number | null
  complete: boolean
}) {
  const standings = useMemo(() => {
    const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
    return computeStandings(inBracket, matches)
  }, [players, matches])
  const hasResults = useMemo(() => matches.some((m) => m.status === 'confirmed'), [matches])
  const sortedRounds = useMemo(() => [...rounds].sort((a, b) => a.number - b.number), [rounds])
  const [selectedRoundId, setSelectedRoundId] = useState(activeRound?.id ?? sortedRounds[0]?.id ?? '')

  useEffect(() => {
    if (activeRound) setSelectedRoundId(activeRound.id)
  }, [activeRound?.id])

  const selectedRound =
    sortedRounds.find((r) => r.id === selectedRoundId) ?? sortedRounds[sortedRounds.length - 1]
  const roundCountdown = useCountdown(selectedRound?.status === 'active' ? selectedRound.endsAt : null)
  const roundMatches = useMemo(
    () => matches.filter((m) => m.roundId === selectedRound?.id).sort((a, b) => a.number - b.number),
    [matches, selectedRound?.id],
  )
  const totalRounds = swissRounds ?? sortedRounds.length

  return (
    <div className="mt-6 overflow-hidden" style={card}>
      <div style={{ height: 3, background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))' }} />
      <div className="p-5 sm:p-6">
        <SectionHeader
          title={`Round ${selectedRound?.number ?? 1} pairings`}
          subtitle={
            <>Swiss · {totalRounds} rounds total · everyone keeps playing. Pairings shuffle by record.</>
          }
          right={
            selectedRound?.status === 'active' && selectedRound.endsAt ? (
              <CountdownStat label={`Round ${selectedRound.number} ends in`} value={roundCountdown} />
            ) : undefined
          }
        />

        {sortedRounds.length > 1 && (
          <div className="flex flex-wrap gap-1.5 mb-5">
            {sortedRounds.map((r) => {
              const on = r.id === selectedRound?.id
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setSelectedRoundId(r.id)}
                  className="footer-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
                  style={{
                    background: on ? 'var(--text-primary)' : 'var(--bg)',
                    color: on ? 'var(--bg)' : 'var(--text-primary)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 6,
                  }}
                >
                  Round {r.number}
                  {r.status === 'active' && (
                    <span className="round-active-breathe inline-block w-1.5 h-1.5 rounded-full" style={{ background: on ? 'var(--bg)' : '#22c55e' }} />
                  )}
                </button>
              )
            })}
          </div>
        )}

        <p className="mb-5 text-xs" style={{ color: 'var(--text-muted)' }}>
          DM your opponent on <XLogo /> to schedule. The admin records each result.
        </p>

        <div
          className="mx-auto grid gap-3"
          style={{ maxWidth: 760, gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}
        >
          {roundMatches.map((match) => (
            <BracketMatchCard key={match.id} match={match} nameById={nameById} />
          ))}
        </div>

        {hasResults && <StandingsTable standings={standings} nameById={nameById} complete={complete} />}
      </div>
    </div>
  )
}

function StandingsTable({ standings, nameById, complete }: { standings: StandingRow[]; nameById: Map<string, Player>; complete: boolean }) {
  if (standings.length === 0) return null
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={15} style={{ color: '#E85D2A' }} />
        <h4 className="font-display text-sm font-bold uppercase tracking-wider">
          {complete ? 'Final standings' : 'Standings'}
        </h4>
      </div>
      <div className="overflow-hidden" style={{ border: '1px solid var(--border-subtle)', borderRadius: 6 }}>
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
              <th className="text-left font-bold uppercase tracking-wider py-2 pl-3 pr-2" style={{ fontSize: 10, width: 44 }}>#</th>
              <th className="text-left font-bold uppercase tracking-wider py-2 px-2" style={{ fontSize: 10 }}>Player</th>
              <th className="text-center font-bold uppercase tracking-wider py-2 px-2" style={{ fontSize: 10, width: 90 }}>W-L-D</th>
              <th className="text-right font-bold uppercase tracking-wider py-2 px-2" style={{ fontSize: 10, width: 56 }}>Pts</th>
              <th className="text-right font-bold uppercase tracking-wider py-2 pl-2 pr-3 hidden sm:table-cell" style={{ fontSize: 10, width: 72 }}>OMW%</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const top = s.rank <= 3 && complete
              const medal = s.rank === 1 ? '#f5b301' : s.rank === 2 ? '#c4cad3' : s.rank === 3 ? '#cd7f32' : null
              return (
                <tr key={s.playerId} style={{ borderTop: '1px solid var(--border-subtle)', background: top ? `color-mix(in srgb, ${medal} 10%, var(--bg-surface))` : 'var(--bg-surface)' }}>
                  <td className="py-2 pl-3 pr-2">
                    <span
                      className="inline-flex items-center justify-center text-[11px] font-bold tabular-nums"
                      style={{ minWidth: 22, height: 22, borderRadius: 5, background: medal ?? 'var(--bg)', color: medal ? '#1a1a1a' : 'var(--text-muted)', border: medal ? 'none' : '1px solid var(--border-subtle)' }}
                    >
                      {s.rank}
                    </span>
                  </td>
                  <td className="py-2 px-2 min-w-0">
                    <span className="inline-flex items-center gap-1.5">
                      <XProfileLink handle={nameById.get(s.playerId)?.xHandle ?? s.displayName} className="truncate font-semibold" />
                      {s.dropped && (
                        <span className="text-[9px] font-bold uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>dropped</span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 px-2 text-center tabular-nums" style={{ color: 'var(--text-secondary)' }}>
                    {s.wins}-{s.losses}-{s.draws}
                  </td>
                  <td className="py-2 px-2 text-right font-bold tabular-nums">{s.points}</td>
                  <td className="py-2 pl-2 pr-3 text-right tabular-nums hidden sm:table-cell" style={{ color: 'var(--text-muted)' }}>
                    {(s.oppWinPct * 100).toFixed(1)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const ELIM_LINE = 'color-mix(in srgb, var(--text-primary) 18%, transparent)'

function elimRoundLabel(roundNum: number, totalRounds: number): string {
  const fromEnd = totalRounds - roundNum
  if (fromEnd === 0) return 'Final'
  if (fromEnd === 1) return 'Semifinals'
  if (fromEnd === 2) return 'Quarterfinals'
  return `Round ${roundNum}`
}

function ElimBracket({
  tournament,
  rounds,
  matches,
  nameById,
}: {
  tournament: Tournament
  rounds: Round[]
  matches: Match[]
  nameById: Map<string, Player>
}) {
  const sortedRounds = useMemo(() => [...rounds].sort((a, b) => a.number - b.number), [rounds])

  const columns = useMemo(() => {
    const round1 = sortedRounds.find((r) => r.number === 1)
    const round1Count = round1 ? matches.filter((m) => m.roundId === round1.id).length : 0
    const size = Math.max(2, round1Count * 2)
    const totalRounds = Math.max(1, Math.round(Math.log2(size)))
    const cols: { roundNum: number; label: string; round: Round | undefined; matches: (Match | null)[] }[] = []
    for (let rn = 1; rn <= totalRounds; rn++) {
      const round = sortedRounds.find((r) => r.number === rn)
      const real = round
        ? matches.filter((m) => m.roundId === round.id).sort((a, b) => a.number - b.number)
        : []
      const slotCount = size / Math.pow(2, rn)
      const cells: (Match | null)[] =
        real.length > 0 ? real : Array.from({ length: slotCount }, () => null)
      cols.push({ roundNum: rn, label: elimRoundLabel(rn, totalRounds), round, matches: cells })
    }
    return cols
  }, [sortedRounds, matches])

  const champion = useMemo(() => {
    if (tournament.status !== 'complete') return null
    const last = columns[columns.length - 1]
    const finalMatch = last?.matches[0]
    if (!finalMatch || !finalMatch.winnerId) return null
    return nameById.get(finalMatch.winnerId) ?? null
  }, [columns, tournament.status, nameById])

  return (
    <div className="mt-6 overflow-hidden" style={card}>
      <div style={{ height: 3, background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))' }} />
      <div className="p-5 sm:p-6">
        <SectionHeader
          title="Bracket"
          subtitle={<>Single elimination · seeded · lose once and you are out.</>}
          right={
            champion ? (
              <div
                className="inline-flex items-center gap-2 px-3 py-2"
                style={{ background: 'color-mix(in srgb, #f5b301 16%, var(--bg))', border: '1px solid color-mix(in srgb, #f5b301 45%, transparent)', borderRadius: 6 }}
              >
                <Trophy size={15} style={{ color: '#f5b301' }} />
                <span className="text-sm font-bold">{formatXLabel(champion.xHandle)}</span>
                <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>
                  Champion
                </span>
              </div>
            ) : undefined
          }
        />

        <p className="mb-5 text-xs" style={{ color: 'var(--text-muted)' }}>
          DM your opponent on <XLogo /> to schedule. The admin records each result and winners advance automatically.
        </p>

        <BracketScroller>
          <div className="flex" style={{ minWidth: 'min-content' }}>
            {columns.map((col) => (
              <div key={col.roundNum} className="flex flex-col" style={{ flex: '1 0 210px', minWidth: 210 }}>
                <div
                  className={`text-center text-[10px] font-bold uppercase tracking-widest mb-2 pb-2${
                    col.round?.status === 'active' ? ' round-active-breathe' : ''
                  }`}
                  style={{ color: col.round?.status === 'active' ? '#22c55e' : 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
                >
                  {col.label}
                </div>
                <div className="flex flex-col flex-1">
                  {col.matches.map((m, i) => (
                    <ElimCell
                      key={m?.id ?? `${col.roundNum}-${i}`}
                      match={m}
                      nameById={nameById}
                      hasPrev={col.roundNum > 1}
                      hasNext={col.roundNum < columns.length}
                      topOfPair={i % 2 === 0}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </BracketScroller>
      </div>
    </div>
  )
}

/**
 * Horizontally scrollable bracket wrapper that hints "there's more to the
 * right". Shows a soft right-edge fade + a gently nudging chevron pill while
 * the content overflows and the user has not yet scrolled to the end; both
 * fade out once they reach the last round (or if it all fits with no scroll).
 */
function BracketScroller({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [showStart, setShowStart] = useState(false)
  const [showEnd, setShowEnd] = useState(false)

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const max = el.scrollWidth - el.clientWidth
    setShowStart(el.scrollLeft > 4)
    setShowEnd(max > 4 && el.scrollLeft < max - 4)
  }, [])

  useEffect(() => {
    update()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(update)
    ro.observe(el)
    window.addEventListener('resize', update)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
    }
  }, [update])

  return (
    <div className="relative">
      <div
        ref={ref}
        className="overflow-x-auto pb-2"
        style={{ scrollbarWidth: 'thin' }}
        onScroll={update}
      >
        {children}
      </div>

      {/* Left fade once scrolled in, so the start edge reads as "more left". */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 transition-opacity duration-300"
        style={{
          bottom: 8,
          width: 36,
          opacity: showStart ? 1 : 0,
          background: 'linear-gradient(270deg, transparent, var(--bg-surface) 82%)',
        }}
      />

      {/* Right fade + nudging chevron: the core "scroll right" cue. */}
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 flex items-center justify-end transition-opacity duration-300"
        style={{
          bottom: 8,
          width: 64,
          opacity: showEnd ? 1 : 0,
          background: 'linear-gradient(90deg, transparent, var(--bg-surface) 70%)',
        }}
      >
        <span
          className="scroll-hint-chevron flex items-center justify-center"
          style={{
            width: 28,
            height: 28,
            marginRight: 2,
            borderRadius: '50%',
            background: 'var(--bg)',
            border: '1px solid color-mix(in srgb, #E85D2A 45%, var(--border-subtle))',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <ChevronRight size={16} style={{ color: '#E85D2A' }} />
        </span>
      </div>
    </div>
  )
}

function ElimCell({
  match,
  nameById,
  hasPrev,
  hasNext,
  topOfPair,
}: {
  match: Match | null
  nameById: Map<string, Player>
  hasPrev: boolean
  hasNext: boolean
  topOfPair: boolean
}) {
  const stubH: React.CSSProperties = { position: 'absolute', top: '50%', height: 2, width: 22, background: ELIM_LINE, transform: 'translateY(-50%)' }
  const vertical: React.CSSProperties = topOfPair
    ? { position: 'absolute', right: 0, top: '50%', height: '50%', width: 2, background: ELIM_LINE }
    : { position: 'absolute', right: 0, bottom: '50%', height: '50%', width: 2, background: ELIM_LINE }

  return (
    <div className="relative flex items-center" style={{ flex: 1, minHeight: 70, padding: '6px 0' }}>
      {hasPrev && <span style={{ ...stubH, left: 0 }} />}
      <div style={{ flex: 1, margin: '0 22px' }}>
        <ElimMatchCard match={match} nameById={nameById} />
      </div>
      {hasNext && <span style={{ ...stubH, right: 0 }} />}
      {hasNext && <span style={vertical} />}
    </div>
  )
}

function ElimMatchCard({ match, nameById }: { match: Match | null; nameById: Map<string, Player> }) {
  if (!match) {
    return (
      <div
        className="overflow-hidden"
        style={{ background: 'var(--bg)', border: '1px dashed var(--border-subtle)', borderRadius: 6, opacity: 0.7 }}
      >
        <ElimSlot player={undefined} seed={undefined} winner={false} />
        <div style={{ height: 1, background: 'var(--border-subtle)' }} />
        <ElimSlot player={undefined} seed={undefined} winner={false} />
      </div>
    )
  }
  const p1 = nameById.get(match.player1Id)
  const p2 = match.player2Id ? nameById.get(match.player2Id) : null
  const isBye = match.status === 'bye' || !match.player2Id
  return (
    <div
      className="overflow-hidden"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <ElimSlot player={p1} seed={p1?.seed} winner={match.winnerId === match.player1Id} />
      <div style={{ height: 1, background: 'var(--border-subtle)' }} />
      {isBye ? (
        <div
          className="px-2.5 py-2 text-[11px] font-semibold italic"
          style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--text-primary) 4%, var(--bg))' }}
        >
          Bye
        </div>
      ) : (
        <ElimSlot player={p2 ?? undefined} seed={p2?.seed} winner={match.winnerId === match.player2Id} />
      )}
    </div>
  )
}

function ElimSlot({
  player,
  seed,
  winner,
}: {
  player: Player | undefined
  seed: number | null | undefined
  winner: boolean
}) {
  return (
    <div
      className="flex items-center gap-2 px-2.5 py-2"
      style={{ background: winner ? 'color-mix(in srgb, #22c55e 12%, var(--bg))' : 'transparent', minHeight: 38 }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center text-[10px] font-bold tabular-nums"
        style={{ width: 20, height: 20, borderRadius: 4, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        {seed ?? '-'}
      </span>
      <div className="min-w-0 flex-1">
        {player ? (
          <XProfileLink handle={player.xHandle} className="text-[13px] truncate block" />
        ) : (
          <span className="text-[13px]" style={{ color: 'var(--text-muted)' }}>TBD</span>
        )}
      </div>
      {winner && <Check size={13} strokeWidth={3} style={{ color: '#22c55e', flexShrink: 0 }} />}
    </div>
  )
}

function BracketMatchCard({
  match,
  nameById,
}: {
  match: Match
  nameById: Map<string, Player>
}) {
  const p1 = nameById.get(match.player1Id)
  const p2 = match.player2Id ? nameById.get(match.player2Id) : null
  const isBye = match.status === 'bye' || !match.player2Id
  const winnerId = match.winnerId

  return (
    <div
      className="overflow-hidden"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <div
        className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
        style={{ background: 'var(--bg-surface)', borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        Match {match.number}
      </div>
      <BracketSlot player={p1} seed={p1?.seed} winner={winnerId === match.player1Id} top />
      <div style={{ height: 1, background: 'var(--border-subtle)' }} />
      {isBye ? (
        <div
          className="px-3 py-2.5 text-xs font-semibold italic"
          style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--text-primary) 4%, transparent)' }}
        >
          Bye - advances
        </div>
      ) : (
        <BracketSlot player={p2 ?? undefined} seed={p2?.seed} winner={winnerId === match.player2Id} top={false} />
      )}
    </div>
  )
}

function BracketSlot({
  player,
  seed,
  winner,
  top,
}: {
  player: Player | undefined
  seed: number | null | undefined
  winner: boolean
  top: boolean
}) {
  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2.5 min-h-[44px]"
      style={{
        background: winner
          ? 'color-mix(in srgb, #22c55e 12%, var(--bg))'
          : top
            ? 'var(--bg)'
            : 'color-mix(in srgb, var(--text-primary) 3%, var(--bg))',
      }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center font-display text-[11px] font-bold tabular-nums"
        style={{
          width: 24,
          height: 24,
          borderRadius: 5,
          background: 'var(--bg-surface)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-muted)',
        }}
      >
        {seed ?? '-'}
      </span>
      <div className="min-w-0 flex-1">
        {player ? (
          <XProfileLink handle={player.xHandle} className="text-sm truncate block" />
        ) : (
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>TBD</span>
        )}
      </div>
      {winner && (
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-wide" style={{ color: '#22c55e' }}>
          W
        </span>
      )}
    </div>
  )
}

function PlayerRow({ player, index }: { player: Player; index: number }) {
  return (
    <li
      className="flex items-center gap-2.5 rounded-md px-3 py-2 text-sm"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
    >
      <span
        className="shrink-0 inline-flex items-center justify-center text-xs font-bold tabular-nums"
        style={{ minWidth: 22, height: 22, borderRadius: 5, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}
      >
        {index + 1}
      </span>
      <span className="min-w-0 flex-1">
        <XProfileLink handle={player.xHandle} className="truncate block" />
      </span>
      {player.approvalStatus === 'pending' && (
        <span
          className="shrink-0 text-[10px] uppercase tracking-wider font-bold"
          style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--text-primary) 8%, transparent)', padding: '2px 7px', borderRadius: 5 }}
        >
          Pending
        </span>
      )}
      {player.approvalStatus === 'approved' && (
        <span
          className="shrink-0 inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-bold"
          style={{ color: '#22c55e', background: 'rgba(34,197,94,0.12)', padding: '2px 7px', borderRadius: 5 }}
        >
          <Check size={11} strokeWidth={3} /> Verified
        </span>
      )}
    </li>
  )
}
