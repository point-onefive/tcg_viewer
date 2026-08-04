'use client'

import Link from 'next/link'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertTriangle, Award, Check, ChevronDown, Clock, Coins, Copy, Crown, ExternalLink, Gift, Hourglass, ImagePlus, KeyRound, ListChecks, Loader2, LogOut, Medal, Palette, PieChart, Plus, Search, Swords, Trash2, Trophy, Upload, Users, X } from 'lucide-react'
import { computeStandings } from '@/lib/tournament/pairing'
import { TournamentShell } from './tournament-shell'
import {
  adminApi,
  apiActiveSnapshot,
  apiPaidGames,
  apiSnapshotByCode,
  clearAdminKey,
  loadAdminKey,
  saveAdminKey,
  type ManualBadgeAward,
} from '@/lib/tournament/client'
import { ModalPortal } from '@/components/ui/modal-portal'
import { BonkModuleHeader, BonkModalClose } from '@/components/tournament/bonk-ui'
import { deckCardCount, MAX_DECK_CHARS } from '@/lib/tournament/deck-list'
import { DeckListBlock } from '@/components/tournament/deck-list-block'
import { compressImageToDataUrl, imageFromClipboard } from '@/lib/tournament/paste-image'
import { normalizeBadgeImageToDataUrl } from '@/lib/tournament/badge-image'
import { formatXLabel, normalizeXHandle, xProfileUrl } from '@/lib/tournament/x-handle'
import { REGIONS, regionShort, type Region } from '@/lib/tournament/region'
import { PAYOUT_PRESET_LABELS, payoutDepth, type PayoutPreset } from '@/lib/tournament/paid'
import { PlayerAvatar } from '@/components/wallet/player-avatar'
import {
  DEFAULT_POLL_QUESTION,
  POLL_OPTIONS,
  POLL_MAX_OPTIONS,
  POLL_MIN_OPTIONS,
  POLL_LABEL_MAX,
  POLL_BLURB_MAX,
  POLL_QUESTION_MAX,
  type PollOption,
} from '@/lib/tournament/poll'
import type { Match, Player, StandingRow, TournamentPrize, TournamentBadgeSlot, TournamentSnapshot, AwardedPrize, PaidGameSummary, PaidNeedsAttention } from '@/lib/tournament/types'
import { themeOptions, setLastAdminTheme } from '@/lib/tournament/theme'
import { PaidEscrowControls, PaidNeedsAttentionCard } from './paid-escrow-controls'

const card: React.CSSProperties = {
  background: 'var(--bg-surface)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
  boxShadow: 'var(--shadow-card)',
}

// Live H:MM:SS countdown to an ISO deadline, mirroring the public-facing round
// timer so the admin panel reads the same value at a glance. Returns '' when no
// deadline is set.
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

function useCountdown(iso: string | null): string {
  const [label, setLabel] = useState(() => fmtCountdown(iso))
  useEffect(() => {
    setLabel(fmtCountdown(iso))
    const t = setInterval(() => setLabel(fmtCountdown(iso)), 1000)
    return () => clearInterval(t)
  }, [iso])
  return label
}

// A faintly tinted card so adjacent admin sections read as distinct blocks
// without shouting. Keep the mix low (a wash, not a fill).
const tintedCard = (tint: string): React.CSSProperties => ({
  ...card,
  background: `color-mix(in srgb, ${tint} 6%, var(--bg-surface))`,
  border: `1px solid color-mix(in srgb, ${tint} 24%, var(--border-subtle))`,
})

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

/** Compact per-region tally for a list of (possibly null) regions. */
function RegionCounts({ regions, className }: { regions: (Region | null)[]; className?: string }) {
  if (regions.length === 0) return null
  const tally = new Map<string, number>()
  for (const r of regions) tally.set(r ?? 'none', (tally.get(r ?? 'none') ?? 0) + 1)
  const chips: { key: string; label: string; count: number }[] = [
    ...REGIONS.map((r) => ({ key: r.id, label: r.short, count: tally.get(r.id) ?? 0 })),
    { key: 'none', label: 'Unspecified', count: tally.get('none') ?? 0 },
  ].filter((c) => c.count > 0)
  return (
    <div className={`flex flex-wrap gap-1.5 ${className ?? ''}`}>
      {chips.map((c) => (
        <span
          key={c.key}
          className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold tabular-nums"
          style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-secondary)' }}
        >
          {c.label}
          <span className="font-display font-bold" style={{ color: 'var(--text-primary)' }}>{c.count}</span>
        </span>
      ))}
    </div>
  )
}

/** Small region tag for a single entry; nothing when the region is unset. */
function RegionTag({ region }: { region: Region | null }) {
  if (!region) return null
  return (
    <span
      className="inline-flex shrink-0 items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
      style={{ background: 'color-mix(in srgb, #3b82f6 12%, var(--bg))', border: '1px solid color-mix(in srgb, #3b82f6 30%, transparent)', borderRadius: 5, color: '#3b82f6' }}
    >
      {regionShort(region)}
    </span>
  )
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

/** Quick round-length presets for the create-paid-game form (value + unit). */
const ROUND_PRESETS: { label: string; value: number; unit: 'min' | 'hour' }[] = [
  { label: '30m', value: 30, unit: 'min' },
  { label: '45m', value: 45, unit: 'min' },
  { label: '1h', value: 1, unit: 'hour' },
  { label: '12h', value: 12, unit: 'hour' },
  { label: '24h', value: 24, unit: 'hour' },
  { label: '48h', value: 48, unit: 'hour' },
]

/**
 * Two-mode admin console, one component, two routes:
 *  - `featured` (/tournaments/sponsored/admin): the sponsored/featured event.
 *    Start-fresh form + featured-event management + the next-event waitlist.
 *  - `paid` (/tournaments/paid/admin): the always-on paid lobbies. Create-paid
 *    form + a switcher over open paid games + management of the selected one.
 * The two surfaces are deliberately separate so the sponsored flow and the
 * paid flow never get mixed up. All the shared management chrome (approvals,
 * rounds, results, overrides) is identical and just retargets whichever
 * tournament is loaded.
 */
export function TournamentAdmin({ mode = 'featured' }: { mode?: 'featured' | 'paid' }) {
  const isPaidMode = mode === 'paid'
  const [adminKey, setAdminKey] = useState('')
  const [unlocked, setUnlocked] = useState(false)
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  // Which tournament the panel is managing. In featured mode this stays null
  // and the panel loads the featured live event. In paid mode it holds the
  // code of the selected paid lobby, routing every control below at it
  // (approvals/start/results/overrides). `paidGames` powers the switcher
  // (enrolling + running).
  const [manageCode, setManageCode] = useState<string | null>(null)
  const [paidGames, setPaidGames] = useState<PaidGameSummary[]>([])
  // Paid-mode "needs attention" signal (disputes, stuck settles, refundable
  // games) + key-availability flags. Refreshed alongside the switcher.
  const [paidAttention, setPaidAttention] = useState<PaidNeedsAttention | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [unlockError, setUnlockError] = useState<string | null>(null)
  const [unlockBusy, setUnlockBusy] = useState(false)

  // Start fresh form - strings so typing "24" doesn't fight number-input quirks
  const [name, setName] = useState('')
  const [signupHours, setSignupHours] = useState('30')
  const [roundHours, setRoundHours] = useState('24')
  const [maxPlayers, setMaxPlayers] = useState('32')
  const [format, setFormat] = useState<'swiss' | 'single-elim'>('swiss')
  // Page theme is chosen up front when starting an event (a tournament keeps
  // its theme for its whole life; there's no mid-event reskin). Starts empty
  // so the operator must pick deliberately - no accidental BONK/default.
  const [themeId, setThemeId] = useState<string>('')
  const [formError, setFormError] = useState<string | null>(null)

  // Create-paid-game form (always-on /tournaments/paid surface). Independent of
  // the featured event, so creating one never touches the live tournament.
  const [paidName, setPaidName] = useState('')
  const [paidEntry, setPaidEntry] = useState('10') // dollars
  const [paidRakePct, setPaidRakePct] = useState('15')
  const [paidPreset, setPaidPreset] = useState<PayoutPreset>('top3')
  const [paidCap, setPaidCap] = useState('16')
  // Flexible round length: a value + a unit toggle (minutes / hours), seeded by
  // quick presets. Short rounds = live event; long rounds = async/international.
  const [paidRoundValue, setPaidRoundValue] = useState('24')
  const [paidRoundUnit, setPaidRoundUnit] = useState<'min' | 'hour'>('hour')
  // Optional per-lobby region lock. '' = Open (no requirement).
  const [paidLobbyRegion, setPaidLobbyRegion] = useState<'' | Region>('')
  // Optional shared join code (room passcode). '' = open lobby (no code).
  const [paidJoinCode, setPaidJoinCode] = useState('')
  const [paidThemeId, setPaidThemeId] = useState<string>('')
  const [paidFormError, setPaidFormError] = useState<string | null>(null)
  const [paidBusy, setPaidBusy] = useState(false)
  const [paidCreatedCode, setPaidCreatedCode] = useState<string | null>(null)
  // When a non-complete tournament is already live, "Start new" parks the
  // validated params here and opens a confirm modal instead of firing, so a
  // stray click can't silently take the running event offline.
  const [confirmStart, setConfirmStart] = useState<{
    name: string
    signupMinutes: number
    roundMinutes: number
    format: 'swiss' | 'single-elim'
    maxPlayers: number
    theme?: string
  } | null>(null)
  // Same fat-finger guard for ending a running event: confirm before we lock
  // standings and flip the public page to the podium showcase.
  const [confirmEnd, setConfirmEnd] = useState(false)

  // Which participant bucket the table is showing. Defaults to "all" so an
  // approve/reject never makes a row vanish - it just restyles in place.
  const [tab, setTab] = useState<'all' | 'pending' | 'approved' | 'rejected'>('all')
  // Which player's deck-list modal is open (view + operator override).
  const [deckPlayer, setDeckPlayer] = useState<Player | null>(null)

  // Advisory deck validation, keyed by playerId: does every code resolve to a
  // real card and is the format legal (1 leader + 50 cards)? Fetched in one
  // host-gated call so the roster can badge each entry pass/fail at a glance.
  // Never blocks anything - a brand-new print could read as "unknown".
  const [deckAudit, setDeckAudit] = useState<Map<string, { ok: boolean; hasDeck: boolean; issues: string[] }>>(
    new Map(),
  )

  // Next-event waitlist (people queued for the NEXT tournament, separate from
  // the current event's sign-ups). Auto-converted into pending sign-ups when a
  // fresh tournament is started.
  const [waitlist, setWaitlist] = useState<
    { id: string; xHandle: string; walletAddress: string; region: Region | null; createdAt: string }[]
  >([])

  // Transient "copied!" feedback for the copy-handles buttons.
  const [copiedHandles, setCopiedHandles] = useState(false)
  const [copiedWaitlist, setCopiedWaitlist] = useState(false)
  const [copiedPairings, setCopiedPairings] = useState(false)
  const [copiedOpenPairings, setCopiedOpenPairings] = useState(false)

  // Admin lists can grow long; show a slice with a "Load more" toggle.
  const [waitlistLimit, setWaitlistLimit] = useState(8)
  const [rosterLimit, setRosterLimit] = useState(8)

  // Deck-list content search: find every entrant whose submitted list contains
  // a given substring (e.g. a card id like "ST31-036"), regardless of approval
  // status. Deck text never reaches the client - the server returns only the
  // matching player ids and a few context lines. `deckSearchResults` is null
  // when no search is active, restoring the normal tabbed roster view.
  const [deckSearch, setDeckSearch] = useState('')
  const [deckSearchResults, setDeckSearchResults] = useState<
    { playerId: string; matchedLines: string[] }[] | null
  >(null)
  const [deckSearchBusy, setDeckSearchBusy] = useState(false)
  const [deckSearchError, setDeckSearchError] = useState<string | null>(null)

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
    let activeCode: string | undefined
    // Paid mode never touches the featured event: it loads the selected paid
    // game (or nothing until one is picked/created). Featured mode always loads
    // the featured live event.
    try {
      if (isPaidMode) {
        if (manageCode) {
          const snap = await apiSnapshotByCode(manageCode)
          setSnapshot(snap)
          activeCode = snap.tournament.code
        } else {
          setSnapshot(null)
        }
      } else {
        const snap = await apiActiveSnapshot()
        setSnapshot(snap)
        activeCode = snap.tournament.code
      }
      setError(null)
    } catch (err) {
      setSnapshot(null)
      setError(err instanceof Error ? err.message : 'Load failed')
    }
    // Refresh the paid-lobby switcher list (enrolling + running games). Best
    // effort: a missing table or unconfigured escrow just leaves it empty.
    // In paid mode, auto-select the newest open game when none is chosen yet.
    try {
      const pg = await apiPaidGames()
      setPaidGames(pg.games)
      if (isPaidMode && !manageCode && pg.games.length > 0) {
        setManageCode(pg.games[0].code)
      }
    } catch {
      /* leave the current list in place */
    }
    // Paid-mode "needs attention" signal. Best-effort, paid console only.
    if (isPaidMode) {
      try {
        const r = await adminApi(key, { action: 'paid-attention' })
        setPaidAttention(r.attention ?? null)
      } catch {
        /* leave the current signal in place */
      }
    }
    // Pull the next-event waitlist too. Best-effort: a missing table (migration
    // not yet applied) just leaves the list empty, never blocks the panel.
    try {
      const r = await adminApi(key, { action: 'list-waitlist' })
      setWaitlist(r.entries ?? [])
    } catch {
      setWaitlist([])
    }
    // Deck validation audit for every entry (advisory pass/fail badges). Best
    // effort: any failure just clears the badges, never blocks the panel.
    if (activeCode) {
      try {
        const r = await adminApi(key, { action: 'deck-audit', code: activeCode })
        const next = new Map<string, { ok: boolean; hasDeck: boolean; issues: string[] }>()
        for (const row of r.results ?? []) {
          next.set(row.playerId, { ok: row.ok, hasDeck: row.hasDeck, issues: row.issues })
        }
        setDeckAudit(next)
      } catch {
        setDeckAudit(new Map())
      }
    }
  }, [manageCode, isPaidMode])

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

  function startFresh(params: {
    name: string
    signupMinutes: number
    roundMinutes: number
    format: 'swiss' | 'single-elim'
    maxPlayers: number
    theme?: string
  }) {
    run(async () => {
      const r = await adminApi(adminKey, { action: 'start-fresh', ...params })
      setMsg(`Started ${r.code}`)
      setName('')
    })
  }

  async function createPaidGame(params: {
    name: string
    entryFeeUsdc: number
    rakeBps: number
    payoutPreset: PayoutPreset
    maxPlayers: number
    roundMinutes: number
    theme?: string
    lobbyRegion?: Region | null
    joinPassword?: string | null
  }) {
    setPaidBusy(true)
    setPaidFormError(null)
    try {
      const r = await adminApi(adminKey, { action: 'create-paid-game', ...params })
      setPaidCreatedCode(r.code ?? null)
      setMsg(`Paid game created: ${r.code}`)
      setPaidName('')
      setPaidJoinCode('')
    } catch (e) {
      setPaidFormError(e instanceof Error ? e.message : 'Could not create paid game.')
    } finally {
      setPaidBusy(false)
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
  // Dropped and rejected sign-ups no longer occupy a slot in the field, so they
  // are excluded from the pending/approved buckets, the "All" roster, the copy
  // handles, and every roster count. Rejected are still viewable in their own
  // tab; dropped fall out of the roster entirely (they're out of the event).
  const pending = players.filter((p) => p.approvalStatus === 'pending' && !p.dropped)
  const approved = players.filter((p) => p.approvalStatus === 'approved' && !p.dropped)
  // Paid events only seat funded entrants, so gate "Start round 1" on funded
  // approved players (not just approved) to avoid a server error for
  // approved-but-unfunded rosters. Featured events have no funding step.
  const fundedApproved = approved.filter((p) => p.funded)
  const canStartRound1 = isPaidMode ? fundedApproved.length >= 2 : approved.length >= 2
  const rejected = players.filter((p) => p.approvalStatus === 'rejected')
  const active = players.filter((p) => !p.dropped && p.approvalStatus !== 'rejected')
  // Approved players still owing a deck list block the bracket start.
  const missingDeck = approved.filter((p) => !p.hasDeckList)
  const visiblePlayers =
    tab === 'pending' ? pending : tab === 'approved' ? approved : tab === 'rejected' ? rejected : active

  // X handles for whichever tab is showing, one per line as "@handle", for
  // pinging the group. Skips anyone missing a handle and de-dupes.
  const visibleHandles = [
    ...new Set(
      visiblePlayers
        .map((p) => p.xHandle?.trim().replace(/^@+/, ''))
        .filter((h): h is string => Boolean(h)),
    ),
  ].map((h) => `@${h}`)

  async function copyHandles() {
    if (visibleHandles.length === 0) return
    try {
      await navigator.clipboard.writeText(visibleHandles.join('\n'))
      setCopiedHandles(true)
      setTimeout(() => setCopiedHandles(false), 1600)
    } catch {
      // Clipboard can be blocked (permissions / insecure context); no-op.
    }
  }

  // Waitlist X handles, one per line as "@handle". Only one status here, so no
  // filtering - it's a straight copy of everyone waiting.
  const waitlistHandles = [
    ...new Set(
      waitlist
        .map((w) => w.xHandle?.trim().replace(/^@+/, ''))
        .filter((h): h is string => Boolean(h)),
    ),
  ].map((h) => `@${h}`)

  async function copyWaitlistHandles() {
    if (waitlistHandles.length === 0) return
    try {
      await navigator.clipboard.writeText(waitlistHandles.join('\n'))
      setCopiedWaitlist(true)
      setTimeout(() => setCopiedWaitlist(false), 1600)
    } catch {
      // Clipboard can be blocked (permissions / insecure context); no-op.
    }
  }

  const nameById = useMemo(() => new Map(players.map((p) => [p.id, p])), [players])
  const status = snapshot?.tournament.status

  // Debounced deck-list content search. An empty query clears results and
  // restores the normal roster; otherwise we ask the server (deck text stays
  // server-side) and keep the matched player ids + context snippets.
  useEffect(() => {
    const q = deckSearch.trim()
    if (!q || !code || !unlocked || !adminKey) {
      setDeckSearchResults(null)
      setDeckSearchError(null)
      setDeckSearchBusy(false)
      return
    }
    let cancelled = false
    setDeckSearchBusy(true)
    const t = setTimeout(async () => {
      try {
        const r = await adminApi(adminKey, { action: 'deck-search', code, query: q })
        if (cancelled) return
        setDeckSearchResults(r.matches ?? [])
        setDeckSearchError(null)
      } catch (err) {
        if (cancelled) return
        setDeckSearchResults([])
        setDeckSearchError(err instanceof Error ? err.message : 'Search failed')
      } finally {
        if (!cancelled) setDeckSearchBusy(false)
      }
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [deckSearch, code, adminKey, unlocked])

  // Matched players resolved to full player records (in server match order),
  // each carrying the deck-list lines that matched for at-a-glance context.
  const deckSearchActive = deckSearch.trim().length > 0
  const deckSearchRows = useMemo(() => {
    if (!deckSearchResults) return []
    return deckSearchResults
      .map((m) => ({ player: nameById.get(m.playerId), matchedLines: m.matchedLines }))
      .filter((r): r is { player: Player; matchedLines: string[] } => Boolean(r.player))
  }, [deckSearchResults, nameById])

  // Roster capacity for waitlist promotion. Only sign-ups that actually occupy a
  // slot count toward the cap (matches the server-side check): dropped and
  // rejected sign-ups free a slot. `spotsLeft === null` means no cap (unlimited).
  // Promotion is only offered while the event is still enrolling and there's a
  // free slot, so a full roster must free one first.
  const rosterCap = snapshot?.tournament.maxPlayers ?? null
  const activeSignupCount = active.length
  const spotsLeft = rosterCap != null ? Math.max(0, rosterCap - activeSignupCount) : null
  const canPromoteWaitlist = status === 'enrolling' && (spotsLeft == null || spotsLeft > 0)
  // Sign-up timer has elapsed while still 'enrolling' (bracket is started
  // manually, so status never auto-flips). Mirrors the public hero so the
  // panel and the public page never disagree about whether sign-ups are open.
  const enrollExpired = Boolean(
    snapshot?.tournament.status === 'enrolling' &&
      snapshot.tournament.enrollClosesAt &&
      new Date(snapshot.tournament.enrollClosesAt) <= new Date(),
  )
  const activeRound = snapshot?.rounds.find((r) => r.status === 'active')
  // Live round countdown, same source as the public page (active round's
  // deadline). Empty unless an event is running with a deadline on record.
  const roundCountdown = useCountdown(
    status === 'running' ? activeRound?.endsAt ?? null : null,
  )
  // Sign-up countdown for the enrolling phase - same header pill slot as the
  // round timer, so the operator can glance at how long until the window
  // closes (and extend from the buttons just below).
  const signupCountdown = useCountdown(
    status === 'enrolling' ? snapshot?.tournament.enrollClosesAt ?? null : null,
  )
  const activeMatches = useMemo(
    () =>
      (snapshot?.matches ?? [])
        .filter((m) => activeRound && m.roundId === activeRound.id)
        .sort((a, b) => a.number - b.number),
    [snapshot?.matches, activeRound],
  )

  // "@p1 vs @p2" per head-to-head, one per line, for pasting a round-pairings
  // announcement. Byes have no opponent, so they're skipped. Mirrors the
  // copy-handles buttons on the roster/waitlist panels.
  const buildPairingLines = useCallback(
    (matches: Match[]) => {
      const at = (id: string | null) => {
        const h = id ? nameById.get(id)?.xHandle?.trim().replace(/^@+/, '') : ''
        return h ? `@${h}` : null
      }
      return matches
        .filter((m) => m.player2Id && m.status !== 'bye')
        .map((m) => {
          const a = at(m.player1Id)
          const b = at(m.player2Id)
          return a && b ? `${a} vs ${b}` : null
        })
        .filter((line): line is string => Boolean(line))
    },
    [nameById],
  )

  // Every head-to-head in the round.
  const pairingLines = useMemo(() => buildPairingLines(activeMatches), [buildPairingLines, activeMatches])
  // Only the ones still to be played: 'pending' (awaiting the match). Excludes
  // confirmed (done), reported (awaiting confirmation), and disputed (awaiting
  // the host's ruling) - those matches have already happened.
  const openPairingLines = useMemo(
    () => buildPairingLines(activeMatches.filter((m) => m.status === 'pending')),
    [buildPairingLines, activeMatches],
  )

  async function copyLines(lines: string[], mark: (v: boolean) => void) {
    if (lines.length === 0) return
    try {
      await navigator.clipboard.writeText(lines.join('\n'))
      mark(true)
      setTimeout(() => mark(false), 1600)
    } catch {
      // Clipboard can be blocked (permissions / insecure context); no-op.
    }
  }
  // Matches in the active round that have no confirmed result yet - surfaced in
  // the "end tournament" confirm so the host knows what gets frozen.
  const openMatchCount = activeMatches.filter(
    (m) => m.status !== 'confirmed' && m.status !== 'bye',
  ).length
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
  const dropPlayer = (p: Player) =>
    run(async () => {
      if (!code) return
      await adminApi(adminKey, { action: 'drop-player', code, playerId: p.id })
      setMsg(`Dropped @${p.xHandle}`)
    })
  const promoteFromWaitlist = (entryId: string) =>
    run(async () => {
      if (!code) return
      const res = await adminApi(adminKey, { action: 'promote-waitlist', code, entryId })
      const handle = res.xHandle ?? 'player'
      setMsg(
        res.alreadyIn
          ? `${handle} was already signed up - cleared from waitlist`
          : `Promoted ${handle} into sign-ups (pending)`,
      )
    })
  const removeFromWaitlist = (entryId: string, handle: string) => {
    if (!window.confirm(`Remove ${handle} from the waitlist?`)) return
    run(async () => {
      const res = await adminApi(adminKey, { action: 'remove-waitlist', entryId })
      setMsg(`Removed ${res.xHandle ?? handle} from waitlist`)
    })
  }

  const setPollOpen = (open: boolean) =>
    run(async () => {
      if (!code) return
      await adminApi(adminKey, { action: 'set-poll', code, open })
      setMsg(open ? 'Poll voting reopened' : 'Poll voting stopped')
    })

  return (
    <TournamentShell>
      <div className="mx-auto max-w-2xl flex flex-col gap-6">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isPaidMode ? (
              <Coins size={20} style={{ color: 'var(--tcw-accent)' }} />
            ) : (
              <Crown size={20} style={{ color: 'var(--tcw-accent)' }} />
            )}
            <h2 className="font-display text-xl font-bold">
              {isPaidMode ? 'Paid tournament admin' : 'Featured tournament admin'}
            </h2>
          </div>
          {unlocked && (
            <button
              type="button"
              onClick={doLogout}
              className="footer-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
            >
              <LogOut size={13} /> Log out
            </button>
          )}
        </div>

        {/* Cross-link to the other admin surface, so the sponsored and paid
            consoles stay clearly separate but one hop apart. */}
        <Link
          href={isPaidMode ? '/tournaments/sponsored/admin' : '/tournaments/paid/admin'}
          className="inline-flex items-center gap-1.5 self-start text-xs font-bold"
          style={{ color: 'var(--tcw-accent)' }}
        >
          {isPaidMode ? (
            <>
              <Crown size={13} /> Go to featured tournament admin
            </>
          ) : (
            <>
              <Coins size={13} /> Go to paid tournament admin
            </>
          )}
        </Link>

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
              style={{ background: 'var(--tcw-accent)', color: '#fff', borderRadius: 6, opacity: !adminKey.trim() || unlockBusy ? 0.6 : 1 }}
            >
              {unlockBusy && <Loader2 size={14} className="animate-spin" />}
              {unlockBusy ? 'Verifying…' : 'Unlock'}
            </button>
          </form>
        ) : (
          <>
            {/* Paid-mode switcher: pick which open lobby the controls below
                (approve, start, results, round overrides) target. Only the
                paid console shows this; the featured console always manages
                the featured event. */}
            {isPaidMode && (
              <div className="p-4 flex flex-col gap-2" style={card}>
                <span
                  className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <ListChecks size={12} style={{ color: 'var(--tcw-accent)' }} /> Managing lobby
                </span>
                {paidGames.length === 0 ? (
                  <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                    No paid lobbies open yet. Create one below and it&rsquo;ll appear here to manage.
                  </p>
                ) : (
                  <>
                    <div className="relative">
                      <select
                        aria-label="Paid lobby to manage"
                        value={manageCode ?? ''}
                        onChange={(e) => setManageCode(e.target.value || null)}
                        className="w-full appearance-none"
                        style={{ background: 'var(--bg)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '9px 36px 9px 12px', fontSize: 14, cursor: 'pointer' }}
                      >
                        {paidGames.map((g) => (
                          <option key={g.code} value={g.code}>
                            {g.code} · {g.name} ({g.status})
                          </option>
                        ))}
                      </select>
                      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    </div>
                    {manageCode && (
                      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                        Approvals, start, results, and round controls below all apply to{' '}
                        <strong>{manageCode}</strong>. Pick another lobby to switch.
                      </p>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Needs-attention signal - paid console only. Read-only heads-up
                for disputes, stuck settles, and refundable games, plus the
                OPTIONAL global pause/unpause (owner key). */}
            {isPaidMode && paidAttention && (
              <PaidNeedsAttentionCard
                attention={paidAttention}
                adminKey={adminKey}
                busy={busy}
                onSelect={(c) => setManageCode(c)}
                onDone={() => refresh(adminKey)}
              />
            )}

            {error && !snapshot && (
              <div className="p-4 text-sm" style={{ ...card, color: '#ef4444' }}>{error}</div>
            )}

            {/* Start fresh - featured console only. */}
            {!isPaidMode && (
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
                if (!themeId) {
                  setFormError('Select a page theme before starting.')
                  return
                }
                setLastAdminTheme(themeId)
                const params = {
                  name: name.trim() || 'Card Wall Tournament',
                  signupMinutes: signup * 60,
                  roundMinutes: round * 60,
                  format,
                  maxPlayers: max,
                  theme: themeId,
                }
                // Guard against fat-fingering: if the featured event is still
                // live (enrolling or running), confirm before taking it offline.
                // When managing a paid lobby the loaded snapshot is that game,
                // not the featured event, so it never triggers this warning
                // (start-fresh only ever replaces the featured event).
                const ongoing = Boolean(
                  !manageCode && snapshot && snapshot.tournament.status !== 'complete',
                )
                if (ongoing) {
                  setConfirmStart(params)
                  return
                }
                startFresh(params)
              }}
            >
              <div className="flex items-center gap-2">
                <Trophy size={16} style={{ color: 'var(--tcw-accent)' }} />
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

              <div>
                <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  <Palette size={12} style={{ color: 'var(--tcw-accent)' }} /> Page theme
                </span>
                <div className="relative">
                  <select
                    aria-label="Page theme"
                    value={themeId}
                    onChange={(e) => setThemeId(e.target.value)}
                    className="w-full appearance-none"
                    style={{
                      background: 'var(--bg)',
                      color: themeId ? 'var(--text-primary)' : 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 6,
                      padding: '9px 36px 9px 12px',
                      fontSize: 14,
                      cursor: 'pointer',
                    }}
                  >
                    <option value="" disabled>
                      Select theme
                    </option>
                    {themeOptions().map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    aria-hidden
                    className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2"
                    style={{ color: 'var(--text-muted)' }}
                  />
                </div>
                <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                  Sets the public page look for this event (palette, hero, scenes, lockup). Each event keeps its own theme for its whole life.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <PositiveIntInput label="Sign-up hours" value={signupHours} onChange={setSignupHours} placeholder="30" />
                <PositiveIntInput label="Round hours" value={roundHours} onChange={setRoundHours} placeholder="24" />
              </div>
              <PlayerCapPicker value={maxPlayers} onChange={setMaxPlayers} format={format} />
              {formError && (
                <p className="text-sm" style={{ color: '#ef4444' }} role="alert">{formError}</p>
              )}
              <button type="submit" disabled={busy} className="footer-btn py-2 text-sm font-bold" style={{ background: 'var(--text-primary)', color: 'var(--bg)', borderRadius: 6 }}>
                {busy ? 'Working…' : `Start new (${format === 'swiss' ? 'Swiss' : 'Single elim'})`}
              </button>
            </form>
            )}

            {/* Create paid game - paid console only. Always-on /tournaments/paid
                surface, separate from the featured event: creating one never
                takes the live event offline, and you can open as many as you
                want. Swiss only (the hard-deadline autopilot is built for it). */}
            {isPaidMode && (
            <form
              className="p-5 flex flex-col gap-3"
              style={card}
              onSubmit={(e) => {
                e.preventDefault()
                setPaidFormError(null)
                const dollars = Number(paidEntry)
                const rakePct = Number(paidRakePct)
                const cap = parsePositiveInt(paidCap)
                const roundVal = parsePositiveInt(paidRoundValue)
                if (!Number.isFinite(dollars) || dollars <= 0) {
                  setPaidFormError('Entry fee must be a positive dollar amount.')
                  return
                }
                if (!Number.isFinite(rakePct) || rakePct < 0 || rakePct > 20) {
                  setPaidFormError('Rake must be between 0 and 20 percent.')
                  return
                }
                const depth = payoutDepth(paidPreset)
                if (cap == null || cap < depth) {
                  setPaidFormError(`Player cap must be at least the payout depth (${depth}).`)
                  return
                }
                if (roundVal == null) {
                  setPaidFormError('Round length must be a whole number greater than 0.')
                  return
                }
                const roundMinutes = paidRoundUnit === 'hour' ? roundVal * 60 : roundVal
                if (roundMinutes < 15) {
                  setPaidFormError('Round length must be at least 15 minutes.')
                  return
                }
                createPaidGame({
                  name: paidName.trim() || 'Paid Card Wall Game',
                  entryFeeUsdc: Math.round(dollars * 1_000_000),
                  rakeBps: Math.round(rakePct * 100),
                  payoutPreset: paidPreset,
                  maxPlayers: cap,
                  roundMinutes,
                  theme: paidThemeId || undefined,
                  lobbyRegion: paidLobbyRegion || null,
                  joinPassword: paidJoinCode.trim() || null,
                })
              }}
            >
              <div className="flex items-center gap-2">
                <Gift size={16} style={{ color: 'var(--tcw-accent)' }} />
                <h3 className="font-display font-bold">Create paid game</h3>
              </div>
              <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.4 }}>
                Opens an always-on entry-fee game on the /tournaments/paid lobby. Players
                register and pay; you approve them, then start it and it runs on autopilot
                (hard round deadlines, auto-payout). Does not affect the featured event.
              </p>
              <input style={inputStyle} value={paidName} onChange={(e) => setPaidName(e.target.value)} placeholder="Game name" />

              <div className="grid grid-cols-2 gap-2">
                <PositiveIntInput label="Entry ($ USDC)" value={paidEntry} onChange={setPaidEntry} placeholder="10" />
                <PositiveIntInput label="Platform fee (%)" value={paidRakePct} onChange={setPaidRakePct} placeholder="15" />
              </div>

              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Payout
                </span>
                <div className="relative">
                  <select
                    aria-label="Payout preset"
                    value={paidPreset}
                    onChange={(e) => setPaidPreset(e.target.value as PayoutPreset)}
                    className="w-full appearance-none"
                    style={{ background: 'var(--bg)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '9px 36px 9px 12px', fontSize: 14, cursor: 'pointer' }}
                  >
                    {(Object.keys(PAYOUT_PRESET_LABELS) as PayoutPreset[]).map((p) => (
                      <option key={p} value={p}>{PAYOUT_PRESET_LABELS[p]}</option>
                    ))}
                  </select>
                  <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>

              <PositiveIntInput label="Player cap" value={paidCap} onChange={setPaidCap} placeholder="16" />

              {/* Flexible round length: quick presets + a custom value with a
                  minutes / hours unit toggle. Short = live, long = async. */}
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Round length
                </span>
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {ROUND_PRESETS.map((p) => {
                    const activePreset =
                      parsePositiveInt(paidRoundValue) === p.value && paidRoundUnit === p.unit
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => {
                          setPaidRoundValue(String(p.value))
                          setPaidRoundUnit(p.unit)
                        }}
                        className="rounded-md px-2.5 py-1 text-xs font-bold"
                        style={{
                          background: activePreset ? 'var(--tcw-accent)' : 'var(--bg)',
                          color: activePreset ? 'var(--bg)' : 'var(--text-secondary)',
                          border: '1px solid var(--border-subtle)',
                        }}
                      >
                        {p.label}
                      </button>
                    )
                  })}
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <PositiveIntInput label="Custom value" value={paidRoundValue} onChange={setPaidRoundValue} placeholder="24" />
                  <label className="text-xs">
                    <span style={{ color: 'var(--text-muted)' }}>Unit</span>
                    <div className="relative">
                      <select
                        aria-label="Round length unit"
                        value={paidRoundUnit}
                        onChange={(e) => setPaidRoundUnit(e.target.value as 'min' | 'hour')}
                        className="w-full appearance-none"
                        style={{ background: 'var(--bg)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '9px 36px 9px 12px', fontSize: 14, cursor: 'pointer' }}
                      >
                        <option value="min">Minutes</option>
                        <option value="hour">Hours</option>
                      </select>
                      <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                    </div>
                  </label>
                </div>
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  Short rounds mean a live event where players stay active for the whole
                  tournament. Long rounds mean an async / international event where players
                  schedule within a wide window. Minimum 15 minutes.
                </p>
              </div>

              {/* Optional per-lobby region lock. Open admits everyone; a region
                  only admits that area (eligibility only, never a win-determinant). */}
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Region requirement
                </span>
                <div className="relative">
                  <select
                    aria-label="Lobby region requirement"
                    value={paidLobbyRegion}
                    onChange={(e) => setPaidLobbyRegion(e.target.value as '' | Region)}
                    className="w-full appearance-none"
                    style={{ background: 'var(--bg)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '9px 36px 9px 12px', fontSize: 14, cursor: 'pointer' }}
                  >
                    <option value="">Open (no requirement)</option>
                    {REGIONS.map((r) => (
                      <option key={r.id} value={r.id}>{r.label} ({r.short})</option>
                    ))}
                  </select>
                  <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>

              {/* Optional shared join code (a room passcode). Leave blank for an
                  open lobby; set a code to share the lobby privately. */}
              <div>
                <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  Join code (optional)
                </span>
                <input
                  style={inputStyle}
                  value={paidJoinCode}
                  onChange={(e) => setPaidJoinCode(e.target.value)}
                  placeholder="e.g. APAC-2024"
                  autoComplete="off"
                />
                <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
                  Leave blank for an open lobby. Set a code to share privately (e.g. with your
                  APAC group) - only players who enter it can register.
                </p>
              </div>

              <div>
                <span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
                  <Palette size={12} style={{ color: 'var(--tcw-accent)' }} /> Page theme (optional)
                </span>
                <div className="relative">
                  <select
                    aria-label="Paid game theme"
                    value={paidThemeId}
                    onChange={(e) => setPaidThemeId(e.target.value)}
                    className="w-full appearance-none"
                    style={{ background: 'var(--bg)', color: paidThemeId ? 'var(--text-primary)' : 'var(--text-muted)', border: '1px solid var(--border-subtle)', borderRadius: 6, padding: '9px 36px 9px 12px', fontSize: 14, cursor: 'pointer' }}
                  >
                    <option value="">Blank house theme (default)</option>
                    {themeOptions()
                      .filter((o) => o.id !== 'house')
                      .map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                  </select>
                  <ChevronDown size={16} aria-hidden className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
                </div>
              </div>

              {paidCreatedCode && (
                <p className="text-xs" style={{ color: '#22c55e' }}>
                  Created <strong>{paidCreatedCode}</strong> - live at /tournaments/paid/{paidCreatedCode}
                </p>
              )}
              {paidFormError && (
                <p className="text-sm" style={{ color: '#ef4444' }} role="alert">{paidFormError}</p>
              )}
              <button type="submit" disabled={paidBusy} className="footer-btn py-2 text-sm font-bold" style={{ background: 'var(--tcw-accent)', color: 'var(--bg)', borderRadius: 6 }}>
                {paidBusy ? 'Working…' : 'Create paid game'}
              </button>
            </form>
            )}

            {confirmStart && snapshot && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Confirm new tournament"
                className="fixed inset-0 z-[200] flex items-center justify-center p-4"
                style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)' }}
                onClick={() => setConfirmStart(null)}
              >
                <div className="w-full max-w-md p-5" style={{ ...card, borderRadius: 12 }} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <AlertTriangle size={18} style={{ color: '#f5b301', flexShrink: 0 }} />
                    <h3 className="font-display font-bold">A tournament is already live</h3>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    <strong>{snapshot.tournament.name}</strong> ({code}) is currently{' '}
                    {status === 'running' ? (
                      <>running with {approved.length} player{approved.length === 1 ? '' : 's'} in the bracket</>
                    ) : (
                      <>taking sign-ups with {approved.length + pending.length} registered</>
                    )}
                    . Starting a new event takes this one offline immediately and makes the new one the live tournament.
                  </p>
                  <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    This can&rsquo;t be undone from here. Start a new {confirmStart.format === 'swiss' ? 'Swiss' : 'Single elim'} event anyway?
                  </p>
                  <div className="mt-4 flex gap-2 justify-end">
                    <AdminBtn disabled={busy} onClick={() => setConfirmStart(null)}>Cancel</AdminBtn>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        const p = confirmStart
                        setConfirmStart(null)
                        startFresh(p)
                      }}
                      className="footer-btn py-2 px-4 text-sm font-bold"
                      style={{ background: '#dc2626', color: '#fff', borderRadius: 6 }}
                    >
                      {busy ? 'Working…' : 'Take it offline & start new'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {confirmEnd && snapshot && code && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Confirm end tournament"
                className="fixed inset-0 z-[200] flex items-center justify-center p-4"
                style={{ background: 'rgba(0,0,0,0.62)', backdropFilter: 'blur(4px)' }}
                onClick={() => setConfirmEnd(false)}
              >
                <div className="w-full max-w-md p-5" style={{ ...card, borderRadius: 12 }} onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-2 mb-2.5">
                    <Crown size={18} style={{ color: '#f5b301', flexShrink: 0 }} />
                    <h3 className="font-display font-bold">End the tournament now?</h3>
                  </div>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    This locks the current standings for <strong>{snapshot.tournament.name}</strong>,
                    reveals the final podium, and auto-awards prizes by placement (any unresolved
                    tie on a prize spot is left for you to award manually).
                  </p>
                  {openMatchCount > 0 && (
                    <p
                      className="text-sm mt-2 flex items-start gap-1.5 rounded-md px-3 py-2"
                      style={{ color: 'var(--text-primary)', background: 'rgba(245,179,1,0.12)', border: '1px solid rgba(245,179,1,0.45)', lineHeight: 1.5 }}
                    >
                      <AlertTriangle size={15} style={{ color: '#f5b301', flexShrink: 0, marginTop: 1 }} />
                      <span>
                        {openMatchCount} match{openMatchCount === 1 ? '' : 'es'} in the current round
                        {openMatchCount === 1 ? ' is' : ' are'} still open. Any single-sided report is
                        locked to its reported winner; matches with no result are frozen unplayed.
                      </span>
                    </p>
                  )}
                  <p className="text-sm mt-2" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                    The next-event waitlist stays open. No new sign-ups begin until you start a fresh
                    event.
                  </p>
                  <div className="mt-4 flex gap-2 justify-end">
                    <AdminBtn disabled={busy} onClick={() => setConfirmEnd(false)}>Cancel</AdminBtn>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        setConfirmEnd(false)
                        run(() => adminApi(adminKey, { action: 'end-tournament', code }).then(() => setMsg('Tournament ended - podium is live')))
                      }}
                      className="footer-btn py-2 px-4 text-sm font-bold"
                      style={{ background: '#f5b301', color: '#1a1a1a', borderRadius: 6 }}
                    >
                      {busy ? 'Working…' : 'End & reveal podium'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {snapshot && code && (
              <>
                {/* Escrow controls - paid console only, targeting the selected
                    lobby: stop-the-world cancel (opens refunds), refund/kick a
                    funded player pre-lock, and the manual-settle escape hatch. */}
                {isPaidMode && snapshot.tournament.isPaid && (
                  <PaidEscrowControls
                    snapshot={snapshot}
                    adminKey={adminKey}
                    busy={busy}
                    onDone={() => refresh(adminKey)}
                    operatorConfigured={paidAttention?.operatorConfigured ?? true}
                  />
                )}
                <div className="p-5" style={tintedCard('#64748b')}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
                    <div className="min-w-0">
                      <p className="font-display text-lg font-bold truncate">{snapshot.tournament.name}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                        {code} · {snapshot.tournament.format === 'single-elim' ? 'Single elim' : 'Swiss'} · {approved.length} verified
                        {pending.length > 0 ? ` · ${pending.length} pending` : ''}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {status === 'enrolling' && signupCountdown && (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold tabular-nums"
                          style={{
                            background: 'var(--bg)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 999,
                            color: enrollExpired ? '#f5b301' : 'var(--text-secondary)',
                          }}
                          title={
                            enrollExpired
                              ? 'Sign-up window has closed'
                              : `Sign-ups close in ${signupCountdown}`
                          }
                        >
                          <Clock size={12} style={{ color: enrollExpired ? '#f5b301' : 'var(--tcw-accent)' }} />
                          {signupCountdown}
                        </span>
                      )}
                      {status === 'running' && activeRound && roundCountdown && (
                        <span
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold tabular-nums"
                          style={{
                            background: 'var(--bg)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 999,
                            color: 'var(--text-secondary)',
                          }}
                          title={`Round ${activeRound.number} ends in ${roundCountdown}`}
                        >
                          <Clock size={12} style={{ color: 'var(--tcw-accent)' }} />
                          {roundCountdown}
                        </span>
                      )}
                      <StatusBadge status={status ?? 'enrolling'} enrollExpired={enrollExpired} />
                    </div>
                  </div>

                  {status === 'enrolling' && (
                    <>
                      {enrollExpired && (
                        <div
                          className="mt-4 flex items-start gap-2 px-3 py-2.5"
                          style={{
                            background: 'color-mix(in srgb, #f5b301 12%, var(--bg))',
                            border: '1px solid color-mix(in srgb, #f5b301 45%, var(--border-subtle))',
                            borderRadius: 6,
                          }}
                        >
                          <AlertTriangle size={15} style={{ color: '#f5b301', flexShrink: 0, marginTop: 1 }} />
                          <span className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                            The sign-up timer has run out, so the public page now reads{' '}
                            <strong>Sign-ups closed</strong> and no one new can enter. Nothing
                            starts on its own. Use <strong>+1h sign-ups</strong> to reopen the
                            window, or <strong>Start round 1</strong> when you&rsquo;re ready.
                          </span>
                        </div>
                      )}
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
                          disabled={busy || !canStartRound1}
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
                      <MaxPlayersEditor
                        key={code}
                        current={snapshot.tournament.maxPlayers}
                        format={snapshot.tournament.format === 'single-elim' ? 'single-elim' : 'swiss'}
                        registered={approved.length + pending.length}
                        busy={busy}
                        onSave={(cap) =>
                          run(() =>
                            adminApi(adminKey, { action: 'set-max-players', code, maxPlayers: cap }).then(() =>
                              setMsg(`Player cap set to ${cap}`),
                            ),
                          )
                        }
                      />
                      {isPaidMode && <JoinCodeEditor key={`jc-${code}`} adminKey={adminKey} code={code} />}
                    </>
                  )}

                  {status === 'running' && (
                    <div
                      className="mt-4 flex items-center gap-2 px-3 py-2.5"
                      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
                    >
                      <Swords size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />
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

                  {(status === 'enrolling' || status === 'running') && (
                    <RoundLengthEditor
                      key={`rl-${code}`}
                      current={snapshot.tournament.roundMinutes}
                      status={status}
                      activeRoundEndsAt={activeRound?.endsAt ?? null}
                      busy={busy}
                      onSave={(mins) =>
                        run(() =>
                          adminApi(adminKey, { action: 'set-round-minutes', code, roundMinutes: mins }).then(() =>
                            setMsg(`Round length set to ${formatDuration(mins)}`),
                          ),
                        )
                      }
                      onExtend={(mins) =>
                        run(() =>
                          adminApi(adminKey, { action: 'extend-round', code, extraMinutes: mins }).then(() =>
                            setMsg(`Round extended by ${formatDuration(mins)}`),
                          ),
                        )
                      }
                    />
                  )}

                  <div
                    className="mt-4 flex flex-wrap items-center gap-2 px-3 py-2.5"
                    style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
                  >
                    <PieChart size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />
                    <span className="text-sm font-semibold">Feedback poll</span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {snapshot.poll.totalVotes} vote{snapshot.poll.totalVotes === 1 ? '' : 's'} · {pollOpen ? 'open' : 'closed'}
                    </span>
                    <span className="ml-auto">
                      <AdminBtn disabled={busy} onClick={() => setPollOpen(!pollOpen)}>
                        {pollOpen ? 'Stop voting' : 'Reopen voting'}
                      </AdminBtn>
                    </span>
                  </div>

                  {status === 'running' && (
                    <div className="mt-4 flex flex-col items-center gap-2">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmEnd(true)}
                        className="inline-flex items-center justify-center gap-2 px-5 py-2.5 text-sm font-bold transition-opacity hover:opacity-90 disabled:opacity-60"
                        style={{
                          background: 'linear-gradient(180deg, #f5c542 0%, #e0a800 100%)',
                          color: '#1a1a1a',
                          border: '1px solid color-mix(in srgb, #e0a800 70%, #000)',
                          borderRadius: 8,
                          boxShadow: '0 4px 14px color-mix(in srgb, #f5b301 35%, transparent)',
                        }}
                      >
                        <Crown size={15} />
                        End tournament &amp; reveal podium
                      </button>
                      <span className="text-xs text-center" style={{ color: 'var(--text-muted)', lineHeight: 1.4, maxWidth: 360 }}>
                        Locks standings now and shows the podium. The next-event waitlist stays open.
                        No new sign-ups start until you start a fresh event.
                      </span>
                    </div>
                  )}

                  {msg && <p className="mt-3 text-sm" style={{ color: '#22c55e' }}>{msg}</p>}
                  {error && (
                    <p className="mt-3 text-sm font-semibold" style={{ color: '#ef4444' }} role="alert">
                      {error}
                    </p>
                  )}
                </div>

                {activeRound && activeMatches.length > 0 && (
                  <div className="p-5" style={tintedCard('#3b82f6')}>
                    <div className="mb-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex min-w-0 items-center gap-2">
                        <Swords size={16} className="shrink-0" style={{ color: 'var(--tcw-accent)' }} />
                        <h3 className="font-display font-bold whitespace-nowrap">
                          Round {activeRound.number} decisions
                        </h3>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                        {openPairingLines.length > 0 && (
                          <button
                            type="button"
                            onClick={() => void copyLines(openPairingLines, setCopiedOpenPairings)}
                            title="Copy only the matchups still to be played (awaiting the match), as '@p1 vs @p2', one per line"
                            className="footer-btn inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold"
                            style={{
                              background: 'var(--bg)',
                              color: 'var(--text-primary)',
                              border: '1px solid var(--border-subtle)',
                              borderRadius: 6,
                              cursor: 'pointer',
                            }}
                          >
                            {copiedOpenPairings ? (
                              <><Check size={13} style={{ color: '#22c55e' }} /> Copied {openPairingLines.length}</>
                            ) : (
                              <><Copy size={13} /> Copy unplayed ({openPairingLines.length})</>
                            )}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => void copyLines(pairingLines, setCopiedPairings)}
                          disabled={pairingLines.length === 0}
                          title="Copy every matchup in this round as '@p1 vs @p2', one per line"
                          className="footer-btn inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold"
                          style={{
                            background: 'var(--bg)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 6,
                            opacity: pairingLines.length === 0 ? 0.5 : 1,
                            cursor: pairingLines.length === 0 ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {copiedPairings ? (
                            <><Check size={13} style={{ color: '#22c55e' }} /> Copied {pairingLines.length}</>
                          ) : (
                            <><Copy size={13} /> Copy all ({pairingLines.length})</>
                          )}
                        </button>
                        <span className="text-xs tabular-nums" style={{ color: 'var(--text-muted)' }}>
                          {activeMatches.filter((m) => m.status === 'confirmed' || m.status === 'bye').length}/{activeMatches.length} done
                        </span>
                      </div>
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
                          roundEndsAt={activeRound.endsAt ?? null}
                          onResult={(r) => setResult(m.id, r)}
                        />
                      ))}
                    </ul>
                  </div>
                )}

                <div className="p-5" style={tintedCard('#14b8a6')}>
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <h3 className="text-sm font-bold uppercase tracking-wider whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                      Current tournament sign-ups
                    </h3>
                    <button
                      type="button"
                      onClick={copyHandles}
                      disabled={visibleHandles.length === 0}
                      title="Copy the X handles shown in this tab, one per line"
                      className="footer-btn inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold sm:ml-auto"
                      style={{
                        background: 'var(--bg)',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6,
                        opacity: visibleHandles.length === 0 ? 0.5 : 1,
                        cursor: visibleHandles.length === 0 ? 'not-allowed' : 'pointer',
                        alignSelf: 'flex-start',
                      }}
                    >
                      {copiedHandles ? (
                        <><Check size={13} style={{ color: '#22c55e' }} /> Copied {visibleHandles.length}</>
                      ) : (
                        <><Copy size={13} /> Copy handles ({visibleHandles.length})</>
                      )}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5 mb-4">
                    <ParticipantTab label="All" count={active.length} active={tab === 'all'} onClick={() => { setTab('all'); setRosterLimit(8) }} />
                    <ParticipantTab label="Pending" count={pending.length} active={tab === 'pending'} onClick={() => { setTab('pending'); setRosterLimit(8) }} />
                    <ParticipantTab label="Approved" count={approved.length} active={tab === 'approved'} onClick={() => { setTab('approved'); setRosterLimit(8) }} />
                    <ParticipantTab label="Rejected" count={rejected.length} active={tab === 'rejected'} onClick={() => { setTab('rejected'); setRosterLimit(8) }} />
                  </div>

                  {/* Deck-list content search - finds entrants whose submitted
                      list contains a card id / text, across every status. */}
                  <div className="relative mb-4">
                    <Search
                      size={14}
                      className="pointer-events-none absolute top-1/2 -translate-y-1/2"
                      style={{ left: 11, color: 'var(--text-muted)' }}
                    />
                    <input
                      type="text"
                      value={deckSearch}
                      onChange={(e) => setDeckSearch(e.target.value)}
                      placeholder="Search deck lists (e.g. ST31-036)"
                      autoComplete="off"
                      spellCheck={false}
                      style={{ ...inputStyle, paddingLeft: 32, paddingRight: deckSearch ? 34 : 11 }}
                    />
                    {deckSearchBusy ? (
                      <Loader2
                        size={14}
                        className="absolute top-1/2 -translate-y-1/2 animate-spin"
                        style={{ right: 11, color: 'var(--text-muted)' }}
                      />
                    ) : deckSearch ? (
                      <button
                        type="button"
                        onClick={() => setDeckSearch('')}
                        title="Clear search"
                        className="absolute top-1/2 -translate-y-1/2 inline-flex items-center justify-center"
                        style={{ right: 8, color: 'var(--text-muted)' }}
                      >
                        <X size={14} />
                      </button>
                    ) : null}
                  </div>

                  {/* Region mix of the active field (planning signal). */}
                  {!deckSearchActive && (
                    <RegionCounts
                      regions={active.map((p) => p.region)}
                      className="mb-4"
                    />
                  )}

                  {deckSearchActive ? (
                    <>
                      {deckSearchError ? (
                        <p className="text-sm py-4 text-center" style={{ color: '#ef4444' }}>
                          {deckSearchError}
                        </p>
                      ) : deckSearchRows.length === 0 ? (
                        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                          {deckSearchBusy && deckSearchResults === null
                            ? 'Searching deck lists…'
                            : `No deck lists contain "${deckSearch.trim()}".`}
                        </p>
                      ) : (
                        <>
                          <p className="mb-3 text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
                            {deckSearchRows.length} deck{deckSearchRows.length === 1 ? '' : 's'} contain{deckSearchRows.length === 1 ? 's' : ''}{' '}
                            <span style={{ color: 'var(--text-primary)' }}>&ldquo;{deckSearch.trim()}&rdquo;</span>{' '}
                            <span style={{ opacity: 0.75 }}>(all statuses)</span>
                          </p>
                          <ul className="flex flex-col gap-2">
                            {deckSearchRows.map(({ player, matchedLines }) => (
                              <li key={player.id} className="flex flex-col gap-1">
                                <ParticipantRow
                                  player={player}
                                  deckCheck={player.hasDeckList ? deckAudit.get(player.id) : undefined}
                                  disabled={busy}
                                  running={status === 'running'}
                                  showReliability={isPaidMode}
                                  onApprove={() => approvePlayer(player)}
                                  onReject={() => rejectPlayer(player)}
                                  onDrop={() => dropPlayer(player)}
                                  onViewDeck={() => setDeckPlayer(player)}
                                />
                                {matchedLines.length > 0 && (
                                  <p
                                    className="px-3 text-xs tabular-nums"
                                    style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}
                                  >
                                    {matchedLines.join(' · ')}
                                  </p>
                                )}
                              </li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      {missingDeck.length > 0 && (
                        <p
                          className="mb-3 flex items-start gap-1.5 rounded-md px-3 py-2 text-xs font-semibold"
                          style={{ color: 'var(--text-primary)', background: 'rgba(232,93,42,0.1)', border: '1px solid rgba(232,93,42,0.35)', lineHeight: 1.5 }}
                        >
                          <ListChecks size={13} className="mt-0.5 shrink-0" />
                          {missingDeck.length} approved player{missingDeck.length === 1 ? '' : 's'} still
                          {missingDeck.length === 1 ? ' owes' : ' owe'} a deck list. The bracket
                          can&rsquo;t start until every approved player has one.
                        </p>
                      )}

                      {visiblePlayers.length === 0 ? (
                        <p className="text-sm py-4 text-center" style={{ color: 'var(--text-muted)' }}>
                          {active.length === 0 && rejected.length === 0 ? 'No sign-ups yet.' : `No ${tab === 'all' ? '' : tab + ' '}participants.`}
                        </p>
                      ) : (
                        <>
                          <ul className="flex flex-col gap-2">
                            {visiblePlayers.slice(0, rosterLimit).map((p) => (
                              <ParticipantRow
                                key={p.id}
                                player={p}
                                deckCheck={p.hasDeckList ? deckAudit.get(p.id) : undefined}
                                disabled={busy}
                                running={status === 'running'}
                                showReliability={isPaidMode}
                                onApprove={() => approvePlayer(p)}
                                onReject={() => rejectPlayer(p)}
                                onDrop={() => dropPlayer(p)}
                                onViewDeck={() => setDeckPlayer(p)}
                              />
                            ))}
                          </ul>
                          {visiblePlayers.length > rosterLimit && (
                            <div className="mt-3 flex justify-center">
                              <AdminBtn onClick={() => setRosterLimit((n) => n + 12)}>
                                Load more ({visiblePlayers.length - rosterLimit} more)
                              </AdminBtn>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </div>

                {deckPlayer && (
                  <AdminDeckModal
                    key={deckPlayer.id}
                    player={deckPlayer}
                    code={code ?? ''}
                    adminKey={adminKey}
                    canEdit={status === 'enrolling' || status === 'running'}
                    onClose={() => setDeckPlayer(null)}
                    onSaved={() => refresh(adminKey)}
                  />
                )}

                {/* Next event waitlist - featured console only; queued profiles, NOT current sign-ups */}
                {!isPaidMode && (
                <div className="p-5" style={tintedCard('#f5b301')}>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex min-w-0 items-center gap-2">
                      <Hourglass size={16} className="shrink-0" style={{ color: 'var(--tcw-accent)' }} />
                      <h3 className="font-display font-bold whitespace-nowrap">Next event waitlist</h3>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="inline-flex items-center justify-center font-display text-xs font-bold tabular-nums"
                          style={{
                            minWidth: 22,
                            height: 22,
                            padding: '0 6px',
                            background: 'var(--tcw-accent)',
                            color: '#fff',
                            borderRadius: 6,
                          }}
                        >
                          {waitlist.length}
                        </span>
                        <span
                          className="text-xs font-semibold uppercase tracking-wide"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          waiting
                        </span>
                      </span>
                      {waitlist.length > 0 && (
                        <button
                          type="button"
                          onClick={copyWaitlistHandles}
                          title="Copy every waitlist X handle, one per line"
                          className="footer-btn inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1.5 text-xs font-bold"
                          style={{
                            background: 'var(--bg)',
                            color: 'var(--text-primary)',
                            border: '1px solid var(--border-subtle)',
                            borderRadius: 6,
                          }}
                        >
                          {copiedWaitlist ? (
                            <><Check size={13} style={{ color: '#22c55e' }} /> Copied {waitlistHandles.length}</>
                          ) : (
                            <><Copy size={13} /> Copy handles ({waitlistHandles.length})</>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                  <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                    Wallet profiles queued for the <strong>next</strong> tournament (not the current
                    one). When you start a fresh event above, everyone here is auto-added to it as a
                    <strong> pending</strong> sign-up for you to approve or decline, then this list clears.
                  </p>
                  {waitlist.length > 0 && (
                    <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
                      {status !== 'enrolling' ? (
                        <>Promotion is only available while sign-ups are open.</>
                      ) : spotsLeft === 0 ? (
                        <><strong style={{ color: 'var(--tcw-accent)' }}>Sign-ups are full.</strong> Reject or drop someone to free a slot, then you can promote from the waitlist into the current event.</>
                      ) : (
                        <>
                          <strong style={{ color: 'var(--text-primary)' }}>Promote</strong> pulls someone into the current event now as a pending sign-up.{' '}
                          {spotsLeft == null ? 'No player cap set.' : `${spotsLeft} open slot${spotsLeft === 1 ? '' : 's'}.`}
                        </>
                      )}
                    </p>
                  )}
                  {waitlist.length === 0 ? (
                    <p className="mt-3 text-sm py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                      Nobody on the waitlist yet.
                    </p>
                  ) : (
                    <>
                      <RegionCounts regions={waitlist.map((w) => w.region)} />
                      <ul className="mt-3 flex flex-col gap-1.5">
                        {waitlist.slice(0, waitlistLimit).map((w) => (
                          <li
                            key={w.id}
                            className="flex min-w-0 items-center gap-2 px-3 py-2 text-sm"
                            style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
                          >
                            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
                              <a
                                href={xProfileUrl(w.xHandle)}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={w.xHandle}
                                className="min-w-0 truncate font-semibold hover:underline"
                                style={{ color: 'var(--text-primary)' }}
                              >
                                {w.xHandle}
                              </a>
                              <RegionTag region={w.region} />
                              <span className="hidden shrink-0 text-xs tabular-nums sm:inline" style={{ color: 'var(--text-muted)' }}>
                                {new Date(w.createdAt).toLocaleDateString()}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => removeFromWaitlist(w.id, w.xHandle)}
                                disabled={busy}
                                title="Remove from waitlist (they can rejoin later)"
                                aria-label={`Remove ${w.xHandle} from waitlist`}
                                className="footer-btn inline-flex items-center justify-center gap-1 px-2 py-1 text-xs font-bold sm:px-2.5"
                                style={{
                                  background: 'transparent',
                                  color: '#ef4444',
                                  border: '1px solid color-mix(in srgb, #ef4444 40%, var(--border-subtle))',
                                  borderRadius: 6,
                                  opacity: busy ? 0.5 : 1,
                                  cursor: busy ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <X size={14} />
                                <span className="hidden sm:inline">Remove</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => promoteFromWaitlist(w.id)}
                                disabled={busy || !canPromoteWaitlist}
                                title={
                                  canPromoteWaitlist
                                    ? 'Promote into the current event as a pending sign-up'
                                    : status !== 'enrolling'
                                      ? 'Sign-ups are closed'
                                      : 'Sign-ups are full - free a slot first'
                                }
                                aria-label={`Promote ${w.xHandle}`}
                                className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-bold sm:px-2.5"
                                style={{
                                  background: canPromoteWaitlist ? 'var(--tcw-accent)' : 'var(--bg-surface)',
                                  color: canPromoteWaitlist ? '#fff' : 'var(--text-muted)',
                                  border: canPromoteWaitlist ? 'none' : '1px solid var(--border-subtle)',
                                  borderRadius: 6,
                                  opacity: busy || !canPromoteWaitlist ? 0.5 : 1,
                                  cursor: busy || !canPromoteWaitlist ? 'not-allowed' : 'pointer',
                                }}
                              >
                                <Plus size={12} />
                                <span className="hidden sm:inline">Promote</span>
                              </button>
                            </div>
                          </li>
                        ))}
                      </ul>
                      {waitlist.length > waitlistLimit && (
                        <div className="mt-3 flex justify-center">
                          <AdminBtn onClick={() => setWaitlistLimit((n) => n + 12)}>
                            Load more ({waitlist.length - waitlistLimit} more)
                          </AdminBtn>
                        </div>
                      )}
                    </>
                  )}
                </div>
                )}

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

                <BadgeEditor
                  key={`badges-${code}`}
                  initial={snapshot.tournament.badges}
                  busy={busy}
                  onSave={async (badges) => {
                    setBusy(true)
                    setMsg(null)
                    setError(null)
                    try {
                      const r = await adminApi(adminKey, { action: 'set-badges', code, badges })
                      setMsg(`Saved ${r.count ?? badges.length} badge${(r.count ?? badges.length) === 1 ? '' : 's'}`)
                      await refresh(adminKey)
                      return true
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not save badges')
                      return false
                    } finally {
                      setBusy(false)
                    }
                  }}
                />

                <ParticipationBadgeEditor
                  key={`participation-${code}`}
                  initial={snapshot.tournament.participationBadge}
                  isComplete={snapshot.tournament.status === 'complete'}
                  awardedAt={snapshot.tournament.participationBadgeAwardedAt}
                  busy={busy}
                  onSave={async (badge) => {
                    setBusy(true)
                    setMsg(null)
                    setError(null)
                    try {
                      const r = await adminApi(adminKey, { action: 'set-participation-badge', code, badge })
                      if (!badge) setMsg('Participation badge removed')
                      else if (r.awarded && r.awarded > 0)
                        setMsg(`Participation badge granted to ${r.awarded} participant${r.awarded === 1 ? '' : 's'}`)
                      else setMsg('Participation badge saved - awards on completion')
                      await refresh(adminKey)
                      return true
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not save participation badge')
                      return false
                    } finally {
                      setBusy(false)
                    }
                  }}
                />

                {/* Standalone badge granter - kept with the other badge editors.
                    Works regardless of tournament state (see the no-tournament
                    render below for when nothing is live). */}
                <StandaloneBadgeGranter adminKey={adminKey} />

                {snapshot.tournament.status === 'complete' && snapshot.tournament.prizes.length > 0 && (
                  <PrizeAwardEditor
                    key={`award-${code}`}
                    prizes={snapshot.tournament.prizes}
                    standings={snapshot.standings}
                    awarded={snapshot.awardedPrizes}
                    busy={busy}
                    onSave={async (assignments) => {
                      setBusy(true)
                      setMsg(null)
                      setError(null)
                      try {
                        const r = await adminApi(adminKey, { action: 'award-prizes', code, assignments })
                        setMsg(`Awarded ${r.count ?? 0} prize${(r.count ?? 0) === 1 ? '' : 's'}`)
                        await refresh(adminKey)
                        return true
                      } catch (err) {
                        setError(err instanceof Error ? err.message : 'Could not award prizes')
                        return false
                      } finally {
                        setBusy(false)
                      }
                    }}
                  />
                )}

                <PollConfigEditor
                  key={`poll-${code}`}
                  question={snapshot.tournament.pollQuestion ?? DEFAULT_POLL_QUESTION}
                  options={snapshot.tournament.pollOptions ?? POLL_OPTIONS}
                  busy={busy}
                  onSave={async (question, options) => {
                    setBusy(true)
                    setMsg(null)
                    setError(null)
                    try {
                      const r = await adminApi(adminKey, { action: 'set-poll-config', code, question, options })
                      setMsg(`Saved poll (${r.count ?? options.length} option${(r.count ?? options.length) === 1 ? '' : 's'})`)
                      await refresh(adminKey)
                      return true
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not save the poll')
                      return false
                    } finally {
                      setBusy(false)
                    }
                  }}
                  onNewPoll={async (question, options) => {
                    setBusy(true)
                    setMsg(null)
                    setError(null)
                    try {
                      const r = await adminApi(adminKey, { action: 'new-poll', code, question, options })
                      const n = r.count ?? options.length
                      setMsg(`Started a new poll (${n} option${n === 1 ? '' : 's'}) - previous votes cleared`)
                      await refresh(adminKey)
                      return true
                    } catch (err) {
                      setError(err instanceof Error ? err.message : 'Could not start a new poll')
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

        {/* When no tournament is live, the badge granter still needs a home so
            it's available regardless of tournament state. With a live event it
            renders up with the other badge editors instead. */}
        {!(snapshot && code) && <StandaloneBadgeGranter adminKey={adminKey} />}
      </div>
    </TournamentShell>
  )
}

function ordinalLabel(n: number): string {
  const names = ['1st', '2nd', '3rd']
  const base = names[n - 1] ?? `${n}th`
  return `${base} Place`
}

/**
 * Player-feedback poll editor. Lets the host set the poll question and ballot
 * (2-6 options) for the live event without a code change. Existing options keep
 * their id (so a running tally survives a label tweak); brand-new options get a
 * fresh id derived from their label on save. Mirrors PrizeEditor's dirty-guard
 * so the 12s background refresh never clobbers an in-progress edit.
 */
function PollConfigEditor({
  question: initialQuestion,
  options: initialOptions,
  busy,
  onSave,
  onNewPoll,
}: {
  question: string
  options: PollOption[]
  busy: boolean
  onSave: (question: string, options: PollOption[]) => Promise<boolean>
  onNewPoll: (question: string, options: PollOption[]) => Promise<boolean>
}) {
  const [question, setQuestion] = useState(initialQuestion)
  const [options, setOptions] = useState<PollOption[]>(initialOptions)
  const [dirty, setDirty] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)
  // Two-click guard for the destructive "New poll" (wipes votes) action.
  const [confirmingNew, setConfirmingNew] = useState(false)

  const initialKey = JSON.stringify([initialQuestion, initialOptions])
  useEffect(() => {
    if (!dirty) {
      setQuestion(initialQuestion)
      setOptions(initialOptions)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const mutateQuestion = (v: string) => {
    setQuestion(v)
    setDirty(true)
  }
  const mutateOptions = (next: PollOption[]) => {
    setOptions(next)
    setDirty(true)
  }
  const patch = (i: number, p: Partial<PollOption>) =>
    mutateOptions(options.map((o, idx) => (idx === i ? { ...o, ...p } : o)))
  // New options carry an empty id; the server derives a stable slug from the
  // label on save. Existing options keep their id so their tally survives.
  const addOption = () => mutateOptions([...options, { id: '', label: '', blurb: '' }])
  const removeOption = (i: number) => mutateOptions(options.filter((_, idx) => idx !== i))

  const reset = () => {
    setQuestion(initialQuestion)
    setOptions(initialOptions)
    setDirty(false)
    setLocalError(null)
  }

  const save = async () => {
    const filled = options.filter((o) => o.label.trim())
    if (filled.length < POLL_MIN_OPTIONS) {
      setLocalError(`Add at least ${POLL_MIN_OPTIONS} options with a label.`)
      return
    }
    setLocalError(null)
    const ok = await onSave(question.trim() || DEFAULT_POLL_QUESTION, filled)
    if (ok) setDirty(false)
  }

  // Start a brand-new poll from the current question/options and clear all
  // prior votes. Destructive, so require a second confirming click.
  const newPoll = async () => {
    const filled = options.filter((o) => o.label.trim())
    if (filled.length < POLL_MIN_OPTIONS) {
      setLocalError(`Add at least ${POLL_MIN_OPTIONS} options with a label.`)
      return
    }
    setLocalError(null)
    if (!confirmingNew) {
      setConfirmingNew(true)
      return
    }
    setConfirmingNew(false)
    const ok = await onNewPoll(question.trim() || DEFAULT_POLL_QUESTION, filled)
    if (ok) setDirty(false)
  }

  return (
    <div className="p-5" style={tintedCard('#ec4899')}>
      <div className="flex items-center gap-2 mb-1">
        <PieChart size={16} style={{ color: 'var(--tcw-accent)' }} />
        <h3 className="font-display font-bold">Poll question</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        The question + options players vote on (only signed-up players can vote). Editing a kept
        option preserves its running tally; new options start fresh. Changes apply to the live event.
      </p>

      <label className="block text-xs mb-3">
        <span style={{ color: 'var(--text-muted)' }}>Question</span>
        <input
          style={inputStyle}
          value={question}
          maxLength={POLL_QUESTION_MAX}
          disabled={busy}
          onChange={(e) => mutateQuestion(e.target.value)}
          placeholder={DEFAULT_POLL_QUESTION}
        />
      </label>

      <div className="flex flex-col gap-2 mb-3">
        {options.map((opt, i) => (
          <div
            key={i}
            className="p-3"
            style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
          >
            <div className="flex items-center justify-between gap-2 mb-2">
              <span
                className="inline-flex items-center justify-center font-display text-[11px] font-bold"
                style={{ minWidth: 20, height: 20, borderRadius: 5, background: 'color-mix(in srgb, var(--text-primary) 14%, transparent)', color: 'var(--text-primary)' }}
              >
                {i + 1}
              </span>
              <button
                type="button"
                onClick={() => removeOption(i)}
                disabled={busy || options.length <= POLL_MIN_OPTIONS}
                aria-label={`Remove option ${i + 1}`}
                className="inline-flex items-center justify-center"
                style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: options.length <= POLL_MIN_OPTIONS ? 'default' : 'pointer', opacity: options.length <= POLL_MIN_OPTIONS ? 0.4 : 1 }}
              >
                <Trash2 size={14} />
              </button>
            </div>
            <div className="flex flex-col gap-2">
              <input
                style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
                value={opt.label}
                maxLength={POLL_LABEL_MAX}
                disabled={busy}
                onChange={(e) => patch(i, { label: e.target.value })}
                placeholder="Option label (e.g. Cash)"
              />
              <input
                style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
                value={opt.blurb}
                maxLength={POLL_BLURB_MAX}
                disabled={busy}
                onChange={(e) => patch(i, { blurb: e.target.value })}
                placeholder="Short blurb (e.g. Straight cash prize)"
              />
            </div>
          </div>
        ))}
      </div>

      {localError && <p className="text-sm mb-3" style={{ color: '#ef4444' }}>{localError}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <AdminBtn disabled={busy || options.length >= POLL_MAX_OPTIONS} onClick={addOption}>
          <span className="inline-flex items-center gap-1"><Plus size={12} /> Add option</span>
        </AdminBtn>
        <AdminBtn primary disabled={busy || !dirty} onClick={save}>
          {dirty ? 'Save poll' : 'Saved'}
        </AdminBtn>
        {dirty && (
          <button
            type="button"
            onClick={reset}
            className="text-xs"
            style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            Discard changes
          </button>
        )}
        <span className="ml-auto inline-flex items-center gap-2">
          {confirmingNew && (
            <button
              type="button"
              onClick={() => setConfirmingNew(false)}
              className="text-xs"
              style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
            >
              Cancel
            </button>
          )}
          <button
            type="button"
            onClick={newPoll}
            disabled={busy}
            title="Apply the current question + options and clear all existing votes"
            className="footer-btn inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold"
            style={{
              background: confirmingNew ? '#ef4444' : 'var(--bg)',
              color: confirmingNew ? '#fff' : 'var(--text-primary)',
              border: confirmingNew ? 'none' : '1px solid var(--border-subtle)',
              borderRadius: 6,
              opacity: busy ? 0.6 : 1,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            {confirmingNew ? 'Confirm - clears all votes' : 'New poll'}
          </button>
        </span>
      </div>
      <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        <strong>New poll</strong> applies the question + options above and wipes every existing vote,
        so tallies restart at zero. Use it to change the poll cleanly at any time.
      </p>
    </div>
  )
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
    <div className="p-5" style={tintedCard('#7933bc')}>
      <div className="flex items-center gap-2 mb-1">
        <Gift size={16} style={{ color: 'var(--tcw-accent)' }} />
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

function badgesEqual(a: TournamentBadgeSlot[], b: TournamentBadgeSlot[]): boolean {
  if (a.length !== b.length) return false
  return a.every((x, i) => x.title === b[i].title && x.description === b[i].description && x.image === b[i].image)
}

/**
 * Badge-pool editor. Structurally the twin of PrizeEditor, but each slot is a
 * per-placement badge: slot order is placing order, so N badges auto-award to
 * the top N finishers when the event completes (no manual award step). The
 * header is the badge name; the sub-header shows under it on the profile hover
 * card. Uploaded art is normalized (trimmed, 1:1, 512px) client-side so it
 * matches the existing badges exactly.
 */
function BadgeEditor({
  initial,
  busy,
  onSave,
}: {
  initial: TournamentBadgeSlot[]
  busy: boolean
  onSave: (badges: TournamentBadgeSlot[]) => Promise<boolean>
}) {
  const [slots, setSlots] = useState<TournamentBadgeSlot[]>(initial)
  const [dirty, setDirty] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    if (!dirty) setSlots(initial)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const mutate = (next: TournamentBadgeSlot[]) => {
    setSlots(next)
    setDirty(true)
  }

  const addSlot = () => {
    const n = slots.length + 1
    mutate([...slots, { title: ordinalLabel(n), description: '', image: null }])
  }
  const removeSlot = (i: number) => mutate(slots.filter((_, idx) => idx !== i))
  const patch = (i: number, p: Partial<TournamentBadgeSlot>) =>
    mutate(slots.map((s, idx) => (idx === i ? { ...s, ...p } : s)))

  const handleImage = async (i: number, blob: Blob) => {
    setImgError(null)
    setWorking(true)
    try {
      const dataUrl = await normalizeBadgeImageToDataUrl(blob)
      patch(i, { image: dataUrl })
    } catch {
      setImgError('Could not process that image - use a transparent PNG.')
    } finally {
      setWorking(false)
    }
  }

  const canSave = dirty && !busy && !working
  const saved = !dirty && badgesEqual(slots, initial)

  return (
    <div className="p-5" style={tintedCard('#f5b301')}>
      <div className="flex items-center gap-2 mb-1">
        <Award size={16} style={{ color: '#f5b301' }} />
        <h3 className="font-display font-bold">Badge pool</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Optional. One slot per placement - slot 1 goes to 1st, slot 2 to 2nd, and
        so on. Add as many as you like; the top finishers each earn theirs
        automatically when the event ends. Upload a transparent PNG (it&apos;s
        auto-trimmed and sized to match every other badge). The title is the
        badge name; the description shows under it on hover.
      </p>

      {slots.length === 0 ? (
        <p className="text-sm mb-4 rounded-md px-3 py-3 text-center" style={{ background: 'var(--bg)', color: 'var(--text-muted)' }}>
          No badges yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3 mb-3">
          {slots.map((slot, i) => (
            <BadgeSlotCard
              key={i}
              index={i}
              slot={slot}
              disabled={busy || working}
              onChange={(p) => patch(i, p)}
              onRemove={() => removeSlot(i)}
              onImage={(blob) => handleImage(i, blob)}
            />
          ))}
        </div>
      )}

      {imgError && <p className="text-sm mb-3" style={{ color: '#ef4444' }}>{imgError}</p>}
      {working && (
        <p className="text-xs mb-3 inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={12} className="animate-spin" /> Processing image...
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <AdminBtn disabled={busy || working || slots.length >= 16} onClick={addSlot}>
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
          {saved ? 'Saved' : 'Save badges'}
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

function BadgeSlotCard({
  index,
  slot,
  disabled,
  onChange,
  onRemove,
  onImage,
}: {
  index: number
  slot: TournamentBadgeSlot
  disabled: boolean
  onChange: (p: Partial<TournamentBadgeSlot>) => void
  onRemove: () => void
  onImage: (blob: Blob) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)

  return (
    <div className="rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>
          {ordinalLabel(index + 1)} place badge
        </span>
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={`Remove badge slot ${index + 1}`}
          className="inline-flex items-center justify-center"
          style={{ color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer' }}
        >
          <Trash2 size={14} />
        </button>
      </div>

      <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
        {slot.image ? (
          <div className="relative self-start">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={slot.image}
              alt={slot.title || `Badge ${index + 1}`}
              style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}
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
            <div
              tabIndex={0}
              aria-label={`Click here then paste a badge image for slot ${index + 1}`}
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
              <Upload size={12} /> Upload PNG
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImage(f)
            e.target.value = ''
          }}
        />

        <div className="flex flex-col gap-2 min-w-0">
          <input
            style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
            value={slot.title}
            disabled={disabled}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Badge name (e.g. BONK Champion)"
          />
          <textarea
            style={{ ...inputStyle, padding: '7px 9px', fontSize: 13, resize: 'vertical', minHeight: 52 }}
            value={slot.description}
            disabled={disabled}
            onChange={(e) => onChange({ description: e.target.value })}
            placeholder="Sub-header shown on hover (e.g. 1st place at the BONK Championship Series Vol. 2)"
            rows={2}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Participation badge editor - a single, OPTIONAL badge handed to EVERY
 * participant (not by placement). Sits under the placement Badge pool. Uses the
 * same client-side normalization (transparent PNG -> trimmed 1:1 512px WebP) so
 * it matches every other badge. Saving on a completed event grants it to all
 * participants right away; on a still-running event it's handed out at
 * completion. Clearing the image + saving removes the badge and its awards.
 */
function ParticipationBadgeEditor({
  initial,
  isComplete,
  awardedAt,
  busy,
  onSave,
}: {
  initial: TournamentBadgeSlot | null
  isComplete: boolean
  awardedAt: string | null
  busy: boolean
  onSave: (badge: TournamentBadgeSlot | null) => Promise<boolean>
}) {
  const empty: TournamentBadgeSlot = { title: '', description: '', image: null }
  const [slot, setSlot] = useState<TournamentBadgeSlot>(initial ?? empty)
  const [dirty, setDirty] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const initialKey = JSON.stringify(initial)
  useEffect(() => {
    if (!dirty) setSlot(initial ?? { title: '', description: '', image: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const patch = (p: Partial<TournamentBadgeSlot>) => {
    setSlot((s) => ({ ...s, ...p }))
    setDirty(true)
  }

  const handleImage = async (blob: Blob) => {
    setImgError(null)
    setWorking(true)
    try {
      const dataUrl = await normalizeBadgeImageToDataUrl(blob)
      patch({ image: dataUrl })
    } catch {
      setImgError('Could not process that image - use a transparent PNG.')
    } finally {
      setWorking(false)
    }
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const canSave = dirty && !busy && !working && slot.image !== null
  const saved = !dirty && Boolean(initial?.image)

  return (
    <div className="p-5" style={tintedCard('#38bdf8')}>
      <div className="flex items-center gap-2 mb-1">
        <Users size={16} style={{ color: '#38bdf8' }} />
        <h3 className="font-display font-bold">Participation badge</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Optional. One badge handed to <strong>every participant</strong> of this
        event (not by placement). Upload a transparent PNG - it&apos;s auto-trimmed
        and sized to match every other badge.{' '}
        {isComplete
          ? 'Since this event is complete, saving grants it to all participants immediately.'
          : 'It&apos;s handed out automatically when the event ends.'}
      </p>

      <div className="rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          {slot.image ? (
            <div className="relative self-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slot.image}
                alt={slot.title || 'Participation badge'}
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}
              />
              <button
                type="button"
                onClick={() => patch({ image: null })}
                aria-label="Remove image"
                className="absolute inline-flex items-center justify-center"
                style={{ top: 4, right: 4, width: 20, height: 20, borderRadius: 5, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 self-start">
              <div
                tabIndex={0}
                aria-label="Click here then paste a participation badge image"
                onPaste={(e) => {
                  const blob = imageFromClipboard(e)
                  if (blob) {
                    e.preventDefault()
                    handleImage(blob)
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
                disabled={busy || working}
                className="footer-btn inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, opacity: busy || working ? 0.5 : 1 }}
              >
                <Upload size={12} /> Upload PNG
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImage(f)
              e.target.value = ''
            }}
          />

          <div className="flex flex-col gap-2 min-w-0">
            <input
              style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
              value={slot.title}
              disabled={busy || working}
              onChange={(e) => patch({ title: e.target.value })}
              placeholder="Badge name (e.g. Summer Popup Participant)"
            />
            <textarea
              style={{ ...inputStyle, padding: '7px 9px', fontSize: 13, resize: 'vertical', minHeight: 52 }}
              value={slot.description}
              disabled={busy || working}
              onChange={(e) => patch({ description: e.target.value })}
              placeholder="Sub-header shown on hover (e.g. Played the One Piece TCG Summer Popup)"
              rows={2}
            />
          </div>
        </div>
      </div>

      {imgError && <p className="text-sm mt-3" style={{ color: '#ef4444' }}>{imgError}</p>}
      {working && (
        <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={12} className="animate-spin" /> Processing image...
        </p>
      )}
      {awardedAt && !dirty && (
        <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: '#22c55e' }}>
          <Check size={12} /> Awarded to participants.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <AdminBtn
          primary
          disabled={!canSave}
          onClick={async () => {
            const ok = await onSave(slot.image ? slot : null)
            if (ok) setDirty(false)
          }}
        >
          {saved ? 'Saved' : 'Save badge'}
        </AdminBtn>
        {initial?.image && (
          <AdminBtn
            disabled={busy || working}
            onClick={async () => {
              const ok = await onSave(null)
              if (ok) setDirty(false)
            }}
          >
            <span className="inline-flex items-center gap-1"><Trash2 size={12} /> Remove badge</span>
          </AdminBtn>
        )}
        {dirty && (
          <button
            type="button"
            onClick={() => {
              setSlot(initial ?? { title: '', description: '', image: null })
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

interface BadgeRecipientOption {
  walletAddress: string
  username: string | null
  xHandle: string | null
  avatarUrl: string | null
}

/** Display label for a recipient: username, else @handle, else short wallet. */
function recipientLabel(r: BadgeRecipientOption): string {
  if (r.username && r.username.trim()) return r.username.trim()
  if (r.xHandle && r.xHandle.trim()) return `@${normalizeXHandle(r.xHandle)}`
  return `${r.walletAddress.slice(0, 6)}…${r.walletAddress.slice(-4)}`
}

/**
 * Searchable, overflow-safe recipient picker. Loads the registered roster once,
 * filters client-side by username / X handle / wallet, and shows matches in a
 * scrollable dropdown so a large user base never blows out the layout.
 */
function RecipientPicker({
  recipients,
  loading,
  value,
  onChange,
  disabled,
}: {
  recipients: BadgeRecipientOption[]
  loading: boolean
  value: BadgeRecipientOption | null
  onChange: (r: BadgeRecipientOption | null) => void
  disabled?: boolean
}) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^@/, '')
    if (!q) return recipients.slice(0, 50)
    return recipients
      .filter((r) => {
        const u = (r.username ?? '').toLowerCase()
        const h = normalizeXHandle(r.xHandle ?? '')
        const w = r.walletAddress.toLowerCase()
        return u.includes(q) || h.includes(q) || w.includes(q)
      })
      .slice(0, 50)
  }, [query, recipients])

  return (
    <div ref={boxRef} className="relative">
      {value ? (
        <div
          className="flex items-center gap-2 rounded-md px-2.5 py-2"
          style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
        >
          <PlayerAvatar
            username={value.username}
            xHandle={value.xHandle}
            avatarUrl={value.avatarUrl}
            walletAddress={value.walletAddress}
            size={22}
          />
          <span className="text-sm font-semibold truncate min-w-0" style={{ color: 'var(--text-primary)' }}>
            {recipientLabel(value)}
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={() => onChange(null)}
            aria-label="Clear recipient"
            className="ml-auto inline-flex items-center justify-center"
            style={{ width: 22, height: 22, borderRadius: 5, background: 'var(--bg-surface)', color: 'var(--text-muted)', border: '1px solid var(--border-subtle)', cursor: 'pointer' }}
          >
            <X size={12} />
          </button>
        </div>
      ) : (
        <input
          style={{ ...inputStyle, padding: '9px 11px' }}
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          placeholder={loading ? 'Loading users…' : 'Search a username or @handle…'}
        />
      )}

      {open && !value && (
        <div
          className="absolute z-30 mt-1 w-full overflow-y-auto rounded-md"
          style={{ maxHeight: 240, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', boxShadow: 'var(--shadow-card)' }}
        >
          {loading ? (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Loading…</div>
          ) : matches.length === 0 ? (
            <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>No matching users.</div>
          ) : (
            matches.map((r) => (
              <button
                key={r.walletAddress}
                type="button"
                onClick={() => {
                  onChange(r)
                  setOpen(false)
                  setQuery('')
                }}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                <PlayerAvatar
                  username={r.username}
                  xHandle={r.xHandle}
                  avatarUrl={r.avatarUrl}
                  walletAddress={r.walletAddress}
                  size={22}
                />
                <span className="text-sm truncate min-w-0" style={{ color: 'var(--text-primary)' }}>
                  {recipientLabel(r)}
                </span>
                {r.username && r.xHandle && (
                  <span className="ml-auto text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                    @{normalizeXHandle(r.xHandle)}
                  </span>
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

/**
 * Tournament-agnostic badge granter. Always available in the admin panel: pick
 * any registered user, upload + auto-normalize a transparent PNG, set a title
 * and sub-header, and award it. Awards land in manual_awarded_badges and show
 * on the recipient's profile shelf like any other badge. A "recently awarded"
 * list lets the operator revoke a mistaken grant.
 */
function StandaloneBadgeGranter({ adminKey }: { adminKey: string }) {
  const empty: TournamentBadgeSlot = { title: '', description: '', image: null }
  const [slot, setSlot] = useState<TournamentBadgeSlot>(empty)
  const [recipient, setRecipient] = useState<BadgeRecipientOption | null>(null)
  const [recipients, setRecipients] = useState<BadgeRecipientOption[]>([])
  const [loadingRecipients, setLoadingRecipients] = useState(true)
  const [recent, setRecent] = useState<ManualBadgeAward[]>([])
  const [busy, setBusy] = useState(false)
  const [working, setWorking] = useState(false)
  const [imgError, setImgError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let live = true
    setLoadingRecipients(true)
    Promise.all([
      adminApi(adminKey, { action: 'list-badge-recipients' }),
      adminApi(adminKey, { action: 'list-recent-badges' }),
    ])
      .then(([rec, awards]) => {
        if (!live) return
        setRecipients(rec.recipients ?? [])
        setRecent(awards.awards ?? [])
      })
      .catch(() => {
        /* best effort - a missing table just leaves the lists empty */
      })
      .finally(() => {
        if (live) setLoadingRecipients(false)
      })
    return () => {
      live = false
    }
  }, [adminKey])

  const handleImage = async (blob: Blob) => {
    setImgError(null)
    setWorking(true)
    try {
      const dataUrl = await normalizeBadgeImageToDataUrl(blob)
      setSlot((s) => ({ ...s, image: dataUrl }))
    } catch {
      setImgError('Could not process that image - use a transparent PNG.')
    } finally {
      setWorking(false)
    }
  }

  const canAward =
    !busy && !working && Boolean(recipient) && slot.image !== null && slot.title.trim().length > 0

  const award = async () => {
    if (!recipient || !slot.image) return
    setBusy(true)
    setError(null)
    setMsg(null)
    try {
      const r = await adminApi(adminKey, {
        action: 'grant-badge',
        walletAddress: recipient.walletAddress,
        badge: { title: slot.title.trim(), description: slot.description?.trim() ?? '', image: slot.image },
      })
      if (r.award) setRecent((prev) => [r.award as ManualBadgeAward, ...prev])
      setMsg(`Awarded "${slot.title.trim()}" to ${recipientLabel(recipient)}.`)
      setSlot(empty)
      setRecipient(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not award the badge.')
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (id: string) => {
    setBusy(true)
    setError(null)
    try {
      await adminApi(adminKey, { action: 'revoke-badge', id })
      setRecent((prev) => prev.filter((a) => a.id !== id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not revoke the badge.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-5" style={tintedCard('#a855f7')}>
      <div className="flex items-center gap-2 mb-1">
        <Award size={16} style={{ color: '#a855f7' }} />
        <h3 className="font-display font-bold">Award a badge</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Give a cosmetic badge to any registered user, anytime - no tournament
        needed. Pick a recipient, upload a transparent PNG (auto-trimmed and sized
        to match every other badge), and add a title + sub-header. It appears on
        their profile badge shelf.
      </p>

      <div className="flex flex-col gap-3 rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}>
        <label className="text-xs font-bold" style={{ color: 'var(--text-secondary)' }}>
          Recipient
        </label>
        <RecipientPicker
          recipients={recipients}
          loading={loadingRecipients}
          value={recipient}
          onChange={setRecipient}
          disabled={busy}
        />

        <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
          {slot.image ? (
            <div className="relative self-start">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={slot.image}
                alt={slot.title || 'Badge'}
                style={{ width: '100%', height: 'auto', display: 'block', borderRadius: 6, border: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--text-primary) 6%, transparent)' }}
              />
              <button
                type="button"
                onClick={() => setSlot((s) => ({ ...s, image: null }))}
                aria-label="Remove image"
                className="absolute inline-flex items-center justify-center"
                style={{ top: 4, right: 4, width: 20, height: 20, borderRadius: 5, background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none', cursor: 'pointer' }}
              >
                <X size={12} />
              </button>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 self-start">
              <div
                tabIndex={0}
                aria-label="Click here then paste a badge image"
                onPaste={(e) => {
                  const blob = imageFromClipboard(e)
                  if (blob) {
                    e.preventDefault()
                    handleImage(blob)
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
                disabled={busy || working}
                className="footer-btn inline-flex items-center justify-center gap-1 px-2 py-1.5 text-[11px] font-bold"
                style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)', border: '1px solid var(--border-subtle)', borderRadius: 6, opacity: busy || working ? 0.5 : 1 }}
              >
                <Upload size={12} /> Upload PNG
              </button>
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) handleImage(f)
              e.target.value = ''
            }}
          />

          <div className="flex flex-col gap-2 min-w-0">
            <input
              style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
              value={slot.title}
              disabled={busy || working}
              onChange={(e) => setSlot((s) => ({ ...s, title: e.target.value }))}
              placeholder="Badge name (e.g. Community MVP)"
            />
            <textarea
              style={{ ...inputStyle, padding: '7px 9px', fontSize: 13, resize: 'vertical', minHeight: 52 }}
              value={slot.description}
              disabled={busy || working}
              onChange={(e) => setSlot((s) => ({ ...s, description: e.target.value }))}
              placeholder="Sub-header shown on hover (e.g. Awarded for outstanding community contributions)"
              rows={2}
            />
          </div>
        </div>
      </div>

      {imgError && <p className="text-sm mt-3" style={{ color: '#ef4444' }}>{imgError}</p>}
      {error && <p className="text-sm mt-3" style={{ color: '#ef4444' }}>{error}</p>}
      {working && (
        <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={12} className="animate-spin" /> Processing image...
        </p>
      )}
      {msg && (
        <p className="text-xs mt-3 inline-flex items-center gap-1.5" style={{ color: '#22c55e' }}>
          <Check size={12} /> {msg}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <AdminBtn primary disabled={!canAward} onClick={award}>
          Award badge
        </AdminBtn>
      </div>

      {recent.length > 0 && (
        <div className="mt-5">
          <h4 className="text-xs font-bold mb-2" style={{ color: 'var(--text-secondary)' }}>
            Recently awarded
          </h4>
          <div className="flex flex-col gap-1.5">
            {recent.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 rounded-md px-2.5 py-1.5"
                style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)' }}
              >
                {a.image ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.image} alt="" style={{ width: 26, height: 26, borderRadius: 5, flexShrink: 0 }} />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>
                    {a.title}
                  </div>
                  <div className="text-[11px] truncate" style={{ color: 'var(--text-muted)' }}>
                    {a.displayName || (a.xHandle ? `@${normalizeXHandle(a.xHandle)}` : `${a.walletAddress.slice(0, 6)}…${a.walletAddress.slice(-4)}`)}
                  </div>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => revoke(a.id)}
                  className="inline-flex items-center gap-1 text-[11px] font-bold"
                  style={{ color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer', opacity: busy ? 0.5 : 1 }}
                >
                  <Trash2 size={12} /> Revoke
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Prize-award editor. Shown only once an event is complete. Each prize slot is
 * matched to its winner(s); a single prize can go to several finalists (e.g.
 * "Top 8"). Pre-filled from the existing award if there is one, otherwise from
 * the final standings by position (slot 1 -> 1st, slot 2 -> 2nd, ...). Saving
 * snapshots the prize onto each winner and locks it into history.
 */
function PrizeAwardEditor({
  prizes,
  standings,
  awarded,
  busy,
  onSave,
}: {
  prizes: TournamentPrize[]
  standings: StandingRow[]
  awarded: AwardedPrize[]
  busy: boolean
  onSave: (assignments: { slotIndex: number; playerIds: string[] }[]) => Promise<boolean>
}) {
  // Finalists, ordered by placement, as the pool of selectable winners.
  const finalists = useMemo(
    () => standings.map((s) => ({ id: s.playerId, label: `${ordinal(s.rank)} - ${s.displayName}` })),
    [standings],
  )
  const nameById = useMemo(() => new Map(finalists.map((f) => [f.id, f.label])), [finalists])

  const buildInitial = useCallback((): Record<number, string[]> => {
    const out: Record<number, string[]> = {}
    if (awarded.length > 0) {
      for (const a of awarded) {
        if (!a.playerId) continue
        out[a.slotIndex] = [...(out[a.slotIndex] ?? []), a.playerId]
      }
    } else {
      // Positional default: slot i -> i-th ranked finalist.
      prizes.forEach((_, i) => {
        const winner = standings[i]
        if (winner) out[i] = [winner.playerId]
      })
    }
    return out
  }, [awarded, prizes, standings])

  const [assignments, setAssignments] = useState<Record<number, string[]>>(buildInitial)
  const [dirty, setDirty] = useState(false)

  const initialKey = JSON.stringify(awarded.map((a) => [a.slotIndex, a.playerId]))
  useEffect(() => {
    if (!dirty) setAssignments(buildInitial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialKey])

  const setSlot = (slotIndex: number, ids: string[]) => {
    setAssignments((prev) => ({ ...prev, [slotIndex]: ids }))
    setDirty(true)
  }
  const addWinner = (slotIndex: number, id: string) => {
    if (!id) return
    const cur = assignments[slotIndex] ?? []
    if (cur.includes(id)) return
    setSlot(slotIndex, [...cur, id])
  }
  const removeWinner = (slotIndex: number, id: string) => {
    setSlot(slotIndex, (assignments[slotIndex] ?? []).filter((x) => x !== id))
  }

  const alreadyAwarded = awarded.length > 0

  // Tie groups that land on a prize-winning position: the positional default is
  // ambiguous for these, so the host must resolve with a tiebreaker and assign
  // winners by hand rather than accept the (non-merit) fallback order.
  const prizeTieGroups = useMemo(() => {
    const groups = new Map<number, StandingRow[]>()
    standings.forEach((row, idx) => {
      if (idx < prizes.length && row.tied && row.tieGroup != null) {
        groups.set(row.tieGroup, [...(groups.get(row.tieGroup) ?? []), row])
      }
    })
    return [...groups.values()].filter((g) => g.length > 1)
  }, [standings, prizes.length])

  const save = async () => {
    const payload = prizes
      .map((_, i) => ({ slotIndex: i, playerIds: assignments[i] ?? [] }))
      .filter((a) => a.playerIds.length > 0)
    const okSave = await onSave(payload)
    if (okSave) setDirty(false)
  }

  return (
    <div className="p-5" style={tintedCard('#22c55e')}>
      <div className="flex items-center gap-2 mb-1">
        <Medal size={16} style={{ color: '#f5b301' }} />
        <h3 className="font-display font-bold">Award prizes</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Match each prize to its winner(s). Pre-filled by placing - adjust for
        multi-winner prizes (e.g. Top 8), then lock it in. This publishes the
        prizes to each winner&rsquo;s profile and the event history.
        {alreadyAwarded && ' Prizes are already awarded; saving re-awards them.'}
      </p>

      {prizeTieGroups.length > 0 && (
        <div
          className="mb-4 p-3"
          style={{
            background: 'color-mix(in srgb, #f5b301 12%, var(--bg))',
            border: '1px solid color-mix(in srgb, #f5b301 45%, var(--border-subtle))',
            borderRadius: 6,
          }}
        >
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={15} style={{ color: '#f5b301' }} />
            <span className="font-display font-bold text-sm">Tiebreaker needed before awarding</span>
          </div>
          <p className="text-xs mb-2" style={{ color: 'var(--text-secondary)' }}>
            These players are dead-even on every merit tiebreaker (points, OMW,
            head-to-head, OOMW) and land on a prize spot. The positional default
            below is <strong>not</strong> a real result - have them play a
            tiebreaker, then set the winners by hand before locking prizes.
          </p>
          <ul className="text-xs flex flex-col gap-1">
            {prizeTieGroups.map((g, gi) => (
              <li key={gi} style={{ color: 'var(--text-primary)' }}>
                <span className="font-semibold">Tied for {ordinal((g[0]?.rank ?? 0))}:</span>{' '}
                {g.map((r) => r.displayName.replace(/^@/, '')).join(' = ')}
              </li>
            ))}
          </ul>
        </div>
      )}

      {finalists.length === 0 ? (
        <p className="text-sm py-3 text-center" style={{ color: 'var(--text-muted)' }}>
          No finalists to award to yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {prizes.map((prize, i) => {
            const winners = assignments[i] ?? []
            const medal = i === 0 ? '#f5b301' : i === 1 ? '#c4cad3' : i === 2 ? '#cd7f32' : null
            const available = finalists.filter((f) => !winners.includes(f.id))
            return (
              <div
                key={i}
                className="p-3"
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border-subtle)',
                  borderLeft: `3px solid ${medal ?? 'var(--border-subtle)'}`,
                  borderRadius: 6,
                }}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className="inline-flex items-center justify-center font-display text-[11px] font-bold"
                    style={{ minWidth: 20, height: 20, borderRadius: 5, background: medal ?? 'color-mix(in srgb, var(--text-primary) 14%, transparent)', color: medal ? '#1a1a1a' : 'var(--text-primary)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="font-display font-bold text-sm">{prize.title}</span>
                  {prize.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={prize.image} alt="" style={{ width: 26, height: 26, objectFit: 'contain', borderRadius: 4, marginLeft: 'auto' }} />
                  )}
                </div>

                {winners.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {winners.map((id) => (
                      <span
                        key={id}
                        className="inline-flex items-center gap-1.5 px-2 py-1 text-xs font-semibold"
                        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 5 }}
                      >
                        {nameById.get(id) ?? 'Player'}
                        <button
                          type="button"
                          onClick={() => removeWinner(i, id)}
                          disabled={busy}
                          aria-label="Remove winner"
                          style={{ display: 'inline-flex', cursor: 'pointer', color: 'var(--text-muted)' }}
                        >
                          <X size={13} />
                        </button>
                      </span>
                    ))}
                  </div>
                )}

                <select
                  value=""
                  disabled={busy || available.length === 0}
                  onChange={(e) => addWinner(i, e.target.value)}
                  style={{ ...inputStyle, padding: '7px 9px', fontSize: 13 }}
                >
                  <option value="">{available.length === 0 ? 'All finalists added' : '+ Add winner…'}</option>
                  {available.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            )
          })}

          <AdminBtn disabled={busy || !dirty} onClick={save}>
            {alreadyAwarded ? 'Re-award prizes' : 'Lock in prizes'}
          </AdminBtn>
        </div>
      )}
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/**
 * Player-cap picker. Replaces a freeform number with "ideal" bracket sizes
 * (powers of two = no byes for single-elim, clean round counts for Swiss).
 * The cap is a target/ceiling - the admin can always close sign-ups early and
 * run with fewer. A "Custom" escape hatch keeps full flexibility.
 */
const CAP_PRESETS = [8, 16, 32, 64]

/**
 * Live editor for the player cap of the active (enrolling) tournament. Reuses
 * the same preset picker as the create form. Saving only re-targets the
 * ceiling for new sign-ups - it never removes anyone already registered - so
 * an admin can comfortably drop a 32-cap event to 16 once the field is set.
 */
function MaxPlayersEditor({
  current,
  format,
  registered,
  busy,
  onSave,
}: {
  current: number | null
  format: 'swiss' | 'single-elim'
  registered: number
  busy: boolean
  onSave: (cap: number) => void
}) {
  const [value, setValue] = useState(() => String(current ?? 32))
  const parsed = parsePositiveInt(value)
  const changed = parsed != null && parsed !== (current ?? null)
  const belowField = parsed != null && parsed < registered

  return (
    <div
      className="mt-4 px-3 py-3"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Users size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />
        <span className="text-sm font-semibold">Player cap</span>
        <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
          {registered} registered · cap {current ?? 'none'}
        </span>
      </div>
      <PlayerCapPicker value={value} onChange={setValue} format={format} />
      {belowField && (
        <p className="text-[11px] mt-2" style={{ color: '#f5b301', lineHeight: 1.45 }}>
          That&rsquo;s below your {registered} current sign-ups. Nobody is removed, but new sign-ups
          will be turned away (the event reads as full).
        </p>
      )}
      <div className="mt-3">
        <AdminBtn
          disabled={busy || !changed || parsed == null}
          primary
          onClick={() => parsed != null && onSave(parsed)}
        >
          {changed && parsed != null ? `Save cap (${parsed})` : 'Save cap'}
        </AdminBtn>
      </div>
    </div>
  )
}

/**
 * Paid-lobby "Join code" control. A join code is a SHARED room passcode (like a
 * Zoom passcode) that players must enter to register for this specific lobby -
 * it is NOT a per-user password. Fetches the current raw code (admin-only, via
 * get-join-password) on load so the operator can re-share it, and lets them set
 * a new code or clear it (reopen the lobby). Self-contained: does its own admin
 * calls and messaging so it never fights the parent's shared busy/error state.
 */
function JoinCodeEditor({ adminKey, code }: { adminKey: string; code: string }) {
  const [value, setValue] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setErr(null)
    try {
      const r = await adminApi(adminKey, { action: 'get-join-password', code })
      setValue(r.joinPassword ?? '')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load the join code.')
    } finally {
      setLoaded(true)
    }
  }, [adminKey, code])

  useEffect(() => {
    void load()
  }, [load])

  async function save(next: string | null) {
    setSaving(true)
    setErr(null)
    setMsg(null)
    try {
      const r = await adminApi(adminKey, { action: 'set-join-password', code, password: next })
      setMsg(
        r.joinProtected
          ? 'Join code set - share it privately with your group.'
          : 'Join code cleared - the lobby is open to everyone.',
      )
      if (!r.joinProtected) setValue('')
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not update the join code.')
    } finally {
      setSaving(false)
    }
  }

  const trimmed = value.trim()

  return (
    <div
      className="mt-4 px-3 py-3"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <KeyRound size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />
        <span className="text-sm font-semibold">Join code</span>
        <span className="text-xs ml-auto" style={{ color: 'var(--text-muted)' }}>
          {loaded ? (trimmed ? 'private lobby' : 'open lobby') : 'loading…'}
        </span>
      </div>
      <input
        style={inputStyle}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="No code (open lobby)"
        autoComplete="off"
        disabled={saving || !loaded}
      />
      <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
        A shared passcode players must enter to register (e.g. share it with your APAC group).
        Clear it to reopen the lobby to everyone.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <AdminBtn disabled={saving || !loaded} primary onClick={() => save(trimmed || null)}>
          {trimmed ? 'Save code' : 'Save (open lobby)'}
        </AdminBtn>
        <AdminBtn disabled={saving || !loaded || !trimmed} onClick={() => save(null)}>
          Clear code
        </AdminBtn>
      </div>
      {msg && (
        <p className="text-[11px] mt-2" style={{ color: '#22c55e' }}>
          {msg}
        </p>
      )}
      {err && (
        <p className="text-[11px] mt-2" style={{ color: '#ef4444' }} role="alert">
          {err}
        </p>
      )}
    </div>
  )
}

/** "90" -> "1h 30m", "48" stays "48m", "120" -> "2h". */
function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

const ROUND_HOUR_PRESETS = [6, 12, 24, 48, 72]

// Quick "add time to the live round" presets (minutes), mirroring +1h sign-ups.
const ROUND_EXTEND_PRESETS: { label: string; mins: number }[] = [
  { label: '30m', mins: 30 },
  { label: '1h', mins: 60 },
  { label: '3h', mins: 180 },
  { label: '24h', mins: 1440 },
]

/**
 * Live editor for how long each round stays open. Editable while enrolling or
 * running. The value is the deadline the auto-sweep uses to close out unreported
 * matches; rounds still advance instantly once every match is decided. While
 * running, saving also re-times the current round from its own start so the
 * change takes effect now, not only on the next round.
 */
function RoundLengthEditor({
  current,
  status,
  activeRoundEndsAt,
  busy,
  onSave,
  onExtend,
}: {
  current: number
  status: 'enrolling' | 'running'
  activeRoundEndsAt: string | null
  busy: boolean
  onSave: (minutes: number) => void
  onExtend?: (extraMinutes: number) => void
}) {
  const [hours, setHours] = useState(() => String(Math.max(1, Math.round(current / 60))))
  const num = parseInt(hours, 10)
  const [custom, setCustom] = useState(() => !ROUND_HOUR_PRESETS.includes(num))
  const parsed = parsePositiveInt(hours)
  const nextMinutes = parsed != null ? parsed * 60 : null
  const changed = nextMinutes != null && nextMinutes !== current

  const endsLabel = activeRoundEndsAt
    ? new Date(activeRoundEndsAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
    : null

  return (
    <div
      className="mt-4 px-3 py-3"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Clock size={15} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />
        <span className="text-sm font-semibold">Round length</span>
        <span className="text-xs ml-auto tabular-nums" style={{ color: 'var(--text-muted)' }}>
          now {formatDuration(current)}
        </span>
      </div>

      <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
        Hours per round
      </span>
      <div className="flex flex-wrap gap-2">
        {ROUND_HOUR_PRESETS.map((h) => {
          const active = !custom && num === h
          return (
            <button
              key={h}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setCustom(false)
                setHours(String(h))
              }}
              className="text-center transition-colors"
              style={{
                flex: '1 1 56px',
                minWidth: 56,
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: active ? 'color-mix(in srgb, var(--tcw-accent) 12%, var(--bg))' : 'var(--bg-surface)',
                border: `1px solid ${active ? 'var(--tcw-accent)' : 'var(--border-subtle)'}`,
              }}
            >
              <span className="block font-display text-base font-bold leading-none">{h}h</span>
            </button>
          )
        })}
        <button
          type="button"
          aria-pressed={custom}
          onClick={() => setCustom(true)}
          className="text-center transition-colors"
          style={{
            flex: '1 1 56px',
            minWidth: 56,
            padding: '7px 10px',
            borderRadius: 6,
            cursor: 'pointer',
            background: custom ? 'color-mix(in srgb, var(--tcw-accent) 12%, var(--bg))' : 'var(--bg-surface)',
            border: `1px solid ${custom ? 'var(--tcw-accent)' : 'var(--border-subtle)'}`,
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
          <PositiveIntInput label="Custom hours" value={hours} onChange={setHours} placeholder="e.g. 36" />
        </div>
      )}

      {status === 'running' ? (
        <>
          <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {endsLabel ? (
              <>
                Current round auto-closes around <strong>{endsLabel}</strong> if matches are still
                pending.{' '}
              </>
            ) : null}
            Saving re-times the current round and applies to every round after it. Decide every match
            and the bracket advances right away - no need to wait for the clock.
          </p>
          {onExtend && (
            <div className="mt-3">
              <span className="block text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: 'var(--text-muted)' }}>
                Add time to this round
              </span>
              <div className="flex flex-wrap gap-2">
                {ROUND_EXTEND_PRESETS.map(({ label, mins }) => (
                  <AdminBtn key={mins} disabled={busy} onClick={() => onExtend(mins)}>
                    +{label}
                  </AdminBtn>
                ))}
              </div>
              <p className="text-[11px] mt-1.5" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Pushes only the current round&rsquo;s deadline later. Doesn&rsquo;t change the saved
                round length for future rounds.
              </p>
            </div>
          )}
        </>
      ) : (
        <p className="text-[11px] mt-2" style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>
          How long each round stays open before the auto-sweep can close unreported matches. Rounds
          still advance the moment every match is decided.
        </p>
      )}

      <div className="mt-3">
        <AdminBtn
          disabled={busy || !changed || nextMinutes == null}
          primary
          onClick={() => nextMinutes != null && onSave(nextMinutes)}
        >
          {changed && nextMinutes != null ? `Save length (${formatDuration(nextMinutes)})` : 'Save length'}
        </AdminBtn>
      </div>
    </div>
  )
}

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
                background: active ? 'color-mix(in srgb, var(--tcw-accent) 12%, var(--bg))' : 'var(--bg)',
                border: `1px solid ${active ? 'var(--tcw-accent)' : 'var(--border-subtle)'}`,
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
            background: custom ? 'color-mix(in srgb, var(--tcw-accent) 12%, var(--bg))' : 'var(--bg)',
            border: `1px solid ${custom ? 'var(--tcw-accent)' : 'var(--border-subtle)'}`,
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
        background: active ? 'color-mix(in srgb, var(--tcw-accent) 12%, var(--bg))' : 'var(--bg)',
        border: `1px solid ${active ? 'var(--tcw-accent)' : 'var(--border-subtle)'}`,
        borderRadius: 6,
        cursor: 'pointer',
      }}
    >
      <span className="inline-flex items-center gap-1.5 font-display text-sm font-bold">
        <Icon size={15} style={{ color: active ? 'var(--tcw-accent)' : 'var(--text-muted)' }} />
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
        background: primary ? 'var(--tcw-accent)' : 'var(--bg)',
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

function StatusBadge({ status, enrollExpired }: { status: string; enrollExpired?: boolean }) {
  const map: Record<string, { label: string; color: string }> = {
    enrolling: { label: 'Sign-ups open', color: 'var(--tcw-accent)' },
    running: { label: 'Live', color: '#22c55e' },
    complete: { label: 'Complete', color: '#8b93a1' },
  }
  // Mirror the public page: once the sign-up timer elapses the window is
  // closed even though the tournament is technically still 'enrolling' (the
  // bracket is started manually). Show it as closed so the panel and the
  // public hero never contradict each other.
  const s =
    status === 'enrolling' && enrollExpired
      ? { label: 'Sign-ups closed', color: '#8b93a1' }
      : map[status] ?? { label: status, color: 'var(--text-muted)' }
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

/** Two self-reports "agree" when they describe the same outcome from each side. */
function reportsAgree(a: string | null, b: string | null): boolean {
  return (a === 'win' && b === 'loss') || (a === 'loss' && b === 'win') || (a === 'draw' && b === 'draw')
}

function AdminMatchRow({
  match,
  nameById,
  allowDraw,
  disabled,
  roundEndsAt,
  onResult,
}: {
  match: Match
  nameById: Map<string, Player>
  allowDraw: boolean
  disabled: boolean
  roundEndsAt?: string | null
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

  // Surface the players' self-reports so the admin can spot disputes (both
  // claim the win), provisional single-sided reports, and matches the players
  // already auto-confirmed between themselves.
  const r1 = match.player1Report
  const r2 = match.player2Report
  const p1Label = p1 ? formatXLabel(p1.xHandle) : 'Player 1'
  const p2Label = p2 ? formatXLabel(p2.xHandle) : 'Player 2'
  const reportStatus: { tone: string; label: string; text: string } | null = (() => {
    if (isBye) return null
    if (match.status === 'disputed') {
      return {
        tone: '#f59e0b',
        label: 'Disputed',
        text: `${p1Label} said ${r1 ?? '-'}, ${p2Label} said ${r2 ?? '-'}. Pick the winner to resolve.`,
      }
    }
    if (!resolved && (r1 || r2)) {
      const who = r1 ? p1Label : p2Label
      const what = r1 ?? r2
      return {
        tone: 'var(--tcw-accent)',
        label: 'Reported',
        text: `${who} reported ${what}. Awaiting the other player.`,
      }
    }
    // No reports at all. We never auto-award these, so once the round deadline
    // has elapsed flag it for the admin to resolve by hand.
    if (!resolved && !r1 && !r2) {
      const elapsed = roundEndsAt != null && new Date(roundEndsAt).getTime() <= Date.now()
      return elapsed
        ? {
            tone: '#ef4444',
            label: 'Needs resolution',
            text: 'Round time elapsed with no reports. Pick the winner to resolve.',
          }
        : {
            tone: 'var(--text-muted)',
            label: 'No reports yet',
            text: 'Waiting on both players to report.',
          }
    }
    if (resolved) {
      // Both players self-reported and their verdicts line up → the system
      // confirmed it with no admin involvement.
      if (r1 && r2 && reportsAgree(r1, r2)) {
        return { tone: '#22c55e', label: 'Auto-confirmed', text: 'Both players agreed.' }
      }
      // Exactly one side reported and the confirm window elapsed without a
      // dispute (the "loser ghosted, winner still advances" path).
      if ((r1 && !r2) || (!r1 && r2)) {
        const who = r1 ? p1Label : p2Label
        return {
          tone: '#22c55e',
          label: 'Auto-confirmed',
          text: `${who} reported and the opponent never disputed.`,
        }
      }
      // Conflicting reports (a dispute) or no reports at all that still ended up
      // confirmed means an admin stepped in and set the winner.
      return { tone: '#3b82f6', label: 'Admin-confirmed', text: 'An admin settled this result.' }
    }
    return null
  })()

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

      {reportStatus && (
        <div
          className="flex items-start gap-2 rounded-md px-2.5 py-1.5"
          style={{
            background: `color-mix(in srgb, ${reportStatus.tone} 10%, var(--bg))`,
            border: `1px solid color-mix(in srgb, ${reportStatus.tone} 28%, transparent)`,
          }}
        >
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
            style={{ background: reportStatus.tone, color: '#0a0a0a' }}
          >
            {reportStatus.label}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.4 }}>
            {reportStatus.text}
          </span>
        </div>
      )}

      {/* Dispute battle-log evidence (any tournament): a participant attached an
          OPTCG Sim log for the organizer to read before picking a winner. */}
      {(match.disputeLogUrl || match.disputeLogText) && (
        <div
          className="flex flex-col gap-1.5 rounded-md px-2.5 py-2"
          style={{
            background: 'color-mix(in srgb, #f59e0b 8%, var(--bg))',
            border: '1px solid color-mix(in srgb, #f59e0b 28%, transparent)',
          }}
        >
          <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: '#f59e0b' }}>
            Battle-log evidence
          </span>
          {match.disputeLogUrl && (
            <a
              href={match.disputeLogUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold break-all"
              style={{ color: 'var(--text-primary)' }}
            >
              <ExternalLink size={12} style={{ flexShrink: 0 }} />
              {match.disputeLogUrl}
            </a>
          )}
          {match.disputeLogText && (
            <pre
              className="max-h-40 overflow-auto whitespace-pre-wrap rounded p-2 text-[11px]"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                color: 'var(--text-secondary)',
                fontFamily: 'var(--font-mono, monospace)',
              }}
            >
              {match.disputeLogText}
            </pre>
          )}
        </div>
      )}

      {!isBye && pending ? (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs flex-1 min-w-0" style={{ color: 'var(--text-secondary)' }}>
            Record <strong style={{ color: 'var(--text-primary)' }}>{labelFor(pending)}</strong>
            {pending === 'draw' ? '' : ' as the winner'}?
          </span>          <button
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
/**
 * Reliability chip for the paid approval queue. Renders a wallet's cross-event
 * attendance score + lifetime no-show count so the operator approves with
 * context (Decision 2). A neutral/new wallet (score null, no history) shows
 * nothing - only surfaces when there is a real signal. Colors flag risk.
 */
function ReliabilityChip({
  score,
  noShows,
}: {
  score?: number | null
  noShows?: number
}) {
  const hasSignal = (score != null) || (noShows != null && noShows > 0)
  if (!hasSignal) return null
  const bad = (score != null && score < 30) || (noShows != null && noShows >= 3)
  const warn = !bad && ((score != null && score < 60) || (noShows != null && noShows > 0))
  const fg = bad ? '#ef4444' : warn ? '#f59e0b' : '#22c55e'
  const bg = bad ? 'rgba(239,68,68,0.15)' : warn ? 'rgba(245,158,11,0.15)' : 'rgba(34,197,94,0.15)'
  const scoreLabel = score != null ? `Rel ${score}` : 'Rel -'
  const noShowLabel = noShows != null && noShows > 0 ? ` · ${noShows} no-show${noShows === 1 ? '' : 's'}` : ''
  return (
    <span
      title="Cross-tournament wallet reliability (attendance). Higher is better; no-shows are ghosted rounds."
      className="shrink-0 cursor-help text-[10px] font-bold uppercase tracking-wide"
      style={{ color: fg, background: bg, padding: '2px 6px', borderRadius: 5 }}
    >
      {scoreLabel}{noShowLabel}
    </span>
  )
}

function ParticipantRow({
  player,
  deckCheck,
  disabled,
  running,
  showReliability,
  onApprove,
  onReject,
  onDrop,
  onViewDeck,
}: {
  player: Player
  deckCheck?: { ok: boolean; hasDeck: boolean; issues: string[] }
  disabled: boolean
  running: boolean
  showReliability?: boolean
  onApprove: () => void
  onReject: () => void
  onDrop: () => void
  onViewDeck: () => void
}) {
  const url = xProfileUrl(player.xHandle)
  const status = STATUS_STYLE[player.approvalStatus]
  const [confirmDrop, setConfirmDrop] = useState(false)
  const displayName = (player.username && player.username.trim()) || normalizeXHandle(player.xHandle)
  // Deck pill folds "has a list?" + "does it validate?" into one status.
  const deckPill = !player.hasDeckList
    ? { label: 'No deck', fg: '#ef4444', bg: 'rgba(239,68,68,0.15)', title: 'No deck list submitted yet.' }
    : !deckCheck
      ? { label: 'Deck ✓', fg: 'var(--text-secondary)', bg: 'var(--border-subtle)', title: 'Deck on file - validating…' }
      : deckCheck.ok
        ? { label: 'Deck valid', fg: '#22c55e', bg: 'rgba(34,197,94,0.15)', title: 'Every code resolves - 1 leader + 50 cards.' }
        : { label: 'Review deck', fg: '#f59e0b', bg: 'rgba(245,158,11,0.15)', title: deckCheck.issues.join(' · ') }
  return (
    <li
      className="flex min-w-0 flex-col gap-2 rounded-md px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: 'var(--bg)',
        border: '1px solid var(--border-subtle)',
        opacity: player.approvalStatus === 'rejected' ? 0.7 : 1,
      }}
    >
      {/* Info line: name + region + status. Actions stay on their own row on mobile. */}
      <div className="flex min-w-0 w-full items-center gap-1.5 overflow-hidden sm:w-auto sm:flex-1">
        <PlayerAvatar
          username={player.username}
          xHandle={player.xHandle}
          avatarUrl={player.avatarUrl}
          walletAddress={player.walletAddress ?? undefined}
          size={22}
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          title={displayName}
          className="min-w-0 shrink truncate text-sm font-semibold hover:underline"
          style={{ color: 'var(--text-primary)' }}
        >
          {displayName}
        </a>
        <RegionTag region={player.region} />
        {showReliability && (
          <ReliabilityChip score={player.reliabilityScore} noShows={player.noShowCount} />
        )}
        <span
          className="shrink-0 text-[10px] font-bold uppercase tracking-wide"
          style={{ color: status.fg, background: status.bg, padding: '2px 6px', borderRadius: 5 }}
        >
          {status.label}
        </span>
        <span
          title={deckPill.title}
          className="shrink-0 cursor-help text-[10px] font-bold uppercase tracking-wide"
          style={{ color: deckPill.fg, background: deckPill.bg, padding: '2px 6px', borderRadius: 5 }}
        >
          {deckPill.label}
        </span>
        {player.dropped && (
          <span
            className="shrink-0 text-[10px] font-bold uppercase tracking-wide"
            style={{ color: '#ef4444', background: 'rgba(239,68,68,0.15)', padding: '2px 6px', borderRadius: 5 }}
          >
            Dropped
          </span>
        )}
      </div>
      <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:shrink-0 sm:justify-end">
        <AdminBtn disabled={disabled} onClick={onViewDeck}>
          {player.hasDeckList ? 'Deck' : 'Add deck'}
        </AdminBtn>
        {player.approvalStatus !== 'approved' && (
          <AdminBtn disabled={disabled} onClick={onApprove}>
            {player.approvalStatus === 'rejected' ? 'Restore' : 'Approve'}
          </AdminBtn>
        )}
        {player.approvalStatus !== 'rejected' && !player.dropped && (
          <AdminBtn disabled={disabled} onClick={onReject}>Reject</AdminBtn>
        )}
        {player.approvalStatus === 'approved' &&
          !player.dropped &&
          (confirmDrop ? (
            <span className="inline-flex items-center gap-1.5">
              <span className="text-[11px] font-semibold" style={{ color: 'var(--text-muted)' }}>
                {running ? 'Drop (forfeits current match)?' : 'Drop?'}
              </span>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setConfirmDrop(false)
                  onDrop()
                }}
                className="text-[11px] font-bold"
                style={{ color: '#fff', background: '#ef4444', padding: '3px 9px', borderRadius: 5 }}
              >
                Yes
              </button>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setConfirmDrop(false)}
                className="text-[11px] font-semibold"
                style={{ color: 'var(--text-secondary)', padding: '3px 7px' }}
              >
                No
              </button>
            </span>
          ) : (
            <AdminBtn disabled={disabled} onClick={() => setConfirmDrop(true)}>Drop</AdminBtn>
          ))}
      </div>
    </li>
  )
}

/**
 * Host view of one player's deck list, with an operator override editor that
 * stays available through the running event (it only locks once the event is
 * complete). Fetches the full list on open (it is redacted from the public
 * snapshot). The override doubles as the way to record a walk-in's list, the
 * typo-fix escape hatch, and the way to correct a malformed submission before
 * a disqualification. Player self-submit still freezes at bracket start.
 */
function AdminDeckModal({
  player,
  code,
  adminKey,
  canEdit,
  onClose,
  onSaved,
}: {
  player: Player
  code: string
  adminKey: string
  canEdit: boolean
  onClose: () => void
  onSaved: () => void
}) {
  const [loading, setLoading] = useState(true)
  const [text, setText] = useState<string | null>(null)
  const [check, setCheck] = useState<
    { ok: boolean; leaderCount: number; deckCount: number; unknownIds: string[]; issues: string[] } | null
  >(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const r = await adminApi(adminKey, { action: 'get-deck', code, playerId: player.id })
        if (!alive) return
        setText(r.deckList ?? null)
        setCheck(r.check ?? null)
      } catch (e) {
        if (alive) setErr(e instanceof Error ? e.message : 'Could not load deck list')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => {
      alive = false
    }
  }, [adminKey, code, player.id])

  async function save() {
    const deck = draft.trim()
    if (!deck) {
      setErr('Paste a deck list to save.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await adminApi(adminKey, { action: 'set-deck', code, playerId: player.id, deckList: deck })
      setText(deck)
      setEditing(false)
      onSaved()
      // Re-pull so the validation banner reflects the freshly-saved list.
      try {
        const r = await adminApi(adminKey, { action: 'get-deck', code, playerId: player.id })
        setCheck(r.check ?? null)
      } catch {
        setCheck(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not save deck list')
    } finally {
      setBusy(false)
    }
  }

  return (
    <ModalPortal onClose={onClose} label="Deck list" maxWidth={480} className="bonk-theme">
      <BonkModuleHeader
        icon={ListChecks}
        title={`${formatXLabel(player.xHandle)} - deck list`}
        right={<BonkModalClose onClose={onClose} />}
      />
      <div style={{ padding: '20px 24px 24px', overflowY: 'auto' }}>
      {loading ? (
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={15} className="animate-spin" /> Loading…
        </div>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            disabled={busy}
            maxLength={MAX_DECK_CHARS}
            rows={10}
            spellCheck={false}
            placeholder={'1xOP01-001\n4xOP01-016\n…'}
            className="w-full rounded-md p-2.5 text-xs"
            style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono, monospace)', resize: 'vertical' }}
          />
          {err && <p className="text-sm" style={{ color: '#ef4444' }}>{err}</p>}
          <div className="flex gap-2">
            <AdminBtn disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save deck list'}
            </AdminBtn>
            <AdminBtn disabled={busy} onClick={() => setEditing(false)}>Cancel</AdminBtn>
          </div>
        </div>
      ) : (
        <>
          {text ? (
            <>
              {check && (
                <div
                  className="mb-3 rounded-md px-3 py-2 text-xs"
                  style={
                    check.ok
                      ? { color: '#16a34a', background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)' }
                      : { color: '#dc2626', background: 'rgba(239,68,68,0.10)', border: '1px solid rgba(239,68,68,0.35)' }
                  }
                >
                  {check.ok ? (
                    <span className="font-bold">Valid ✓ - every code resolves, 1 leader + 50 cards</span>
                  ) : (
                    <>
                      <span className="font-bold">Needs review ⚠</span>
                      <ul className="mt-1 list-disc pl-4">
                        {check.issues.map((issue, i) => (
                          <li key={i}>{issue}</li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
              <p className="mb-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                {deckCardCount(text)} cards
              </p>
              <DeckListBlock deckList={text} />
            </>
          ) : (
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              No deck list on file for this player yet.
            </p>
          )}
          {err && <p className="mt-2 text-sm" style={{ color: '#ef4444' }}>{err}</p>}
          {canEdit && (
            <div className="mt-3">
              <AdminBtn
                disabled={busy}
                onClick={() => {
                  setDraft(text ?? '')
                  setEditing(true)
                  setErr(null)
                }}
              >
                {text ? 'Replace deck list' : 'Add deck list'}
              </AdminBtn>
            </div>
          )}
          {!canEdit && (
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Deck lists are locked once the event is over.
            </p>
          )}
        </>
      )}
      </div>
    </ModalPortal>
  )
}
