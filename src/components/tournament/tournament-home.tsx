'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Trophy, Users, CalendarClock, ShieldCheck } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import { apiCreate, saveIdentity } from '@/lib/tournament/client'
import type { TournamentFormat, TournamentGame } from '@/lib/tournament/types'

const inputStyle: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 8,
  padding: '9px 11px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: '0.1em',
  textTransform: 'uppercase',
  color: 'var(--text-muted)',
  marginBottom: 6,
  display: 'block',
}

const GAMES: { value: TournamentGame; label: string }[] = [
  { value: 'one-piece', label: 'One Piece' },
  { value: 'pokemon', label: 'Pokémon' },
  { value: 'gundam', label: 'Gundam' },
  { value: 'dragon-ball', label: 'Dragon Ball Super' },
  { value: 'digimon', label: 'Digimon' },
  { value: 'lorcana', label: 'Lorcana' },
  { value: 'other', label: 'Other' },
]

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span style={labelStyle}>{label}</span>
      {children}
    </label>
  )
}

export function TournamentHome() {
  const router = useRouter()

  // Host form state
  const [name, setName] = useState('')
  const [hostName, setHostName] = useState('')
  const [game, setGame] = useState<TournamentGame>('one-piece')
  const [format, setFormat] = useState<TournamentFormat>('swiss')
  const [swissAuto, setSwissAuto] = useState(true)
  const [swissRounds, setSwissRounds] = useState(4)
  const [roundHours, setRoundHours] = useState(24)
  const [enrollCloses, setEnrollCloses] = useState('')
  const [rules, setRules] = useState('')
  const [contactUrl, setContactUrl] = useState('')
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Join form state
  const [joinCode, setJoinCode] = useState('')

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setCreating(true)
    try {
      const result = await apiCreate({
        name: name.trim(),
        hostName: hostName.trim(),
        game,
        format,
        swissRounds: format === 'swiss' && !swissAuto ? swissRounds : null,
        roundMinutes: Math.round(roundHours * 60),
        enrollClosesAt: enrollCloses ? new Date(enrollCloses).toISOString() : null,
        rules: rules.trim() || null,
        contactUrl: contactUrl.trim() || null,
      })
      saveIdentity(result.tournament.code, { hostToken: result.hostToken })
      router.push(`/tournaments/${result.tournament.code}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create tournament.')
      setCreating(false)
    }
  }

  function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    const code = joinCode.trim().toUpperCase()
    if (code) router.push(`/tournaments/${encodeURIComponent(code)}`)
  }

  const lede = (
    <>
      <p
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 'clamp(12px, 3.2vw, 26px)',
          fontStyle: 'italic',
          fontWeight: 700,
          lineHeight: 1.3,
          letterSpacing: '-0.01em',
          color: 'var(--text-secondary)',
          whiteSpace: 'nowrap',
        }}
      >
        <span style={{ color: '#E85D2A', fontWeight: 800, marginRight: 3 }}>“</span>
        Run a real tournament without the spreadsheet
        <span style={{ color: '#E85D2A', fontWeight: 800, marginLeft: 3 }}>”</span>
      </p>
      <p
        className="mt-3 flex flex-nowrap items-center justify-center"
        style={{
          fontSize: 'clamp(8.5px, 2.4vw, 11px)',
          letterSpacing: 'clamp(0.06em, 0.5vw, 0.18em)',
          textTransform: 'uppercase',
          fontWeight: 700,
          color: 'var(--text-muted)',
          whiteSpace: 'nowrap',
          gap: 'clamp(4px, 1.4vw, 12px)',
        }}
      >
        <span>Always free</span>
        <span aria-hidden style={{ opacity: 0.5 }}>·</span>
        <span>No account needed</span>
        <span aria-hidden style={{ opacity: 0.5 }}>·</span>
        <span>Async &amp; global</span>
      </p>
    </>
  )

  return (
    <TournamentShell lede={lede}>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        {/* Host a tournament */}
        <form
          onSubmit={handleCreate}
          className="flex flex-col gap-4 p-5"
          style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12 }}
        >
          <div className="flex items-center gap-2">
            <Trophy size={16} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
            <h2 className="font-display text-lg font-bold">Host a tournament</h2>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tournament name">
              <input
                style={inputStyle}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Friday Night OP"
                required
              />
            </Field>
            <Field label="Your host name">
              <input
                style={inputStyle}
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                placeholder="e.g. point_onefive"
                required
              />
            </Field>
            <Field label="Game">
              <select style={inputStyle} value={game} onChange={(e) => setGame(e.target.value as TournamentGame)}>
                {GAMES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Format">
              <select
                style={inputStyle}
                value={format}
                onChange={(e) => setFormat(e.target.value as TournamentFormat)}
              >
                <option value="swiss">Swiss (recommended for async)</option>
                <option value="single-elim">Single elimination</option>
              </select>
            </Field>

            {format === 'swiss' && (
              <Field label="Swiss rounds">
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                    <input type="checkbox" checked={swissAuto} onChange={(e) => setSwissAuto(e.target.checked)} />
                    Auto
                  </label>
                  {!swissAuto && (
                    <input
                      type="number"
                      min={1}
                      max={12}
                      style={{ ...inputStyle, width: 80 }}
                      value={swissRounds}
                      onChange={(e) => setSwissRounds(Number(e.target.value))}
                    />
                  )}
                </div>
              </Field>
            )}

            <Field label="Round length (hours)">
              <input
                type="number"
                min={1}
                max={336}
                style={inputStyle}
                value={roundHours}
                onChange={(e) => setRoundHours(Number(e.target.value))}
              />
            </Field>

            <Field label="Enrollment closes (optional)">
              <input
                type="datetime-local"
                style={inputStyle}
                value={enrollCloses}
                onChange={(e) => setEnrollCloses(e.target.value)}
              />
            </Field>
            <Field label="Coordination link (Discord/X, optional)">
              <input
                style={inputStyle}
                value={contactUrl}
                onChange={(e) => setContactUrl(e.target.value)}
                placeholder="https://discord.gg/…"
              />
            </Field>
          </div>

          <Field label="Rules / notes (optional)">
            <textarea
              style={{ ...inputStyle, minHeight: 72, resize: 'vertical' }}
              value={rules}
              onChange={(e) => setRules(e.target.value)}
              placeholder="Banlist, best-of, deck submission, anything players should know."
            />
          </Field>

          {error && (
            <p style={{ color: '#ef4444', fontSize: 13 }} role="alert">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={creating}
            className="footer-btn inline-flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-bold"
            style={{
              background: '#E85D2A',
              color: '#fff',
              borderRadius: 8,
              opacity: creating ? 0.6 : 1,
            }}
          >
            <Trophy size={15} strokeWidth={2.5} aria-hidden />
            {creating ? 'Creating…' : 'Create tournament'}
          </button>
        </form>

        {/* Join + how it works */}
        <div className="flex flex-col gap-6">
          <form
            onSubmit={handleJoin}
            className="flex flex-col gap-3 p-5"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12 }}
          >
            <div className="flex items-center gap-2">
              <Users size={16} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
              <h2 className="font-display text-lg font-bold">Join a tournament</h2>
            </div>
            <p style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              Have a tournament code? Enter it to view the bracket and enroll.
            </p>
            <div className="flex gap-2">
              <input
                style={{ ...inputStyle, textTransform: 'uppercase', letterSpacing: '0.08em' }}
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value)}
                placeholder="OP-7QK2P"
              />
              <button
                type="submit"
                className="footer-btn shrink-0 px-4 text-sm font-bold"
                style={{ background: 'var(--text-primary)', color: 'var(--bg)', borderRadius: 8 }}
              >
                Go
              </button>
            </div>
          </form>

          <div
            className="flex flex-col gap-3 p-5"
            style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 12 }}
          >
            <h2 className="font-display text-sm font-bold" style={{ letterSpacing: '0.04em' }}>
              How it works
            </h2>
            <HowRow icon={Users} title="Open enrollment">
              Share your code. Players sign up with just a display name until you close enrollment (or the timer ends).
            </HowRow>
            <HowRow icon={Trophy} title="Smart bracket">
              Seeds and pairings generate automatically — Swiss or single-elim — with byes handled for you.
            </HowRow>
            <HowRow icon={CalendarClock} title="Async scheduling">
              Opponents propose times in their own zone and lock a slot. Everyone sees upcoming matches in their local time.
            </HowRow>
            <HowRow icon={ShieldCheck} title="Self-reporting">
              Both players report results. If a loser ghosts, the winner&rsquo;s report stands automatically. You can override anything.
            </HowRow>
          </div>
        </div>
      </div>
    </TournamentShell>
  )
}

function HowRow({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties; 'aria-hidden'?: boolean }>
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="flex gap-3">
      <Icon size={16} strokeWidth={2.25} style={{ color: '#E85D2A', flexShrink: 0, marginTop: 2 }} aria-hidden />
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{children}</div>
      </div>
    </div>
  )
}
