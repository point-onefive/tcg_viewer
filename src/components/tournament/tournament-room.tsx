'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Trophy,
  Users,
  Copy,
  Check,
  CalendarClock,
  ShieldAlert,
  LogOut,
  Crown,
  Loader2,
} from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import {
  apiAcceptSchedule,
  apiClose,
  apiDropSelf,
  apiEnroll,
  apiHostDrop,
  apiOverride,
  apiProposeSchedule,
  apiReport,
  apiSnapshot,
  loadIdentity,
  saveIdentity,
  type StoredIdentity,
} from '@/lib/tournament/client'
import type {
  Match,
  Player,
  ReportedResult,
  ScheduleProposal,
  TournamentSnapshot,
} from '@/lib/tournament/types'

const POLL_MS = 12_000

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 12,
}
const inputStyle: React.CSSProperties = {
  background: 'var(--bg)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '8px 10px',
  fontSize: 13,
  outline: 'none',
}

// ── Time helpers (everything stored UTC, rendered in the viewer's zone) ──────
function fmtLocal(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
function fmtCountdown(iso: string | null): string {
  if (!iso) return ''
  const diff = new Date(iso).getTime() - Date.now()
  if (diff <= 0) return 'ended'
  const h = Math.floor(diff / 3_600_000)
  const m = Math.floor((diff % 3_600_000) / 60_000)
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; fg: string; label: string }> = {
    enrolling: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Enrolling' },
    running: { bg: 'rgba(232,93,42,0.15)', fg: '#E85D2A', label: 'In progress' },
    complete: { bg: 'rgba(120,120,120,0.18)', fg: 'var(--text-secondary)', label: 'Complete' },
    cancelled: { bg: 'rgba(239,68,68,0.15)', fg: '#ef4444', label: 'Cancelled' },
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
        borderRadius: 999,
      }}
    >
      {s.label}
    </span>
  )
}

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          /* ignore */
        }
      }}
      className="footer-btn inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 7 }}
    >
      {copied ? <Check size={13} /> : <Copy size={13} />}
      {copied ? 'Copied' : label}
    </button>
  )
}

export function TournamentRoom({ code }: { code: string }) {
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [identity, setIdentity] = useState<StoredIdentity>({})
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const firstLoad = useRef(true)

  const refresh = useCallback(async () => {
    try {
      const snap = await apiSnapshot(code)
      setSnapshot(snap)
      setLoadError(null)
    } catch (err) {
      if (firstLoad.current) setLoadError(err instanceof Error ? err.message : 'Failed to load')
    } finally {
      firstLoad.current = false
    }
  }, [code])

  useEffect(() => {
    setIdentity(loadIdentity(code))
  }, [code])

  useEffect(() => {
    refresh()
    const t = setInterval(refresh, POLL_MS)
    return () => clearInterval(t)
  }, [refresh])

  // Run a mutating action then refresh, surfacing any error.
  const run = useCallback(
    async (fn: () => Promise<void>) => {
      setBusy(true)
      setActionError(null)
      try {
        await fn()
        await refresh()
      } catch (err) {
        setActionError(err instanceof Error ? err.message : 'Action failed')
      } finally {
        setBusy(false)
      }
    },
    [refresh],
  )

  const isHost = Boolean(identity.hostToken)
  const me: Player | null = useMemo(() => {
    if (!snapshot || !identity.playerId) return null
    return snapshot.players.find((p) => p.id === identity.playerId) ?? null
  }, [snapshot, identity.playerId])

  if (loadError) {
    return (
      <TournamentShell>
        <div className="mx-auto max-w-md p-6 text-center" style={card}>
          <ShieldAlert size={28} style={{ color: '#E85D2A', margin: '0 auto 10px' }} />
          <p className="font-display text-lg font-bold">{loadError}</p>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            Double-check the tournament code, or ask the host for the link.
          </p>
        </div>
      </TournamentShell>
    )
  }

  if (!snapshot) {
    return (
      <TournamentShell>
        <div className="flex items-center justify-center gap-2 py-20" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={18} className="animate-spin" />
          Loading tournament…
        </div>
      </TournamentShell>
    )
  }

  const { tournament, players, rounds, matches, proposals, standings } = snapshot
  const nameById = new Map(players.map((p) => [p.id, p.displayName]))
  const activeCount = players.filter((p) => !p.dropped).length
  const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}/tournaments/${tournament.code}` : ''

  return (
    <TournamentShell>
      {/* ── Title bar ─────────────────────────────────────────────── */}
      <div className="mb-6 flex flex-col gap-4 p-5" style={card}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <h2 className="font-display text-xl font-bold sm:text-2xl">{tournament.name}</h2>
              <StatusBadge status={tournament.status} />
              {isHost && (
                <span
                  className="inline-flex items-center gap-1"
                  style={{ color: '#E85D2A', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em' }}
                >
                  <Crown size={13} /> HOST
                </span>
              )}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span style={{ fontWeight: 800, letterSpacing: '0.08em', color: 'var(--text-secondary)' }}>
                {tournament.code}
              </span>
              <span>· {tournament.format === 'swiss' ? 'Swiss' : 'Single elim'}</span>
              <span>· {activeCount} players</span>
              {tournament.contactUrl && (
                <a href={tournament.contactUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#E85D2A' }}>
                  · Coordination link
                </a>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {shareUrl && <CopyButton value={shareUrl} label="Share link" />}
          </div>
        </div>

        {tournament.rules && (
          <p
            className="whitespace-pre-wrap rounded-lg p-3 text-sm"
            style={{ background: 'var(--bg)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)' }}
          >
            {tournament.rules}
          </p>
        )}

        {/* Secret-link reminders for the people who have them. */}
        {(isHost || me) && (
          <div className="flex flex-wrap gap-2">
            {isHost && shareUrl && (
              <SecretLinkChip
                label="Your host link"
                url={`${shareUrl}#host`}
                hint="Bookmark this — it's your admin access."
              />
            )}
            {me && shareUrl && (
              <SecretLinkChip
                label={`Your player link (${me.displayName})`}
                url={`${shareUrl}#me`}
                hint="Bookmark to keep your spot from any device."
              />
            )}
          </div>
        )}
      </div>

      {actionError && (
        <p className="mb-4 rounded-lg p-3 text-sm" role="alert" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
          {actionError}
        </p>
      )}

      {/* ── Enrolling: lobby ──────────────────────────────────────── */}
      {tournament.status === 'enrolling' && (
        <Lobby
          code={code}
          players={players}
          enrollClosesAt={tournament.enrollClosesAt}
          isHost={isHost}
          me={me}
          busy={busy}
          onEnrolled={(res) => {
            const next = saveIdentity(code, { playerToken: res.playerToken, playerId: res.player.id, playerName: res.player.displayName })
            setIdentity(next)
          }}
          onClose={() => identity.hostToken && run(() => apiClose(code, identity.hostToken!))}
          onHostDrop={(pid) => identity.hostToken && run(() => apiHostDrop(code, identity.hostToken!, pid))}
          onSelfDrop={() => identity.playerToken && run(() => apiDropSelf(code, identity.playerToken!))}
          run={run}
        />
      )}

      {/* ── Running / complete: standings + bracket + schedule ────── */}
      {tournament.status !== 'enrolling' && (
        <div className="flex flex-col gap-6">
          <UpcomingBoard matches={matches} nameById={nameById} />
          <Standings standings={standings} isComplete={tournament.status === 'complete'} />
          <Bracket
            rounds={rounds}
            matches={matches}
            proposals={proposals}
            nameById={nameById}
            me={me}
            isHost={isHost}
            busy={busy}
            onReport={(matchId, result) =>
              identity.playerToken && run(() => apiReport(code, matchId, identity.playerToken!, result))
            }
            onPropose={(matchId, slots) =>
              identity.playerToken && run(() => apiProposeSchedule(code, matchId, identity.playerToken!, slots))
            }
            onAccept={(matchId, proposalId, slot) =>
              identity.playerToken && run(() => apiAcceptSchedule(code, matchId, identity.playerToken!, proposalId, slot))
            }
            onOverride={(matchId, winnerId) =>
              identity.hostToken && run(() => apiOverride(code, identity.hostToken!, matchId, winnerId))
            }
          />
          {me && !me.dropped && tournament.status === 'running' && (
            <button
              type="button"
              onClick={() => identity.playerToken && run(() => apiDropSelf(code, identity.playerToken!))}
              className="footer-btn mx-auto inline-flex items-center gap-1.5 px-3 py-2 text-xs"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 8 }}
            >
              <LogOut size={13} /> Drop from tournament
            </button>
          )}
        </div>
      )}
    </TournamentShell>
  )
}

function SecretLinkChip({ label, url, hint }: { label: string; url: string; hint: string }) {
  return (
    <div
      className="flex items-center gap-2 rounded-lg px-3 py-2"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
    >
      <div className="min-w-0">
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{label}</div>
        <div className="truncate" style={{ fontSize: 11, color: 'var(--text-muted)' }}>{hint}</div>
      </div>
      <CopyButton value={url} label="Copy" />
    </div>
  )
}

// ── Lobby ────────────────────────────────────────────────────────────────--

function Lobby({
  code,
  players,
  enrollClosesAt,
  isHost,
  me,
  busy,
  onEnrolled,
  onClose,
  onHostDrop,
  onSelfDrop,
  run,
}: {
  code: string
  players: Player[]
  enrollClosesAt: string | null
  isHost: boolean
  me: Player | null
  busy: boolean
  onEnrolled: (res: { player: Player; playerToken: string }) => void
  onClose: () => void
  onHostDrop: (playerId: string) => void
  onSelfDrop: () => void
  run: (fn: () => Promise<void>) => Promise<void>
}) {
  const [name, setName] = useState('')
  const [discord, setDiscord] = useState('')
  const active = players.filter((p) => !p.dropped)
  const closed = enrollClosesAt ? new Date(enrollClosesAt) <= new Date() : false

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_1.2fr]">
      {/* Enroll / status panel */}
      <div className="flex flex-col gap-4 p-5" style={card}>
        <div className="flex items-center gap-2">
          <Users size={16} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
          <h3 className="font-display text-lg font-bold">Enrollment</h3>
        </div>

        {enrollClosesAt && (
          <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
            <CalendarClock size={15} style={{ color: '#E85D2A' }} />
            {closed ? 'Window ended — host will start soon.' : `Closes in ${fmtCountdown(enrollClosesAt)} · ${fmtLocal(enrollClosesAt)}`}
          </div>
        )}

        {me ? (
          <div className="rounded-lg p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
            <p className="text-sm">
              You&rsquo;re enrolled as <strong>{me.displayName}</strong>.
            </p>
            <button
              type="button"
              onClick={onSelfDrop}
              disabled={busy}
              className="footer-btn mt-2 inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs"
              style={{ color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 7 }}
            >
              <LogOut size={12} /> Leave
            </button>
          </div>
        ) : closed ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Enrollment is closed.</p>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              if (!name.trim()) return
              run(async () => {
                const res = await apiEnroll(code, name.trim(), discord.trim() || undefined)
                onEnrolled(res)
                setName('')
                setDiscord('')
              })
            }}
            className="flex flex-col gap-2"
          >
            <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Your display name" required />
            <input style={inputStyle} value={discord} onChange={(e) => setDiscord(e.target.value)} placeholder="Discord handle (optional)" />
            <button
              type="submit"
              disabled={busy}
              className="footer-btn inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold"
              style={{ background: '#E85D2A', color: '#fff', borderRadius: 8 }}
            >
              Enroll
            </button>
          </form>
        )}

        {isHost && (
          <div className="mt-1 border-t pt-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              type="button"
              onClick={onClose}
              disabled={busy || active.length < 2}
              className="footer-btn inline-flex w-full items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold"
              style={{
                background: active.length < 2 ? 'var(--bg)' : 'var(--text-primary)',
                color: active.length < 2 ? 'var(--text-muted)' : 'var(--bg)',
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
              }}
            >
              <Trophy size={15} /> Close enrollment &amp; generate bracket
            </button>
            <p className="mt-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              {active.length < 2 ? 'Need at least 2 players.' : `${active.length} players will be seeded.`}
            </p>
          </div>
        )}
      </div>

      {/* Player list */}
      <div className="flex flex-col gap-3 p-5" style={card}>
        <h3 className="font-display text-sm font-bold" style={{ letterSpacing: '0.04em' }}>
          Enrolled · {active.length}
        </h3>
        {active.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No players yet. Share the code to get started.</p>
        ) : (
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {active.map((p, i) => (
              <li
                key={p.id}
                className="flex items-center justify-between rounded-lg px-3 py-2 text-sm"
                style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
              >
                <span className="flex items-center gap-2 truncate">
                  <span style={{ color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', width: 18 }}>{i + 1}</span>
                  <span className="truncate">{p.displayName}</span>
                  {p.discordHandle && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>· {p.discordHandle}</span>}
                </span>
                {isHost && (
                  <button
                    type="button"
                    onClick={() => onHostDrop(p.id)}
                    className="shrink-0 text-xs"
                    style={{ color: 'var(--text-muted)' }}
                    aria-label={`Remove ${p.displayName}`}
                  >
                    Remove
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// ── Standings ────────────────────────────────────────────────────────────--

function Standings({
  standings,
  isComplete,
}: {
  standings: TournamentSnapshot['standings']
  isComplete: boolean
}) {
  if (standings.length === 0) return null
  return (
    <div className="p-5" style={card}>
      <div className="mb-3 flex items-center gap-2">
        <Trophy size={15} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
        <h3 className="font-display text-sm font-bold" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {isComplete ? 'Final standings' : 'Standings'}
        </h3>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>#</th>
              <th style={{ textAlign: 'left', padding: '6px 8px' }}>Player</th>
              <th style={{ textAlign: 'center', padding: '6px 8px' }}>W-L-D</th>
              <th style={{ textAlign: 'center', padding: '6px 8px' }}>Pts</th>
              <th style={{ textAlign: 'center', padding: '6px 8px' }}>OMW%</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => (
              <tr
                key={s.playerId}
                style={{ borderTop: '1px solid var(--border-subtle)', opacity: s.dropped ? 0.5 : 1 }}
              >
                <td style={{ padding: '7px 8px', fontWeight: 700, color: s.rank === 1 && isComplete ? '#E85D2A' : 'inherit' }}>
                  {s.rank === 1 && isComplete ? '🏆' : s.rank}
                </td>
                <td style={{ padding: '7px 8px' }}>
                  {s.displayName}
                  {s.dropped && <span style={{ color: 'var(--text-muted)', fontSize: 11 }}> · dropped</span>}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
                  {s.wins}-{s.losses}-{s.draws}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                  {s.points}
                </td>
                <td style={{ padding: '7px 8px', textAlign: 'center', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                  {(s.oppWinPct * 100).toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Upcoming matches board (public, local time) ────────────────────────────--

function UpcomingBoard({ matches, nameById }: { matches: Match[]; nameById: Map<string, string> }) {
  const upcoming = matches
    .filter((m) => m.scheduledAt && m.status !== 'confirmed' && m.status !== 'bye')
    .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime())
  if (upcoming.length === 0) return null
  return (
    <div className="p-5" style={card}>
      <div className="mb-3 flex items-center gap-2">
        <CalendarClock size={15} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
        <h3 className="font-display text-sm font-bold" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          Upcoming matches
        </h3>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>· your local time</span>
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {upcoming.map((m) => (
          <li
            key={m.id}
            className="flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm"
            style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
          >
            <span className="truncate">
              {nameById.get(m.player1Id)} <span style={{ color: 'var(--text-muted)' }}>vs</span>{' '}
              {m.player2Id ? nameById.get(m.player2Id) : 'Bye'}
            </span>
            <span className="shrink-0" style={{ color: '#E85D2A', fontWeight: 600, fontSize: 12.5 }}>
              {fmtLocal(m.scheduledAt)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── Bracket (rounds + matches + interactions) ──────────────────────────────--

function Bracket({
  rounds,
  matches,
  proposals,
  nameById,
  me,
  isHost,
  busy,
  onReport,
  onPropose,
  onAccept,
  onOverride,
}: {
  rounds: TournamentSnapshot['rounds']
  matches: Match[]
  proposals: ScheduleProposal[]
  nameById: Map<string, string>
  me: Player | null
  isHost: boolean
  busy: boolean
  onReport: (matchId: string, result: ReportedResult) => void
  onPropose: (matchId: string, slots: string[]) => void
  onAccept: (matchId: string, proposalId: string, slot: string) => void
  onOverride: (matchId: string, winnerId: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-5">
      {rounds.map((round) => {
        const roundMatches = matches.filter((m) => m.roundId === round.id)
        return (
          <div key={round.id} className="p-5" style={card}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h3 className="font-display text-sm font-bold" style={{ letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                Round {round.number}
                <span
                  className="ml-2"
                  style={{ fontSize: 11, fontWeight: 600, color: round.status === 'active' ? '#E85D2A' : 'var(--text-muted)' }}
                >
                  {round.status === 'active' ? 'Active' : 'Complete'}
                </span>
              </h3>
              {round.status === 'active' && round.endsAt && (
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Closes in {fmtCountdown(round.endsAt)}</span>
              )}
            </div>
            <div className="grid gap-2.5 md:grid-cols-2">
              {roundMatches.map((m) => (
                <MatchCard
                  key={m.id}
                  match={m}
                  proposals={proposals.filter((p) => p.matchId === m.id)}
                  nameById={nameById}
                  me={me}
                  isHost={isHost}
                  busy={busy}
                  onReport={onReport}
                  onPropose={onPropose}
                  onAccept={onAccept}
                  onOverride={onOverride}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MatchCard({
  match,
  proposals,
  nameById,
  me,
  isHost,
  busy,
  onReport,
  onPropose,
  onAccept,
  onOverride,
}: {
  match: Match
  proposals: ScheduleProposal[]
  nameById: Map<string, string>
  me: Player | null
  isHost: boolean
  busy: boolean
  onReport: (matchId: string, result: ReportedResult) => void
  onPropose: (matchId: string, slots: string[]) => void
  onAccept: (matchId: string, proposalId: string, slot: string) => void
  onOverride: (matchId: string, winnerId: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [slots, setSlots] = useState<string[]>(['', '', ''])

  const isMine = Boolean(me && (match.player1Id === me.id || match.player2Id === me.id))
  const p1 = nameById.get(match.player1Id) ?? '—'
  const p2 = match.player2Id ? nameById.get(match.player2Id) ?? '—' : 'Bye'
  const winnerName = match.winnerId ? nameById.get(match.winnerId) : null

  const statusColor =
    match.status === 'confirmed' ? '#22c55e' : match.status === 'disputed' ? '#ef4444' : match.status === 'reported' ? '#E85D2A' : 'var(--text-muted)'
  const statusLabel =
    match.status === 'bye'
      ? 'Bye'
      : match.status === 'confirmed'
        ? winnerName
          ? `${winnerName} won`
          : 'Draw'
        : match.status === 'disputed'
          ? 'Disputed'
          : match.status === 'reported'
            ? 'Awaiting confirm'
            : 'Pending'

  function highlight(playerId: string) {
    return match.status === 'confirmed' && match.winnerId === playerId
  }

  return (
    <div
      className="rounded-lg p-3"
      style={{ background: 'var(--bg)', border: `1px solid ${isMine ? 'color-mix(in srgb, #E85D2A 45%, var(--border-subtle))' : 'var(--border-subtle)'}` }}
    >
      <button
        type="button"
        onClick={() => match.status !== 'bye' && setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 text-left"
        style={{ cursor: match.status === 'bye' ? 'default' : 'pointer' }}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 truncate text-sm">
            <span style={{ fontWeight: highlight(match.player1Id) ? 800 : 500 }}>{p1}</span>
            <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>vs</span>
            <span style={{ fontWeight: match.player2Id && highlight(match.player2Id) ? 800 : 500 }}>{p2}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2" style={{ fontSize: 11 }}>
            <span style={{ color: statusColor, fontWeight: 700 }}>{statusLabel}</span>
            {match.scheduledAt && (
              <span style={{ color: 'var(--text-muted)' }}>· {fmtLocal(match.scheduledAt)}</span>
            )}
          </div>
        </div>
        {isMine && match.status !== 'confirmed' && match.status !== 'bye' && (
          <span style={{ color: '#E85D2A', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', flexShrink: 0 }}>
            YOUR MATCH
          </span>
        )}
      </button>

      {open && match.status !== 'bye' && (
        <div className="mt-3 flex flex-col gap-3 border-t pt-3" style={{ borderColor: 'var(--border-subtle)' }}>
          {/* Reporting (participants only) */}
          {isMine && match.status !== 'confirmed' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>
                REPORT YOUR RESULT
              </div>
              <div className="flex gap-2">
                {(['win', 'loss', 'draw'] as ReportedResult[]).map((r) => (
                  <button
                    key={r}
                    type="button"
                    disabled={busy}
                    onClick={() => onReport(match.id, r)}
                    className="footer-btn flex-1 px-3 py-2 text-xs font-bold capitalize"
                    style={{
                      background: r === 'win' ? 'rgba(34,197,94,0.12)' : r === 'loss' ? 'rgba(239,68,68,0.1)' : 'var(--bg-surface)',
                      color: r === 'win' ? '#22c55e' : r === 'loss' ? '#ef4444' : 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 7,
                    }}
                  >
                    {r === 'win' ? 'I won' : r === 'loss' ? 'I lost' : 'Draw'}
                  </button>
                ))}
              </div>
              {match.status === 'reported' && (
                <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                  A result was reported. It auto-confirms after the confirmation window unless the other player disputes.
                </p>
              )}
              {match.status === 'disputed' && (
                <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>
                  Both players claimed different results — the host will resolve this.
                </p>
              )}
            </div>
          )}

          {/* Scheduling */}
          {isMine && match.status !== 'confirmed' && (
            <Scheduling
              match={match}
              proposals={proposals}
              meId={me!.id}
              nameById={nameById}
              slots={slots}
              setSlots={setSlots}
              busy={busy}
              onPropose={onPropose}
              onAccept={onAccept}
            />
          )}

          {/* Read-only schedule view for non-participants */}
          {!isMine && proposals.length > 0 && !match.scheduledAt && (
            <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>Players are coordinating a time…</p>
          )}

          {/* Host override */}
          {isHost && match.status !== 'confirmed' && (
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>
                HOST OVERRIDE
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOverride(match.id, match.player1Id)}
                  className="footer-btn px-2.5 py-1.5 text-xs"
                  style={{ border: '1px solid var(--border-subtle)', borderRadius: 7 }}
                >
                  {p1} wins
                </button>
                {match.player2Id && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => onOverride(match.id, match.player2Id)}
                    className="footer-btn px-2.5 py-1.5 text-xs"
                    style={{ border: '1px solid var(--border-subtle)', borderRadius: 7 }}
                  >
                    {p2} wins
                  </button>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onOverride(match.id, null)}
                  className="footer-btn px-2.5 py-1.5 text-xs"
                  style={{ border: '1px solid var(--border-subtle)', borderRadius: 7, color: 'var(--text-muted)' }}
                >
                  Draw
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Scheduling({
  match,
  proposals,
  meId,
  nameById,
  slots,
  setSlots,
  busy,
  onPropose,
  onAccept,
}: {
  match: Match
  proposals: ScheduleProposal[]
  meId: string
  nameById: Map<string, string>
  slots: string[]
  setSlots: (s: string[]) => void
  busy: boolean
  onPropose: (matchId: string, slots: string[]) => void
  onAccept: (matchId: string, proposalId: string, slot: string) => void
}) {
  const openProposals = proposals.filter((p) => p.status === 'open')
  const incoming = openProposals.filter((p) => p.proposedByPlayerId !== meId)

  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 6, letterSpacing: '0.06em' }}>
        SCHEDULE
      </div>

      {match.scheduledAt ? (
        <p className="text-sm" style={{ color: '#22c55e', fontWeight: 600 }}>
          Locked: {fmtLocal(match.scheduledAt)} (your time)
        </p>
      ) : (
        <>
          {/* Opponent's proposed slots → accept one */}
          {incoming.map((p) => (
            <div key={p.id} className="mb-2 rounded-lg p-2" style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)' }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                {nameById.get(p.proposedByPlayerId)} proposed — tap to accept:
              </div>
              <div className="flex flex-wrap gap-1.5">
                {p.slots.map((slot) => (
                  <button
                    key={slot}
                    type="button"
                    disabled={busy}
                    onClick={() => onAccept(match.id, p.id, slot)}
                    className="footer-btn px-2.5 py-1.5 text-xs font-semibold"
                    style={{ background: 'rgba(232,93,42,0.12)', color: '#E85D2A', border: '1px solid var(--border-subtle)', borderRadius: 7 }}
                  >
                    {fmtLocal(slot)}
                  </button>
                ))}
              </div>
            </div>
          ))}

          {/* Propose my own times */}
          <div className="flex flex-col gap-1.5">
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Propose times you&rsquo;re free (your local time):</span>
            {slots.map((s, i) => (
              <input
                key={i}
                type="datetime-local"
                style={inputStyle}
                value={s}
                onChange={(e) => {
                  const next = [...slots]
                  next[i] = e.target.value
                  setSlots(next)
                }}
              />
            ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const iso = slots
                  .filter((s) => s)
                  .map((s) => new Date(s).toISOString())
                if (iso.length) onPropose(match.id, iso)
              }}
              className="footer-btn mt-1 px-3 py-2 text-xs font-bold"
              style={{ background: 'var(--text-primary)', color: 'var(--bg)', borderRadius: 7 }}
            >
              Send proposed times
            </button>
          </div>
        </>
      )}
    </div>
  )
}
