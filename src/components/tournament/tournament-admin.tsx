'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Crown, ExternalLink, Gift, ImagePlus, Loader2, LogOut, PieChart, Plus, Swords, Trash2, Trophy, Upload, X } from 'lucide-react'
import { computeStandings } from '@/lib/tournament/pairing'
import { TournamentShell } from './tournament-shell'
import {
  adminApi,
  apiActiveSnapshot,
  clearAdminKey,
  loadAdminKey,
  saveAdminKey,
} from '@/lib/tournament/client'
import { compressImageToDataUrl, imageFromClipboard } from '@/lib/tournament/paste-image'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import type { Match, Player, TournamentPrize, TournamentSnapshot } from '@/lib/tournament/types'

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
  padding: '9px 11px',
  fontSize: 14,
  width: '100%',
  outline: 'none',
}

/** Free-form digits-only field - no browser number spinners or leading-zero traps. */
function PositiveIntInput({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="text-xs">
      <span style={{ color: 'var(--text-muted)' }}>{label}</span>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        style={inputStyle}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
      />
    </label>
  )
}

function parsePositiveInt(raw: string): number | null {
  const n = parseInt(raw, 10)
  if (!raw.trim() || Number.isNaN(n) || n <= 0) return null
  return n
}

export function TournamentAdmin() {
  const [adminKey, setAdminKey] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [unlockBusy, setUnlockBusy] = useState(false)

  // Start fresh form - strings so typing "24" doesn't fight number-input quirks
  const [name, setName] = useState('')
  const [signupHours, setSignupHours] = useState('24')
  const [roundHours, setRoundHours] = useState('48')
  const [maxPlayers, setMaxPlayers] = useState('32')
  const [format, setFormat] = useState<'swiss' | 'single-elim'>('swiss')
  const [formError, setFormError] = useState<string | null>(null)

  // Which participant bucket the table is showing. Defaults to "all" so an
  // approve/reject never makes a row vanish - it just restyles in place.
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')

  const doLogout = useCallback(() => {
    clearAdminKey()
    setUnlocked(false)
    setAdminKey('')
    setSnapshot(null)
    setError(null)
    setMsg(null)
  }, [])

  // On mount, verify any stored key against the server before auto-unlocking.
  useEffect(() => {
    const saved = loadAdminKey()
    if (!saved) return
    setAdminKey(saved)
    setUnlockBusy(true)
    adminApi(saved, { action: 'ping' })
      .then(() => setUnlocked(true))
      .catch(() => {
        // Stored key is stale/wrong, so clear it and drop back to login.
        clearAdminKey()
        setAdminKey('')
      })
      .finally(() => setUnlockBusy(false))
  }, [])

  const refresh = useCallback(async (key: string) => {
    try {
      const snap = await apiActiveSnapshot()
      setSnapshot(snap)
      setError(null)
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : 'Load failed')
    }
  }, [])

  useEffect(() => {
    if (!unlocked || !adminKey) return
    refresh(adminKey)
    const t = setInterval(() => refresh(adminKey), 12_000)
    return () => clearInterval(t)
  }, [unlocked, adminKey, refresh])

  async function run(fn: () => Promise<void>) {
    setBusy(true)
    setMsg(null)
    setError(null)
    try {
      await fn()
      await refresh(adminKey)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Action failed'
      if (/not authorized/i.test(msg)) {
        doLogout()
        return
      }
      setError(msg)
    } finally {
      setBusy(false)
    }
  }

  async function unlock(e: React.FormEvent) {
    e.preventDefault()
    const key = adminKey.trim()
    if (!key) return
    setUnlockBusy(true)
    setUnlockError(null)
    try {
      await adminApi(key, { action: 'ping' })
      saveAdminKey(key)
      setUnlocked(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Verification failed'
      setUnlockError(/not authorized/i.test(msg) ? 'Wrong password. Try again.' : msg)
      setAdminKey('')
    } finally {
      setUnlockBusy(false)
    }
  }

  const code = snapshot?.tournament.code
  const pollOpen = snapshot?.tournament.pollOpen ?? true
  const players = snapshot?.players ?? []
  const pending = players.filter((p) => p.approvalStatus === 'pending')
  const approved = players.filter((p) => p.approvalStatus === 'approved')
  const rejected = players.filter((p) => p.approvalStatus === 'rejected')
  const visiblePlayers =
    tab === 'pending' ? pending : tab === 'approved' ? approved : tab === 'rejected' ? rejected : players

  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const status = snapshot?.tournament.status
  const activeRound = snapshot?.rounds.find((r) => r.status === 'active')
  const activeMatches = useMemo(
    () =>
      (snapshot?.matches ?? [])
        .filter((m) => activeRound && m.roundId === activeRound.id)
        .sort((a, b) => a.number - b.number),
    [snapshot?.matches, activeRound],
  )
  const roundsPlayed = snapshot?.rounds.length ?? 0
  const totalRounds =
    snapshot?.tournament.format === 'single-elim'
      ? Math.max(roundsPlayed, Math.ceil(Math.log2(Math.max(2, approved.length))))
      : snapshot?.tournament.swissRounds ?? roundsPlayed

  const standings = useMemo(() => {
    const inBracket = players.filter((p) => p.seed != null && p.approvalStatus !== 'rejected')
    return computeStandings(inBracket, snapshot?.matches ?? [])
  }, [players, snapshot?.matches])

  const champion = useMemo(() => {
    if (!snapshot || snapshot.tournament.status !== 'complete') return null
    if (snapshot.tournament.format === 'single-elim') {
      const ordered = [...snapshot.rounds].sort((a, b) => a.number - b.number)
      const finalRound = ordered[ordered.length - 1]
      const finalMatch = snapshot.matches.find((m) => m.roundId === finalRound?.id && m.winnerId)
      return finalMatch?.winnerId ? nameById.get(finalMatch.winnerId) ?? null : null
    }
    return standings[0] ? nameById.get(standings[0].playerId) ?? null : null
  }, [snapshot, standings, nameById])

  const setResult = (matchId: string, result: 'p1' | 'p2' | 'draw') =>
    run(async () => {
      if (!code) return
      await adminApi(adminKey, { action: 'set-result', code, matchId, result })
      setMsg('Result saved')
    })

  const approvePlayer = (p: Player) =>
    run(async () => {
      if (!code) return
      await adminApi(adminKey, { action: 'approve', code, playerId: p.id })
      setMsg(`Approved @${p.xHandle}`)
    })
  const rejectPlayer = (p: Player) =>
    run(async () => {
      if (!code) return
      await adminApi(adminKey, { action: 'reject', code, playerId: p.id })
      setMsg(`Rejected @${p.xHandle}`)
    })

  const setPollOpen = (open: boolean) =>
    run(async () => {
      if (!code) return
      await adminApi(adminKey, { action: 'set-poll', code, open })
      setMsg(open ? 'Prize-poll voting reopened' : 'Prize-poll voting stopped')
    })

  return (
    <TournamentShell>
      <div className="mx-auto max-w-2xl flex flex-col gap-6">
        <div className="flex items-center gap-2">
          <Crown size={20} style={{ color: '#E85D2A' }} />
          <h2 className="font-display text-xl font-bold">Tournament admin</h2>
        </div>

        {unlockBusy && !unlocked ? (
          <div className="flex justify-center py-8 gap-2" style={{ color: 'var(--text-muted)' }}>
            <Loader2 size={18} className="animate-spin" /> Verifying…
          </div>
        ) : !unlocked ? (
          <form onSubmit={unlock} className="p-5 flex flex-col gap-3" style={card}>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Enter your admin secret (same value as <code>TOURNAMENT_ADMIN_SECRET</code> in Vercel).
            </p>
            <input
              type="password"
              style={{ ...inputStyle, borderColor: unlockError ? '#ef4444' : 'var(--border-subtle)' }}
              value={adminKey}
              onChange={(e) => { setAdminKey(e.target.value); if (unlockError) setUnlockError(null) }}
              placeholder="Admin secret"
              autoComplete="off"
              disabled={unlockBusy}
            />
            {unlockError && (
              <p className="text-sm" style={{ color: '#ef4444' }} role="alert">{unlockError}</p>
            )}
            <button
              type="submit"
              disabled={!adminKey.trim() || unlockBusy}
              className="footer-btn py-2 text-sm font-bold inline-flex items-center justify-center gap-2"
              style={{ background: '#E85D2A', color: '#fff', borderRadius: 6, opacity: !adminKey.trim() || unlockBusy ? 0.6 : 1 }}
            >
              {unlockBusy && <Loader2 size={14} className="animate-spin" />}
              {unlockBusy ? 'Verifying…' : 'Unlock'}
            </button>
          </form>
        ) : (
          <>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={doLogout}
                className="footer-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
              >
                <LogOut size={13} /> Log out
              </button>
            </div>
            {error && !snapshot && (
              <div className="p-4 text-sm" style={{ ...card, color: '#ef4444' }}>{error}</div>
            )}

            {/* Start fresh */}
            <form
              className="p-5 flex flex-col gap-3"
              style={card}
              onSubmit={(e) => {
                e.preventDefault()
                setFormError(null)
                const signup = parsePositiveInt(signupHours)
                const round = parsePositiveInt(roundHours)
                const max = parsePositiveInt(maxPlayers)
                if (signup == null) {
                  setFormError('Sign-up hours must be a whole number greater than 0.')
                  return
                }
                if (round == null) {
                  setFormError('Round hours must be a whole number greater than 0.')
                  return
                }
                if (max == null || max < 2) {
                  setFormError('Max players must be at least 2.')
                  return
                }
                run(async () => {
                  const r = await adminApi(adminKey, {
                    action: 'start-fresh',
                    name: name.trim() || 'Card Wall Tournament',
                    signupMinutes: signup * 60,
                    roundMinutes: round * 60,
                    format,
                    maxPlayers: max,
                  })
                  setMsg(`Started ${r.code}`)
                  setName('')
                })
              }}
            >
              <div className="flex items-center gap-2">
                <Trophy size={16} style={{ color: '#E85D2A' }} />
                <h3 className="font-display font-bold">Start fresh tournament</h3>
              </div>
              <input style={inputStyle} value={name} onChange={(e) => setName(e.target.value)} placeholder="Tournament name" />

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Format
                </span>
                <div className="grid grid-cols-2 gap-2">
                  <FormatCard
                    icon={Swords}
                    title="Swiss"
                    blurb="Everyone plays every round. Pairs by record, nobody knocked out early."
                    active={format === 'swiss'}
                    onClick={() => setFormat('swiss')}
                  />
                  <FormatCard
                    icon={Trophy}
                    title="Single elim"
                    blurb="Seeded bracket. Lose once and you're out, winners advance to a final."
                    active={format === 'single-elim'}
                    onClick={() => setFormat('single-elim')}
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PositiveIntInput label="Sign-up hours" value={signupHours} onChange={setSignupHours} placeholder="24" />
                <PositiveIntInput label="Round hours" value={roundHours} onChange={setRoundHours} placeholder="48" />
              </div>
              <PlayerCapPicker value={maxPlayers} onChange={setMaxPlayers} format={format} />
              {formError && (
                <p className="text-sm" style={{ color: '#ef4444' }} role="alert">{formError}</p>
              )}
              <button type="submit" disabled={busy} className="footer-btn py-2 text-sm font-bold" style={{ background: 'var(--text-primary)', color: 'var(--bg)', borderRadius: 6 }}>
                {busy ? 'Working…' : `Start new (${format === 'swiss' ? 'Swiss' : 'Single elim'})`}
              </button>
            </form>

            {snapshot && code && (
              <>
                <div className="p-5" style={card}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg font-bold truncate">{snapshot.tournament.name}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {code} · {snapshot.tournament.format === 'single-elim' ? 'Single elim' : 'Swiss'} · {approved.length} verified
                        {pending.length > 0 ? ` · ${pending.length} pending` : ''}
                      </p>
                    </div>
                    <StatusBadge status={status ?? 'enrolling'} />
                  </div>

                  {status === 'enrolling' && (
                    <>
                      <div className="mt-4 flex flex-wrap gap-2">
                        <AdminBtn disabled={busy} onClick={() => run(() => adminApi(adminKey, { action: 'extend-signup', code, extraMinutes: 60 }).then(() => setMsg('Extended 1h')))}>
                          +1h sign-ups
                        </AdminBtn>
                        <AdminBtn disabled={busy} onClick={() => run(() => adminApi(adminKey, { action: 'close-signup', code }).then(() => setMsg('Sign-ups closed')))}>
                          Close sign-ups
                        </AdminBtn>
                        <AdminBtn disabled={busy || pending.length === 0} onClick={() => run(async () => {
                          const r = await adminApi(adminKey, { action: 'approve-all', code })
                          setMsg(`Approved ${r.approved ?? 0}`)
                        })}>
                          Approve all pending
                        </AdminBtn>
                        <AdminBtn
                          disabled={busy || approved.length < 2}
                          primary
                          onClick={() => run(() => adminApi(adminKey, { action: 'start-bracket', code }).then(() => setMsg('Round 1 started')))}
                        >
                          Start round 1
                        </AdminBtn>
                      </div>
                      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                        Flow: approve handles → start round 1.{' '}
                        {snapshot.tournament.format === 'single-elim'
                          ? 'Single elim seeds a knockout bracket - lose once and you are out.'
                          : 'Swiss pairings are posted round-by-round (everyone keeps playing).'}
                      </p>
                    </>
                  )}

                  {status === 'running' && (
                    <div
                      className="mt-4 flex items-center gap-2 px-3 py-2.5"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
                    >
                      <Swords size={15} style={{ color: '#E85D2A', flexShrink: 0 }} />
                      <span className="text-sm font-semibold">
                        Round {activeRound?.number ?? roundsPlayed} of {totalRounds} in progress
                      </span>
                      <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
                        Declare results below ↓
                      </span>
                    </div>
                  )}

                  {status === 'complete' && (
                    <div
                      className="mt-4 flex items-center gap-3 px-3 py-3"
                      style={{
                        background: 'color-mix(in srgb, #f5b301 12%, var(--bg))',
                        border: '1px solid color-mix(in srgb, #f5b301 45%, var(--border-subtle))',
                        borderRadius: 6,
                      }}
                    >
                      <Crown size={20} style={{ color: '#f5b301', flexShrink: 0 }} />
                      <div className="min-w-0">
                        <p className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                          Champion
                        </p>
                        <p className="font-display font-bold truncate">
                          {champion ? formatXLabel(champion.xHandle) : 'Tournament complete'}
                        </p>
                      </div>
                      <span className="text-xs ml-auto whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                        {roundsPlayed} round{roundsPlayed === 1 ? '' : 's'} · start a fresh event above
                      </span>
                    </div>
                  )}

                  <div
                    className="mt-4 flex flex-wrap items-center gap-2 px-3 py-2.5"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
                  >
                    <PieChart size={15} style={{ color: '#E85D2A', flexShrink: 0 }} />
                    <span className="text-sm font-semibold">Prize poll</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {snapshot.poll.totalVotes} vote{snapshot.poll.totalVotes === 1 ? '' : 's'} · {pollOpen ? 'open' : 'closed'}
                    </span>
                    <span className="ml-auto">
                      <AdminBtn disabled={busy} onClick={() => setPollOpen(!pollOpen)}>
                        {pollOpen ? 'Stop voting' : 'Reopen voting'}
                      </AdminBtn>
                    </span>
                  </div>

                  {msg && <p className="mt-3 text-sm" style={{ color: '#22c55e' }}>{msg}</p>}
                  {error && (
                    <p className="mt-3 text-sm font-semibold" style={{ color: '#ef4444' }} role="alert">
                      {error}
                    </p>
                  )}
                </div>

                {activeRound && activeMatches.length > 0 && (
                  <div className="p-5" style={card}>
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex items-center gap-2">
                        <Swords size={16} style={{ color: '#E85D2A' }} />
                        <h3 className="font-display font-bold">Round {activeRound.number} results</h3>
                      </div>
                      <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {activeMatches.filter((m) => m.status === 'confirmed' || m.status === 'bye').length}/{activeMatches.length} done
                      </span>
                    </div>
                    <p className="text-xs mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      Tap the winner of each match.{' '}
                      {snapshot.tournament.format === 'single-elim'
                        ? 'When the round is fully decided, the next bracket round is generated automatically.'
                        : 'When all matches are in, the next Swiss round pairs automatically.'}
                    </p>
                    <ul className="flex flex-col gap-2">
                      {activeMatches.map((m) => (
                        <AdminMatchRow
                          key={m.id}
                          match={m}
                          nameById={nameById}
                          allowDraw={snapshot.tournament.format !== 'single-elim'}
                          disabled={busy}
                          onResult={(r) => setResult(m.id, r)}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-5" style={card}>
                  <h3 className="text-sm font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>
                    Participants
                  </h3>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <ParticipantTab label="All" count={players.length} active={tab === 'all'} onClick={() => setTab('all')} />
                    <ParticipantTab label="Pending" count={pending.length} active={tab === 'pending'} onClick={() => setTab('pending')} />
                    <ParticipantTab label="Approved" count={approved.length} active={tab === 'approved'} onClick={() => setTab('approved')} />
                    <ParticipantTab label="Rejected" count={rejected.length} active={tab === 'rejected'} onClick={() => setTab('rejected')} />
                  </div>

                  {visiblePlayers.length === 0 ? (
                    <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                      {players.length === 0 ? 'No sign-ups yet.' : `No ${tab === 'all' ? '' : tab + ' '}participants.`}
                    </p>
                  ) : (
                    <ul className="flex flex-col gap-2">
                      {visiblePlayers.map((p) => (
                        <ParticipantRow
                          key={p.id}
                          player={p}
                          disabled={busy}
                          onApprove={() => approvePlayer(p)}
                          onReject={() => rejectPlayer(p)}
                        />
                      ))}
                    </ul>
                  )}
                </div>

                <PrizeEditor
                  key={code}
                  initial={snapshot.tournament.prizes}
                  busy={busy}
                  onSave={async (prizes) => {
                    setBusy(true)
                    setMsg(null)
                    setError(null)
                    try {
                      const r = await adminApi(adminKey, { action: 'set-prizes', code, prizes })
                      setMsg(`Saved ${r.count ?? prizes.length} prize${(r.count ?? prizes.length) === 1 ? '' : 's'}`)
                      await refresh(adminKey)
                      return true
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not save prizes')
                      return false
                    } finally {
                      setBusy(false)
                    }
                  }}
                />
              </>
            )}

            {error && snapshot && (
              <div className="p-4 text-sm" style={{ ...card, color: '#ef4444' }}>{error}</div>
            )}

            {busy && (
              <div className="flex justify-center py-4 gap-2" style={{ color: 'var(--text-muted)' }}>
                <Loader2 size={16} className="animate-spin" /> Working…
              </div>
            )}
          </>
        )}
      </div>
    </TournamentShell>
  )
}

function ordinalLabel(n: number): string {
  const names = ['1st', '2nd', '3rd']
  const base = names[n - 1] ?? `${n}th`
  return `${base} Place`
}

function prizesEqual(a: TournamentPrize[], b: TournamentPrize[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Prize-pool editor. The admin picks how many slots, then fills each
 * with a title, a description, and (optionally) a pasted image. Empty
 * pool = no prizes shown publicly. Local edits are protected from the
 * 12s background poll until saved (see `dirty`).
 */
function PrizeEditor({
  initial,
  busy,
  onSave,
}: {
  initial: TournamentPrize[]
  busy: boolean
  onSave: (prizes: TournamentPrize[]) => Promise<boolean>
}) {
  const [slots, setSlots] = useState<TournamentPrize[]>(initial)
  const [dirty, setDirty] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)

  // Re-sync from the server only while the admin isn't mid-edit, so the
  // background poll never clobbers in-progress changes.
  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    if (!dirty) setSlots(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const mutate = (next: TournamentPrize[]) => {
    setSlots(next)
    setDirty(true)
  }

  const addSlot = () => {
    const n = slots.length + 1
    mutate([...slots, { title: ordinalLabel(n), description: '', image: null }])
  }
  const removeSlot = (i: number) => mutate(slots.filter((_, idx) => idx !== i))
  const patch = (i: number, p: Partial<TournamentPrize>) =>
    mutate(slots.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  const handleImage = async (i: number, blob: Blob) => {
    setImgError(null)
    try {
      const dataUrl = await compressImageToDataUrl(blob)
      patch(i, { image: dataUrl })
    } catch {
      setImgError('Could not read that image - try a PNG/JPG screenshot.')
    }
  }

  const canSave = dirty && !busy
  const saved = !dirty && prizesEqual(slots, initial)

  return (
    <div className="p-5" style={card}>
      <div className="flex items-center gap-2 mb-1">
        <Gift size={16} style={{ color: '#E85D2A' }} />
        <h3 className="font-display font-bold">Prize pool</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Optional. Add a slot per placing, paste an image and a short description.
        Leave it empty to show no prizes.
      </p>

      {slots.length === 0 ? (
        <p className="text-sm mb-4 rounded-md px-3 py-3 text-center" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
          No prizes yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3 mb-3">
          {slots.map((slot, i) => (
            <PrizeSlotCard
              key={i}
              index={i}
              slot={slot}
              disabled={busy}
              onChange={(p) => patch(i, p)}
              onRemove={() => removeSlot(i)}
              onImage={(blob) => handleImage(i, blob)}
            />
          ))}
        </div>
      )}

      {imgError && <p className="text-sm mb-3" style={{ color: '#ef4444' }}>{imgError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <AdminBtn disabled={busy || slots.length >= 12} onClick={addSlot}>
          <span className="inline-flex items-center gap-1"><Plus size={12} /> Add slot</span>
        </AdminBtn>
        <AdminBtn
          primary
          disabled={!canSave}
          onClick={async () => {
            const ok = await onSave(slots)
            if (ok) setDirty(false)
          }}
        >
          {saved ? 'Saved' : 'Save prizes'}
        </AdminBtn>
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setSlots(initial)
              setDirty(false)
              setImgError(null)
            }}
            className="text-xs"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Discard changes
          </button>
        )}
      </div>
    </div>
  )
}

function PrizeSlotCard({
  index,
  slot,
  disabled,
  onChange,
  onRemove,
  onImage,
}: {
  index: number
  slot: TournamentPrize
  disabled: boolean
  onChange: (p: Partial<TournamentPrize>) => void
  onRemove: () => void
  onImage: (blob: Blob) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          Slot {index + 1}
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove slot ${index + 1}`}
          className="inline-flex items-center justify-center"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
        {/* Image paste / preview */}
        {slot.image ? (
          <div className="relative self-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.image}
              alt={slot.title || `Prize ${index + 1}`}
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, border: '1px solid var(--border-subtle)' }}
            />
            <button
              type="button"
              onClick={() => onChange({ image: null })}
              aria-label="Remove image"
              className="absolute inline-flex items-center justify-center"
              style={{ top: 4, right: 4, width: 20, height: 20, borderRadius: 5, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5 self-start">
            {/* Focusable paste target: click it to focus, then ⌘V. It no
                longer opens the file dialog on click. Upload is its own
                button below so the two flows don't fight each other. */}
            <div
              tabIndex={0}
              aria-label={`Click here then paste an image for slot ${index + 1}`}
              onPaste={(e) => {
                const blob = imageFromClipboard(e)
                if (blob) {
                  e.preventDefault()
                  onImage(blob)
                }
              }}
              className="flex flex-col items-center justify-center gap-1 text-center cursor-text"
              style={{ height: 72, borderRadius: 6, border: '1px dashed color-mix(in srgb, var(--text-primary) 28%, transparent)', color: 'var(--text-muted)', padding: 6 }}
            >
              <ImagePlus size={16} />
              <span className="text-[10px] leading-tight">Click, then paste (⌘V)</span>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={disabled}
              className="footer-btn inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, opacity: disabled ? 0.5 : 1 }}
            >
              <Upload size={12} /> Upload
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImage(f)
            e.target.value = ''
          }}
        />

        {/* Title + description */}
        <div className="flex flex-col gap-2 min-w-0">
          <input
            style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
            value={slot.title}
            disabled={disabled}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder={ordinalLabel(index + 1)}
          />
          <textarea
            style={{ ...inputStyle, padding: '7px 9px', fontSize: 13, resize: 'vertical', minHeight: 52 }}
            value={slot.description}
            disabled={disabled}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Prize description (e.g. $50 store credit + alt-art OP01-001)"
            rows={2}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Player-cap picker. Replaces a freeform number with "ideal" bracket sizes
 * (powers of two = no byes for single-elim, clean round counts for Swiss).
 * The cap is a target/ceiling - the admin can always close sign-ups early and
 * run with fewer. A "Custom" escape hatch keeps full flexibility.
 */
const CAP_PRESETS = [8, 16, 32, 64]

function PlayerCapPicker({
  value,
  onChange,
  format,
}: {
  value: string
  onChange: (v: string) => void
  format: 'swiss' | 'single-elim'
}) {
  const num = parseInt(value, 10)
  const [custom, setCustom] = useState(() => !CAP_PRESETS.includes(num))

  // Both formats run ceil(log2 N) rounds at these sizes (Swiss floored at 3).
  const roundsFor = (size: number) =>
    Math.max(format === 'swiss' ? 3 : 1, Math.ceil(Math.log2(Math.max(2, size))))

  return (
    <div>
      <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
        Player cap (target)
      </span>
      <div className="flex flex-wrap gap-2">
        {CAP_PRESETS.map((size) => {
          const active = !custom && num === size
          return (
            <button
              key={size}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustom(false)
                onChange(String(size))
              }}
              className="text-center transition-colors"
              style={{
                flex: '1 1 64px',
                minWidth: 64,
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: active ? 'color-mix(in srgb, #E85D2A 12%, var(--bg))' : 'var(--bg)',
                border: `1px solid ${active ? '#E85D2A' : 'var(--border-subtle)'}`,
              }}
            >
              <span className="block font-display text-base font-bold leading-none">{size}</span>
              <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                {roundsFor(size)} rounds
              </span>
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustom(true)}
          className="text-center transition-colors"
          style={{
            flex: '1 1 64px',
            minWidth: 64,
            padding: '7px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            background: custom ? 'color-mix(in srgb, #E85D2A 12%, var(--bg))' : 'var(--bg)',
            border: `1px solid ${custom ? '#E85D2A' : 'var(--border-subtle)'}`,
          }}
        >
          <span className="block font-display text-base font-bold leading-none">∙∙∙</span>
          <span className="block text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
            Custom
          </span>
        </button>
      </div>
      {custom && (
        <div className="mt-2">
          <PositiveIntInput label="Custom cap" value={value} onChange={onChange} placeholder="e.g. 24" />
        </div>
      )}
      <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
        A ceiling, not a requirement. Close sign-ups early to run with fewer. 8 / 16 / 32 are the
        cleanest fields (no byes for single elim, even Swiss rounds).
      </p>
    </div>
  )
}

function FormatCard({
  icon: Icon,
  title,
  blurb,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  title: string
  blurb: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="flex flex-col gap-1.5 p-3 text-left transition-colors"
      style={{
        background: active ? 'color-mix(in srgb, #E85D2A 12%, var(--bg))' : 'var(--bg)',
        border: `1px solid ${active ? '#E85D2A' : 'var(--border-subtle)'}`,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold">
        <Icon size={15} style={{ color: active ? '#E85D2A' : 'var(--text-muted)' }} />
        {title}
      </span>
      <span className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
        {blurb}
      </span>
    </button>
  )
}

function AdminBtn({
  children,
  onClick,
  disabled,
  primary,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  primary?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="footer-btn px-3 py-1.5 text-xs font-bold"
      style={{
        background: primary ? '#E85D2A' : 'var(--bg)',
        color: primary ? '#fff' : 'var(--text-primary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {children}
    </button>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string }> = {
    enrolling: { label: 'Sign-ups open', color: '#E85D2A' },
    running: { label: 'Live', color: '#22c55e' },
    complete: { label: 'Complete', color: '#8b93a1' },
  }
  const s = map[status] ?? { label: status, color: 'var(--text-muted)' }
  return (
    <span
      className="shrink-0 inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-bold uppercase tracking-widest"
      style={{
        background: `color-mix(in srgb, ${s.color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${s.color} 45%, var(--border-subtle))`,
        color: s.color,
        borderRadius: 5,
      }}
    >
      {status === 'running' && (
        <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: s.color }} />
      )}
      {s.label}
    </span>
  )
}

function AdminMatchRow({
  match,
  nameById,
  allowDraw,
  disabled,
  onResult,
}: {
  match: Match
  nameById: Map<string, Player>
  allowDraw: boolean
  disabled: boolean
  onResult: (r: 'p1' | 'p2' | 'draw') => void
}) {
  const p1 = nameById.get(match.player1Id)
  const p2 = match.player2Id ? nameById.get(match.player2Id) : null
  const isBye = match.status === 'bye' || !match.player2Id
  const resolved = match.status === 'confirmed'

  // Local two-step state: first tap arms a selection (green highlight + confirm
  // bar), the Confirm button or a second tap on the same side commits it.
  const [pending, setPending] = useState<'p1' | 'p2' | 'draw' | null>(null)

  const winnerSide: 'p1' | 'p2' | 'draw' | null = resolved
    ? match.winnerId === match.player1Id
      ? 'p1'
      : match.winnerId === match.player2Id
        ? 'p2'
        : 'draw'
    : null

  const choose = (side: 'p1' | 'p2' | 'draw') => {
    if (disabled) return
    if (pending === side) {
      onResult(side)
      setPending(null)
    } else {
      setPending(side)
    }
  }
  const confirm = () => {
    if (disabled || !pending) return
    onResult(pending)
    setPending(null)
  }

  const labelFor = (side: 'p1' | 'p2' | 'draw') =>
    side === 'draw'
      ? 'a draw'
      : side === 'p1'
        ? (p1 ? formatXLabel(p1.xHandle) : 'Player 1')
        : p2
          ? formatXLabel(p2.xHandle)
          : 'Player 2'

  const sideBtn = (which: 'p1' | 'p2', player: Player | null | undefined) => {
    const armed = pending === which
    const won = winnerSide === which
    const green = armed || won
    return (
      <button
        type="button"
        disabled={disabled || !player}
        onClick={() => choose(which)}
        className="flex-1 min-w-0 inline-flex items-center justify-between gap-2 px-2.5 py-1.5 text-sm font-semibold transition-all"
        style={{
          background: won
            ? 'rgba(34,197,94,0.18)'
            : armed
              ? 'rgba(34,197,94,0.10)'
              : 'var(--bg-surface)',
          border: `1px solid ${green ? '#22c55e' : 'var(--border-subtle)'}`,
          boxShadow: armed ? '0 0 0 1px #22c55e inset' : 'none',
          borderRadius: 6,
          color: 'var(--text-primary)',
          cursor: disabled || !player ? 'default' : 'pointer',
          opacity: disabled && !green ? 0.6 : 1,
        }}
      >
        <span className="truncate">{player ? formatXLabel(player.xHandle) : 'TBD'}</span>
        {won ? (
          <Check size={14} strokeWidth={3} style={{ color: '#22c55e', flexShrink: 0 }} />
        ) : armed ? (
          <span className="inline-block w-2 h-2 rounded-full" style={{ background: '#22c55e', flexShrink: 0 }} />
        ) : null}
      </button>
    )
  }

  return (
    <li
      className="flex flex-col gap-2 rounded-md p-2.5 transition-all"
      style={{
        background: 'var(--bg)',
        border: `1px solid ${pending ? '#22c55e' : 'var(--border-subtle)'}`,
      }}
    >
      <div className="flex items-center gap-1.5">
        <span className="shrink-0 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)', width: 28 }}>
          M{match.number}
        </span>
        {isBye ? (
          <span className="flex-1 text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
            {p1 ? formatXLabel(p1.xHandle) : 'TBD'} <span style={{ color: 'var(--text-muted)' }}>- bye</span>
          </span>
        ) : (
          <>
            {sideBtn('p1', p1)}
            <span className="shrink-0 text-[10px] font-bold" style={{ color: 'var(--text-muted)' }}>VS</span>
            {sideBtn('p2', p2)}
          </>
        )}
      </div>

      {!isBye && pending ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>
            Record <strong style={{ color: 'var(--text-primary)' }}>{labelFor(pending)}</strong>
            {pending === 'draw' ? '' : ' as the winner'}?
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={confirm}
            className="inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1"
            style={{ background: '#22c55e', color: '#0a0a0a', borderRadius: 5, cursor: disabled ? 'default' : 'pointer' }}
          >
            <Check size={13} strokeWidth={3} /> Confirm
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => setPending(null)}
            className="text-xs font-semibold px-2 py-1"
            style={{ background: 'transparent', border: '1px solid var(--border-subtle)', borderRadius: 5, color: 'var(--text-muted)', cursor: disabled ? 'default' : 'pointer' }}
          >
            Cancel
          </button>
        </div>
      ) : (
        !isBye &&
        allowDraw && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => choose('draw')}
            className="self-start text-[11px] font-bold uppercase tracking-wider px-2 py-1"
            style={{
              background: winnerSide === 'draw' ? 'color-mix(in srgb, var(--text-primary) 16%, transparent)' : 'transparent',
              border: `1px solid ${winnerSide === 'draw' ? 'var(--text-secondary)' : 'var(--border-subtle)'}`,
              borderRadius: 5,
              color: winnerSide === 'draw' ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: disabled ? 'default' : 'pointer',
            }}
          >
            Draw
          </button>
        )
      )}
    </li>
  )
}

function ParticipantTab({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="footer-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
      style={{
        background: active ? 'var(--text-primary)' : 'var(--bg)',
        color: active ? 'var(--bg)' : 'var(--text-primary)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 6,
      }}
    >
      {label}
      <span
        className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
        style={{
          minWidth: 16,
          height: 16,
          padding: '0 4px',
          borderRadius: 5,
          background: active ? 'var(--bg)' : 'color-mix(in srgb, var(--text-primary) 12%, transparent)',
          color: active ? 'var(--text-primary)' : 'var(--text-muted)',
        }}
      >
        {count}
      </span>
    </button>
  )
}

const STATUS_STYLE: Record<Player['approvalStatus'], { label: string; fg: string; bg: string }> = {
  approved: { label: 'Approved', fg: '#22c55e', bg: 'rgba(34,197,94,0.15)' },
  pending: { label: 'Pending', fg: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
  rejected: { label: 'Rejected', fg: '#ef4444', bg: 'rgba(239,68,68,0.15)' },
}

/**
 * One participant row. The row never disappears on an action - it just
 * restyles its status badge and swaps to the actions that still make
 * sense (approve a rejected/pending player, reject an approved one).
 */
function ParticipantRow({
  player,
  disabled,
  onApprove,
  onReject,
}: {
  player: Player
  disabled: boolean
  onApprove: () => void
  onReject: () => void
}) {
  const url = xProfileUrl(player.xHandle)
  const status = STATUS_STYLE[player.approvalStatus]
  return (
    <li
      className="flex flex-wrap items-center justify-between gap-2 rounded-md px-3 py-2"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border-subtle)',
        opacity: player.approvalStatus === 'rejected' ? 0.7 : 1,
      }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold truncate" style={{ color: '#E85D2A' }}>
          {formatXLabel(player.xHandle)}
          <ExternalLink size={11} strokeWidth={2} style={{ flexShrink: 0, opacity: 0.7 }} />
        </a>
        <span
          className="shrink-0 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: status.fg, background: status.bg, padding: '2px 7px', borderRadius: 5 }}
        >
          {status.label}
        </span>
      </div>
      <div className="flex gap-2">
        {player.approvalStatus !== 'approved' && (
          <AdminBtn disabled={disabled} onClick={onApprove}>
            {player.approvalStatus === 'rejected' ? 'Restore' : 'Approve'}
          </AdminBtn>
        )}
        {player.approvalStatus !== 'rejected' && (
          <AdminBtn disabled={disabled} onClick={onReject}>Reject</AdminBtn>
        )}
      </div>
    </li>
  )
}
