'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Check, Gift, Hash, ListChecks, Loader2, PieChart, Swords, Trophy, UserPlus, Users, Wallet, X } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import {
  apiActiveSnapshot,
  apiCastVote,
  apiEnrollX,
  loadVotedChoice,
  loadVoterId,
  saveVotedChoice,
} from '@/lib/tournament/client'
import { POLL_OPTIONS, type PollResults } from '@/lib/tournament/poll'
import { XLogo } from '@/components/gallery/x-logo'
import { DiscordLogo } from '@/components/tournament/discord-logo'
import { Leaderboard } from '@/components/wallet/leaderboard'
import { ModalPortal } from '@/components/ui/modal-portal'
import { WaitlistCard } from '@/components/tournament/waitlist-card'
import {
  TournamentPasswordModal,
  isTournamentUnlocked,
} from '@/components/tournament/tournament-password-modal'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import { computeStandings } from '@/lib/tournament/pairing'
import type { Match, Player, Round, StandingRow, Tournament, TournamentPrize, TournamentSnapshot } from '@/lib/tournament/types'

const POLL_MS = 12_000
const SIGNED_UP_KEY = 'tcw_tournament_signed_up'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
}

const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  padding: '10px 12px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
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
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    enrolling: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Sign-ups open' },
    running: { bg: 'rgba(232,93,42,0.15)', fg: '#E85D2A', label: 'Round in progress' },
    complete: { bg: 'rgba(120,120,120,0.18)', fg: 'var(--text-secondary)', label: 'Complete' },
  }
  const s = map[status] ?? map.complete
  return (
    <span
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
function MetaChip({ icon: Icon, children }: { icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>; children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 5, color: 'var(--text-secondary)' }}
    >
      <Icon size={13} style={{ color: 'var(--text-muted)' }} />
      {children}
    </span>
  )
}

/** Framed countdown stat (sign-ups closing / round ending). */
function CountdownStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="shrink-0 px-4 py-2.5 text-center"
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

/** Punchy "how the event runs" explainer so there are no surprises. */
function HowItWorks() {
  const pengUrl = xProfileUrl('pengpost') ?? 'https://x.com/pengpost'
  const discordUrl = 'https://discord.gg/9meqsjre'
  const steps: { lead: React.ReactNode; body: React.ReactNode; danger?: boolean }[] = [
    { lead: 'Sign up', body: 'Enter a valid X handle before the sign-up timer ends.' },
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
      body: (
        <>
          Screenshot game results and share in the player&rsquo;s chat + tag{' '}
          <a href={pengUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#E85D2A', fontWeight: 700 }}>
            @pengpost
          </a>{' '}
          before the timer runs out.
        </>
      ),
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
                  style={{ width: 22, height: 22, borderRadius: 6, background: accent, color: '#fff', marginTop: 1 }}
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
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [xHandle, setXHandle] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  // Whether the "Why connect a wallet?" explainer modal is open.
  const [showWalletInfo, setShowWalletInfo] = useState(false)
  // Sign-up is gated behind a members-only password popup (the page itself is
  // public). Track the unlock + whether the prompt is showing.
  const [signupUnlocked, setSignupUnlocked] = useState(false)
  const [showSignupPassword, setShowSignupPassword] = useState(false)
  // Which tournament code this browser has signed up for. Scoping to the code
  // (and persisting it) means a *new* tournament correctly shows the sign-up
  // form again instead of a stale "you're in the queue" from a past event.
  const [signedUpCode, setSignedUpCode] = useState<string | null>(null)

  useEffect(() => {
    try {
      setSignedUpCode(localStorage.getItem(SIGNED_UP_KEY))
    } catch {
      /* ignore unavailable storage */
    }
    setSignupUnlocked(isTournamentUnlocked())
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

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

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

  const signedUp = Boolean(tournament && signedUpCode === tournament.code)

  async function doEnroll() {
    if (!tournament || !xHandle.trim()) return
    setBusy(true)
    setActionError(null)
    try {
      await apiEnrollX(tournament.code, xHandle.trim())
      setSignedUpCode(tournament.code)
      try {
        localStorage.setItem(SIGNED_UP_KEY, tournament.code)
      } catch {
        /* ignore unavailable storage */
      }
      setXHandle('')
      await refresh()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Sign-up failed')
    } finally {
      setBusy(false)
    }
  }

  function handleSignup(e: React.FormEvent) {
    e.preventDefault()
    if (!tournament || !xHandle.trim()) return
    // Gate the first sign-up behind the members-only password popup.
    if (!signupUnlocked) {
      setShowSignupPassword(true)
      return
    }
    void doEnroll()
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
        Sign in with your <Wallet width="0.95em" height="0.95em" style={{ display: 'inline-block', verticalAlign: '-0.12em', color: '#E85D2A' }} aria-label="wallet" />, link your <XLogo /> handle for authenticity
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

      {showSignupPassword && (
        <TournamentPasswordModal
          onClose={() => setShowSignupPassword(false)}
          onUnlock={() => {
            setSignupUnlocked(true)
            setShowSignupPassword(false)
            void doEnroll()
          }}
        />
      )}

      {/* Event hero */}
      <div className="mb-6 overflow-hidden" style={card}>
        <div style={{ height: 3, background: 'linear-gradient(90deg, #E85D2A, color-mix(in srgb, #E85D2A 35%, transparent))' }} />
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{tournament.name}</h2>
                <StatusPill status={tournament.status} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <MetaChip icon={Hash}>{tournament.code}</MetaChip>
                <MetaChip icon={Swords}>{tournament.format === 'swiss' ? 'Swiss' : 'Single elim'}</MetaChip>
                <MetaChip icon={Users}>
                  {visiblePlayers.length}
                  {tournament.maxPlayers ? ` / ${tournament.maxPlayers}` : ''} signed up
                </MetaChip>
                <MetaChip icon={Check}>Admin-verified</MetaChip>
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

      {/* Next-event waitlist. Shown only when the current event is not actively
          enrolling, so it never competes with the live sign-up form below. */}
      {!signupOpen && <WaitlistCard />}

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
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                You&rsquo;re in the queue. Your handle will be verified before the bracket is posted.
              </p>
            ) : (
              <form onSubmit={handleSignup} className="flex flex-col gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>
                  Your <XLogo /> handle
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center px-3 text-sm" style={{ ...inputStyle, width: 'auto', color: 'var(--text-muted)' }}>@</span>
                  <input
                    style={inputStyle}
                    value={xHandle}
                    onChange={(e) => setXHandle(e.target.value.replace(/^@/, ''))}
                    placeholder="yourhandle"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    required
                  />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Must match your real <XLogo /> profile - it becomes a clickable link in matchups.
                </p>
                {actionError && <p className="text-sm" style={{ color: '#ef4444' }}>{actionError}</p>}
                <button
                  type="submit"
                  disabled={busy}
                  className="footer-btn py-2.5 text-sm font-bold"
                  style={{ background: '#E85D2A', color: '#fff', borderRadius: 6, opacity: busy ? 0.6 : 1 }}
                >
                  {busy ? 'Submitting…' : 'Join tournament'}
                </button>
              </form>
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
            <ul
              className="grid gap-1.5"
              style={
                signupOpen
                  ? { gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }
                  : { gridTemplateColumns: 'repeat(auto-fill, minmax(210px, 1fr))' }
              }
            >
              {visiblePlayers.map((p, i) => (
                <PlayerRow key={p.id} player={p} index={i} />
              ))}
            </ul>
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
      </div>
    </TournamentShell>
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
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: on ? 'var(--bg)' : '#E85D2A' }} />
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

        <div className="overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
          <div className="flex" style={{ minWidth: 'min-content' }}>
            {columns.map((col) => (
              <div key={col.roundNum} className="flex flex-col" style={{ flex: '1 0 210px', minWidth: 210 }}>
                <div
                  className="text-center text-[10px] font-bold uppercase tracking-widest mb-2 pb-2"
                  style={{ color: col.round?.status === 'active' ? '#E85D2A' : 'var(--text-muted)', borderBottom: '1px solid var(--border-subtle)' }}
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
        </div>
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
