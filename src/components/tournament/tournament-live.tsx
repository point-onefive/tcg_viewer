'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { AlertTriangle, CalendarClock, Camera, Check, ChevronRight, Clock, ExternalLink, Gift, Hash, Hourglass, ListChecks, Loader2, LogOut, PieChart, Swords, Trophy, UserPlus, Users, X } from 'lucide-react'
import { TournamentShell } from './tournament-shell'
import {
  apiActiveSnapshot,
  apiCastVote,
  apiEnroll,
  apiOwnDeck,
  apiSubmitDeckList,
  apiReportResult,
  apiDropSelf,
  loadVotedChoice,
  loadVoterId,
  saveVotedChoice,
} from '@/lib/tournament/client'
import { DEFAULT_POLL_QUESTION, POLL_OPTIONS, type PollOption, type PollResults } from '@/lib/tournament/poll'
import { deckCardCount, MAX_DECK_CHARS } from '@/lib/tournament/deck-list'
import { XLogo } from '@/components/gallery/x-logo'
import { DiscordLogo } from '@/components/tournament/discord-logo'
import { BonkModuleHeader, BonkSceneBody, BonkHeaderMascot, BonkModalClose } from '@/components/tournament/bonk-ui'
import { DeckListBlock } from '@/components/tournament/deck-list-block'
import { Leaderboard } from '@/components/wallet/leaderboard'
import { ModalPortal } from '@/components/ui/modal-portal'
import { WaitlistCard } from '@/components/tournament/waitlist-card'
import { RegionPicker } from '@/components/tournament/region-picker'
import { type Region } from '@/lib/tournament/region'
import { WalletConnectButton } from '@/components/wallet/wallet-connect-button'
import { PlayerProfileModal } from '@/components/wallet/player-profile-modal'
import { PlayerProfileView } from '@/components/wallet/player-profile-view'
import { fetchProfileByHandle, type WalletStanding } from '@/lib/wallet/api-client'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'
import { formatXLabel, xProfileUrl } from '@/lib/tournament/x-handle'
import { computeStandings, recommendedSwissRounds } from '@/lib/tournament/pairing'
import type { Match, Player, Round, StandingRow, Tournament, TournamentPrize, TournamentSnapshot, AwardedPrize } from '@/lib/tournament/types'

const POLL_MS = 12_000
const SIGNED_UP_KEY = 'tcw_tournament_signed_up'
// Minimum competitors to reveal before the "Load more" toggle. The actual
// cap is rounded UP from this to a whole number of grid rows (see useRosterCap)
// so the collapsed roster never leaves an orphaned, half-empty last row.
const ROSTER_MIN_VISIBLE = 5
// When the caller's locked deck list renders inline beside the roster (signed
// up), reveal more rows by default so the Registered panel fills a height
// comparable to the deck list instead of leaving a big blank gap under it.
const ROSTER_MIN_VISIBLE_WITH_DECK = 12

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

/**
 * A player name in the bracket / standings / matchups. Clicking opens the
 * in-app profile (record + X link + availability) rather than jumping straight
 * to X - the profile is the more useful hub. Falls back to a small card with an
 * X link when the name has no linked wallet profile (e.g. a walk-in entry).
 */
export function XProfileLink({
  handle,
  className,
  color,
}: {
  handle: string
  className?: string
  color?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          // Stop parents (e.g. a <summary> deck row) from also toggling.
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        className={className}
        title="View profile"
        style={{
          color: color ?? 'var(--text-primary)',
          fontWeight: 600,
          background: 'none',
          border: 'none',
          padding: 0,
          margin: 0,
          font: 'inherit',
          textAlign: 'left',
          maxWidth: '100%',
          cursor: 'pointer',
        }}
      >
        {formatXLabel(handle)}
      </button>
      {open && <ProfileLookupModal handle={handle} onClose={() => setOpen(false)} />}
    </>
  )
}

/**
 * Resolves an X handle to its public profile and shows it in the same popup the
 * leaderboard uses. While loading, a small spinner; if no wallet profile is
 * linked to the handle, a minimal card that still offers the X link.
 */
function ProfileLookupModal({ handle, onClose }: { handle: string; onClose: () => void }) {
  const [state, setState] = useState<{ loading: boolean; standing: WalletStanding | null }>({
    loading: true,
    standing: null,
  })

  useEffect(() => {
    let alive = true
    setState({ loading: true, standing: null })
    fetchProfileByHandle(handle).then((s) => {
      if (alive) setState({ loading: false, standing: s })
    })
    return () => {
      alive = false
    }
  }, [handle])

  if (state.loading) {
    return (
      <ModalPortal onClose={onClose} label="Player profile" maxWidth={460}>
        <div className="flex items-center justify-center" style={{ padding: 56 }}>
          <Loader2 size={22} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      </ModalPortal>
    )
  }

  if (state.standing) {
    return <PlayerProfileView standing={state.standing} onClose={onClose} />
  }

  // No linked wallet profile - still let the viewer reach their X.
  const xUrl = xProfileUrl(handle)
  return (
    <ModalPortal onClose={onClose} label="Player profile" maxWidth={380}>
      <div style={{ padding: '28px 24px', textAlign: 'center' }}>
        <p className="font-display" style={{ fontSize: 17, fontWeight: 800 }}>
          {formatXLabel(handle)}
        </p>
        <p className="mt-2 text-sm" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          No player profile linked yet.
        </p>
        {xUrl && (
          <a
            href={xUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-4 px-3.5 py-2 text-sm font-semibold"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: 8,
              color: 'var(--text-secondary)',
            }}
          >
            <XLogo size={13} />
            View on X
          </a>
        )}
      </div>
    </ModalPortal>
  )
}

function StatusPill({ status, enrollExpired }: { status: string; enrollExpired?: boolean }) {
  const map: Record<string, { bg: string; fg: string; label: string; breathe?: boolean }> = {
    enrolling: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Sign-ups open' },
    running: { bg: 'rgba(34,197,94,0.15)', fg: '#22c55e', label: 'Round in progress', breathe: true },
    complete: { bg: 'rgba(120,120,120,0.18)', fg: 'var(--text-secondary)', label: 'Complete' },
  }
  // Sign-up timer elapsed but the bracket hasn't been started yet: the window
  // is closed even though the tournament is technically still 'enrolling'.
  const s =
    status === 'enrolling' && enrollExpired
      ? { bg: 'rgba(120,120,120,0.18)', fg: 'var(--text-secondary)', label: 'Sign-ups closed' }
      : map[status] ?? map.complete
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

// Shared height for the hero meta row, so the detail chips and the countdown
// stat are all the same size and sit on one latitude.
const HERO_STAT_H = 36

/** Small labeled fact chip used in the event hero meta row. */
function MetaChip({
  icon: Icon,
  children,
  hideOnMobile = false,
  iconColor = 'var(--text-muted)',
}: {
  icon: React.ComponentType<{ size?: number; style?: React.CSSProperties }>
  children: React.ReactNode
  /** Drop the chip below `sm` so the meta row stays on one mobile line. */
  hideOnMobile?: boolean
  /** Leading-icon tint. A subtle brand-palette pop so the row isn't flat grey. */
  iconColor?: string
}) {
  return (
    <span
      className={`${hideOnMobile ? 'hidden sm:inline-flex' : 'flex sm:inline-flex'} w-full items-center gap-1.5 px-3 text-xs font-semibold sm:w-auto`}
      style={{ height: HERO_STAT_H, background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6, color: 'var(--text-secondary)' }}
    >
      <Icon size={14} style={{ color: iconColor }} />
      {children}
    </span>
  )
}

/**
 * Framed countdown stat (sign-ups closing / round ending). Label + timer sit on
 * a single row to keep the box short, so it doesn't tower over the meta chips
 * beside it in the hero. Full width on mobile (label left, timer right); content
 * width on desktop.
 */
function CountdownStat({ label, value }: { label: string; value: string }) {
  return (
    <div
      className="flex w-full shrink-0 items-center justify-between gap-2.5 px-3 sm:w-auto sm:justify-start"
      style={{ height: HERO_STAT_H, background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'var(--text-muted)' }}>
        {label}
      </span>
      <span className="bonk-mono text-base font-bold tabular-nums leading-none" style={{ color: 'var(--tcw-accent)' }}>
        {value}
      </span>
    </div>
  )
}

/** Human round length, e.g. 1440 -> "24h", 90 -> "1h 30m". */
function formatDuration(totalMinutes: number): string {
  if (totalMinutes < 60) return `${totalMinutes}m`
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

/**
 * Lean schedule strip for the hero: turns the recurring "how much time do I get?"
 * questions into a concrete answer - the per-round clock and how many rounds -
 * plus a one-line reassurance that the timers are intentionally generous so every
 * time zone can play. Sits on its own row so it never crowds the mobile chips.
 */
function ScheduleNote({
  roundMinutes,
  swissRounds,
  maxPlayers,
  format,
}: {
  roundMinutes: number
  swissRounds: number | null
  maxPlayers: number | null
  format: Tournament['format']
}) {
  // Swiss round count is fixed once the bracket is drawn; before that we show an
  // estimate from the cap so sign-ups still get a concrete number to plan around.
  let roundsLabel: string | null = null
  if (format === 'swiss') {
    if (swissRounds) roundsLabel = `${swissRounds} rounds`
    else if (maxPlayers) roundsLabel = `~${recommendedSwissRounds(maxPlayers)} rounds`
  }
  return (
    <div
      className="mt-5 flex flex-col gap-1.5 rounded-md p-3.5 sm:flex-row sm:items-center sm:gap-3"
      style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', border: '1px solid var(--border-subtle)' }}
    >
      <span className="inline-flex shrink-0 items-center gap-2 text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
        <Clock size={15} style={{ color: 'var(--bonk-purple)', flexShrink: 0 }} aria-hidden />
        {formatDuration(roundMinutes)} per round
        {roundsLabel && (
          <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}> · {roundsLabel}</span>
        )}
      </span>
      <span className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        Generous round limits to fit a global schedule.
      </span>
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
function PrizePool({ prizes, awarded }: { prizes: TournamentPrize[]; awarded?: AwardedPrize[] }) {
  // Once the event is complete, fold the declared winners straight into the
  // branded prize cards (grouped by slot, so a split prize lists everyone).
  const winnersBySlot = useMemo(() => {
    const m = new Map<number, AwardedPrize[]>()
    for (const a of awarded ?? []) {
      const arr = m.get(a.slotIndex) ?? []
      arr.push(a)
      m.set(a.slotIndex, arr)
    }
    return m
  }, [awarded])

  // Tap a prize image to enlarge it in a bare lightbox (same as leader cards).
  const [lightbox, setLightbox] = useState<{ image: string; name: string } | null>(null)
  // Mobile marquee: a native horizontal scroller (manual swipe works) that
  // also auto-advances when idle. Driven by rAF on scrollLeft, not a CSS
  // transform, so a user swipe takes over instantly and the loop stays
  // seamless (two identical copies, wrapped by exactly one copy width).
  const trackRef = useRef<HTMLDivElement | null>(null)

  // One prize card. Parameterized so it can be reused for the desktop wrap and
  // the duplicated mobile marquee track (the dup copy is aria-hidden, and the
  // mobile variant is fixed-width + shorter so the row stays compact).
  const prizeCard = (
    prize: TournamentPrize,
    i: number,
    keyPrefix = '',
    opts: { dup?: boolean; mobile?: boolean } = {},
  ) => {
    const accent = placeAccent(i)
    const medal = medalColor(i)
    return (
      <div
        key={`${keyPrefix}${i}`}
        aria-hidden={opts.dup || undefined}
        className={`flex flex-col overflow-hidden${i === 0 ? ' bonk-prize-glow' : ''}`}
        style={{
          width: opts.mobile ? 188 : 'min(100%, 240px)',
          flex: '0 0 auto',
          background: 'var(--bg)',
          border: '1px solid var(--border-subtle)',
          borderTop: `3px solid ${medal ?? 'var(--border-subtle)'}`,
          borderRadius: 12,
          boxShadow: i === 0 ? undefined : medal ? `0 0 0 1px color-mix(in srgb, ${medal} 30%, transparent)` : 'none',
        }}
      >
        {prize.image && (
          // Tap to enlarge in the shared lightbox. The dup marquee copy is
          // aria-hidden, so keep its button out of the tab order.
          <button
            type="button"
            onClick={() => setLightbox({ image: prize.image as string, name: prize.title })}
            aria-label={`Enlarge ${prize.title || 'prize'} image`}
            tabIndex={opts.dup ? -1 : undefined}
            style={{
              display: 'block',
              width: '100%',
              padding: 0,
              margin: 0,
              border: 'none',
              background: 'none',
              cursor: 'zoom-in',
            }}
          >
            {/* Preserve the original aspect ratio (no crop). Capped height keeps
                the section compact; contain letterboxes any shape. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={prize.image}
              alt={prize.title}
              style={{
                width: '100%',
                maxHeight: opts.mobile ? 116 : 160,
                objectFit: 'contain',
                display: 'block',
                background: 'var(--bg-surface)',
                borderBottom: '1px solid var(--border-subtle)',
              }}
            />
          </button>
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
          {(() => {
            const winners = winnersBySlot.get(i) ?? []
            if (winners.length === 0) return null
            return (
              <div className="flex flex-col gap-1 pt-2 mt-0.5" style={{ borderTop: '1px solid var(--border-subtle)' }}>
                <span className="bonk-mono text-[10px] uppercase tracking-[0.12em] font-bold" style={{ color: 'var(--tcw-accent)' }}>
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
            )
          })()}
        </div>
      </div>
    )
  }

  // Auto-advance the mobile marquee, but get out of the way the moment a user
  // swipes/scrolls (then resume after a short idle). Wrapping by one copy
  // width is invisible because both copies are identical pixels.
  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let raf = 0
    let resume = 0
    let paused = false
    let touching = false
    const SPEED = 0.4 // px/frame (~24px/s): a slow drift, never frantic

    const step = () => {
      const half = el.scrollWidth / 2
      if (half > 0 && !touching) {
        if (!reduce && !paused) el.scrollLeft += SPEED
        if (el.scrollLeft >= half) el.scrollLeft -= half
        else if (el.scrollLeft < 0) el.scrollLeft += half
      }
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)

    const idle = () => {
      window.clearTimeout(resume)
      resume = window.setTimeout(() => { paused = false }, 2500)
    }
    const onDown = () => { touching = true; paused = true; window.clearTimeout(resume) }
    const onUp = () => { touching = false; idle() }
    const onWheel = () => { paused = true; idle() }

    el.addEventListener('pointerdown', onDown)
    el.addEventListener('touchstart', onDown, { passive: true })
    el.addEventListener('pointerup', onUp)
    el.addEventListener('touchend', onUp)
    el.addEventListener('pointercancel', onUp)
    el.addEventListener('wheel', onWheel, { passive: true })

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(resume)
      el.removeEventListener('pointerdown', onDown)
      el.removeEventListener('touchstart', onDown)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('touchend', onUp)
      el.removeEventListener('pointercancel', onUp)
      el.removeEventListener('wheel', onWheel)
    }
  }, [prizes.length])

  return (
    <div className="mb-6 overflow-hidden" style={{ ...card, borderRadius: 16 }}>
      {/* Co-branded module header: the sponsor identity lives in the
          module chrome (a dark BONK section band), not as a sticker in
          the content. Title left, official BONK lockup right. */}
      <div className="bonk-section-band relative flex items-center justify-between gap-3 px-5 py-4">
        {/* Warm BONK glow so the dark band reads as orange-cosmic, not blue. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(90% 220% at 100% 50%, color-mix(in srgb, var(--bonk-ui-orange) 32%, transparent) 0%, transparent 58%)' }}
        />
        <div className="relative flex items-center gap-2.5">
          <Gift size={20} style={{ color: 'var(--bonk-band-icon)' }} />
          <h3 className="bonk-display" style={{ fontSize: 'clamp(18px, 3vw, 24px)', fontWeight: 900, color: 'var(--bonk-band-fg)' }}>
            Prize pool
          </h3>
        </div>
        {/* Official "powered by BONK" linear lockup, sized to sit beside the
            title without crowding it on mobile (clamped) or wrapping. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bonk/web-img/powered_by_bonk_linear_white.png"
          alt="powered by BONK"
          className="relative block w-auto shrink-0"
          style={{ height: 'clamp(20px, 4vw, 30px)' }}
        />
      </div>
      {/* Sun-gradient hairline ties the dark header to the bright prizes. */}
      <div style={{ height: 2, background: 'var(--bonk-grad-sun)' }} />

      {/* Desktop / tablet: centered wrap. */}
      <div
        className="hidden sm:flex flex-wrap justify-center p-5"
        style={{ gap: 16, maxWidth: 832, margin: '0 auto' }}
      >
        {prizes.map((prize, i) => prizeCard(prize, i))}
      </div>

      {/* Mobile: a single auto-scrolling row to reclaim vertical space. A
          CSS-only marquee (no JS) duplicated once for a seamless loop - the
          copy is aria-hidden and the track pauses on touch + respects
          reduced-motion. Only auto-scrolls when there's enough to overflow;
          otherwise it's a plain centered wrap. */}
      <div className="sm:hidden p-4">
        {prizes.length >= 3 ? (
          <div className="bonk-prize-scroller" ref={trackRef}>
            <div className="bonk-prize-track">
              {prizes.map((prize, i) => prizeCard(prize, i, 'a-', { mobile: true }))}
              {prizes.map((prize, i) => prizeCard(prize, i, 'b-', { mobile: true, dup: true }))}
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-center" style={{ gap: 12 }}>
            {prizes.map((prize, i) => prizeCard(prize, i, '', { mobile: true }))}
          </div>
        )}
      </div>

      {lightbox && (
        <LeaderCardModal
          image={lightbox.image}
          name={lightbox.name}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  )
}

/**
 * Small Leader-card chip: thumbnail + name. The Leader is public during play
 * (it is on the table and the metagame is tracked by it), so we surface it on
 * the roster even while the rest of the deck list stays hidden.
 */
export function LeaderChip({ player }: { player: Player }) {
  if (!player.leaderCardId) return null
  return (
    <span
      className="inline-flex min-w-0 shrink items-center gap-1.5"
      title={player.leaderName ?? player.leaderCardId}
    >
      <LeaderThumb
        image={player.leaderImage}
        name={player.leaderName}
        cardId={player.leaderCardId}
      />
      <span
        className="hidden truncate text-[11px] font-semibold sm:inline"
        style={{ color: 'var(--text-secondary)', maxWidth: 96 }}
      >
        {player.leaderName ?? player.leaderCardId}
      </span>
    </span>
  )
}

/**
 * A Leader-card thumbnail that opens a larger card image on tap/click. The
 * thumbnail is tiny (especially on mobile), so this gives a clean way to read
 * the actual card without leaving the page. Renders nothing if no image.
 */
function LeaderThumb({
  image,
  name,
  cardId,
  size = 22,
}: {
  image: string | null | undefined
  name: string | null | undefined
  cardId: string
  size?: number
}) {
  const [open, setOpen] = useState(false)
  if (!image) return null
  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setOpen(true)
        }}
        title={`${name ?? cardId} - tap to enlarge`}
        aria-label={`View ${name ?? cardId} leader card`}
        style={{
          padding: 0,
          border: 'none',
          background: 'none',
          cursor: 'zoom-in',
          lineHeight: 0,
          flexShrink: 0,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt={name ?? 'Leader'}
          loading="lazy"
          style={{
            width: size,
            height: size,
            borderRadius: 4,
            objectFit: 'cover',
            objectPosition: 'top center',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-surface)',
            display: 'block',
          }}
        />
      </button>
      {open && (
        <LeaderCardModal image={image} name={name ?? cardId} onClose={() => setOpen(false)} />
      )}
    </>
  )
}

function LeaderCardModal({
  image,
  name,
  onClose,
}: {
  image: string
  name: string
  onClose: () => void
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [onClose])

  if (typeof document === 'undefined') return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={name || 'Leader card'}
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(0,0,0,0.8)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'clamp(12px, 5vw, 32px)',
      }}
    >
      <button
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          background: 'rgba(0,0,0,0.5)',
          border: '1px solid rgba(255,255,255,0.25)',
          borderRadius: '50%',
          width: 34,
          height: 34,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
          color: '#fff',
        }}
      >
        <X size={18} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={image}
        alt={name}
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: 'min(420px, 92vw)',
          maxHeight: '88vh',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          borderRadius: 12,
          display: 'block',
        }}
      />
    </div>,
    document.body,
  )
}

/**
 * Public, read-only history of the prizes that were actually handed out, shown
 * only once an event is complete and its prizes have been resolved to winners.
 * Reads the frozen award snapshot (never the live pool), grouped by prize slot
 * so a single prize split across several winners renders as one card.
 */
export function AwardedPrizesHistory({ awarded }: { awarded: AwardedPrize[] }) {
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
  // Two-tap safeguard: the first tap arms a result, the second tap on the same
  // button actually submits it - so a fat-fingered "I lost" never goes through
  // on a single accidental press. Tapping a different result re-arms to that one.
  const [armed, setArmed] = useState<'win' | 'loss' | 'draw' | null>(null)

  // Auto-disarm after a few seconds so a stray first tap doesn't sit primed.
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(null), 4000)
    return () => clearTimeout(t)
  }, [armed])

  const handle = (result: 'win' | 'loss' | 'draw') => {
    if (busy !== null) return
    if (armed === result) {
      setArmed(null)
      onReport(result)
    } else {
      setArmed(result)
    }
  }

  const labelFor = (r: 'win' | 'loss' | 'draw') => (r === 'win' ? 'I won' : r === 'loss' ? 'I lost' : 'Draw')

  const btn = (
    result: 'win' | 'loss' | 'draw',
    label: string,
    accent: string,
  ) => {
    const isArmed = armed === result
    const isBusy = busy === result
    return (
      <button
        type="button"
        disabled={busy !== null}
        onClick={() => handle(result)}
        aria-pressed={isArmed}
        className="footer-btn inline-flex items-center justify-center gap-1.5 px-4 py-2 text-sm font-bold"
        style={{
          flex: 1,
          minWidth: 96,
          borderRadius: 8,
          background: isArmed ? accent : `color-mix(in srgb, ${accent} 12%, var(--bg-surface))`,
          border: `1px solid color-mix(in srgb, ${accent} ${isArmed ? 100 : 32}%, transparent)`,
          color: isArmed ? '#fff' : accent,
          opacity: busy !== null && busy !== result ? 0.5 : armed !== null && !isArmed ? 0.55 : 1,
          cursor: busy !== null ? 'default' : 'pointer',
          transition: 'background 120ms ease, opacity 120ms ease',
        }}
      >
        {isBusy ? (
          <Loader2 size={15} className="animate-spin" />
        ) : isArmed ? (
          <Check size={15} />
        ) : null}
        {isBusy ? label : isArmed ? 'Tap to confirm' : label}
      </button>
    )
  }
  return (
    <>
      <div className="mt-3 flex flex-wrap gap-2">
        {btn('win', 'I won', '#22c55e')}
        {btn('loss', 'I lost', '#ef4444')}
        {allowDraw && btn('draw', 'Draw', '#a3a3a3')}
      </div>
      {armed && busy === null && (
        <p className="mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
          Tap <strong style={{ color: 'var(--text-secondary)' }}>{labelFor(armed)}</strong> again to
          confirm, or pick another result.
        </p>
      )}
    </>
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
    <div className="mb-6 overflow-hidden" style={{ ...card, borderRadius: 14 }}>
      <BonkModuleHeader icon={Swords} eyebrow="Report results" title="Your match" />
      {/* Status-coded accent strip (win/loss/draw/pending) under the band. */}
      <div style={{ height: 3, background: accent }} />
      <div className="p-5 sm:p-6">{children}</div>
    </div>
  )

  // The section title now lives in the BONK band header.
  const header = null

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
    return shell('var(--tcw-accent)', (
      <>
        {header}
        {vsLine}
        <div className="mt-3 flex items-center gap-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
          <Loader2 size={15} className="animate-spin" style={{ color: 'var(--tcw-accent)' }} />
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
  return shell('var(--tcw-accent)', (
    <>
      {header}
      {vsLine}
      {theirReport && (
        <p className="mt-3 rounded-md px-3 py-2 text-xs" style={{ background: 'color-mix(in srgb, var(--tcw-accent) 8%, var(--bg))', border: '1px solid color-mix(in srgb, var(--tcw-accent) 22%, transparent)', color: 'var(--text-secondary)' }}>
          {oppLabel} reported {theirReport === 'win' ? 'a win' : theirReport === 'loss' ? 'a loss' : 'a draw'}. Report your result to confirm - if it matches, the bracket advances right away.
        </p>
      )}
      <p className="mt-3 text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        How did your match go?
      </p>
      <ReportButtons busy={busy} onReport={report} allowDraw={format === 'swiss'} />
      <div
        className="mt-3 flex items-start gap-1.5 rounded-md px-3 py-2 text-xs"
        style={{
          background: 'color-mix(in srgb, var(--bonk-purple) 10%, var(--bg))',
          border: '1px solid color-mix(in srgb, var(--bonk-purple) 26%, transparent)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        <ListChecks size={13} style={{ color: 'var(--bonk-purple)', flexShrink: 0, marginTop: 1 }} aria-hidden />
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>Win or lose, please report your result.</strong>{' '}
          Even after a loss, a quick tap keeps the bracket moving so everyone&rsquo;s next round can
          start on time.
        </span>
      </div>
      {error && <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>{error}</p>}
    </>
  ))
}

/**
 * Lets a signed-up player remove themselves from the event. Two-step confirm so
 * it can't be fat-fingered. While the event is live, dropping forfeits the
 * player's current match server-side so the round can still advance.
 */
function DropSelfButton({
  code,
  live,
  onDropped,
}: {
  code: string
  live: boolean
  onDropped: () => Promise<void> | void
}) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const drop = async () => {
    setBusy(true)
    setError(null)
    try {
      await apiDropSelf(code)
      await onDropped()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not drop')
      setBusy(false)
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="inline-flex items-center gap-1.5 text-xs font-semibold"
        style={{ color: 'var(--text-muted)' }}
      >
        <LogOut size={13} aria-hidden /> Drop from tournament
      </button>
    )
  }

  return (
    <div
      className="flex flex-col gap-2 rounded-md p-3"
      style={{ background: 'var(--bg)', border: '1px solid color-mix(in srgb, #ef4444 32%, transparent)' }}
    >
      <p className="text-xs" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
        {live
          ? 'Drop from this tournament? Your current match is forfeited to your opponent and you won\u2019t be paired in future rounds. This can\u2019t be undone.'
          : 'Drop from this tournament? You\u2019ll be removed from the bracket. This can\u2019t be undone.'}
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => void drop()}
          disabled={busy}
          className="footer-btn py-1.5 px-3 text-xs font-bold"
          style={{ background: '#ef4444', color: '#fff', borderRadius: 6, opacity: busy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', gap: 6 }}
        >
          {busy ? (
            <>
              <Loader2 size={13} className="animate-spin" /> Dropping…
            </>
          ) : (
            'Yes, drop me'
          )}
        </button>
        <button
          type="button"
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="footer-btn py-1.5 px-3 text-xs font-semibold"
          style={{ background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
        >
          Cancel
        </button>
      </div>
      {error && <p className="text-xs" style={{ color: '#ef4444' }}>{error}</p>}
    </div>
  )
}

/** Inline "opens in a new tab" affordance: the little box-with-arrow mark. */
function LinkOut({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1"
      style={{ color: 'var(--bonk-ui-yellow)', fontWeight: 700 }}
    >
      {children}
      <ExternalLink size={12} strokeWidth={2.5} style={{ flexShrink: 0, marginTop: -1 }} />
    </a>
  )
}

/** Punchy "how the event runs" explainer so there are no surprises. */
function HowItWorks() {
  const [deckHelp, setDeckHelp] = useState(false)
  type StepTone = 'default' | 'danger' | 'success'
  const steps: { lead: React.ReactNode; body: React.ReactNode; tone?: StepTone; cta?: boolean }[] = [
    {
      lead: 'Join the waitlist',
      body: 'No event running yet? Connect your wallet to claim your place. The waitlist holds your spot for the upcoming tournament - when sign-ups open, you are dropped in automatically.',
    },
    {
      lead: 'Sign up + submit your deck',
      body: (
        <>
          When sign-ups are open, connect your wallet to enter. A deck list is{' '}
          <strong style={{ color: '#fff' }}>required up front</strong>: build your deck in OPTCG Sim,
          copy it to your clipboard, and paste it in. The deck you submit is the deck you play for the
          whole event.{' '}
          <button
            type="button"
            onClick={() => setDeckHelp(true)}
            className="font-bold underline underline-offset-2"
            style={{ color: 'var(--bonk-ui-yellow)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
          >
            How to copy your deck
          </button>
        </>
      ),
    },
    {
      lead: (
        <span className="flex items-center gap-1.5">
          Set up
          <a
            href="https://bonkuji.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/bonk/web-img/bonkuji_logo.png" alt="Bonkuji" className="bonkuji-breathe" style={{ height: 18, width: 'auto', display: 'block' }} />
            <ExternalLink size={12} strokeWidth={2.5} style={{ color: 'var(--bonk-ui-yellow)', flexShrink: 0 }} />
          </a>
        </span>
      ),
      cta: true,
      body: (
        <>
          Prizes are paid out through Bonkuji, so a free account is required to collect. Sign in with your
          wallet, X, Google, or email - it takes about two seconds. Every top prize and participation reward
          lands here.
        </>
      ),
    },
    {
      lead: 'Get verified',
      body: 'A tournament official reviews every sign-up and approves or declines it. Approved players are locked into the bracket.',
    },
    {
      lead: 'Round 1 begins',
      body: 'As soon as the sign-up timer expires, we go straight into Round 1 - no waiting around.',
    },
    {
      lead: <>Play on <LinkOut href="https://optcgsim.com/">OPTCG Sim</LinkOut></>,
      body: 'Coordinate with your opponent and always play the most recent ruleset. Each round gets a generous timer for completion.',
    },
    {
      lead: 'Report results',
      body: 'After your match, both players tap Win or Loss on the "Your match" card. If you agree, it logs instantly and the bracket advances. If you disagree, an admin reviews it. Win or lose, please report - reporting both sides keeps the round moving for everyone.',
    },
    {
      lead: 'Share to win a prize',
      body: (
        <>
          Didn&rsquo;t place top 3? You can still earn a participation prize. Share your run on X - a
          screenshot, a replay, your deck list, or just your take - and you&rsquo;re in the running.
        </>
      ),
      tone: 'success',
    },
    {
      lead: 'Play fair',
      body: (
        <>
          Any foul play or suspected cheating is a permanent ban.{' '}
          <strong style={{ color: '#ff8a8a' }}>
            If a deck is challenged and the submitted list does not match the deck
            played, that match is an automatic forfeit.
          </strong>
        </>
      ),
      tone: 'danger',
    },
  ]
  return (
    <div id="tournament-playbook" className="relative mb-6 scroll-mt-24 overflow-hidden" style={{ ...card, borderRadius: 16, border: 'none' }}>
      {/* Full-bleed BONK scene + wash, swapped per theme: the warm bonkcoin.com
          sunrise (daytime) in light mode, the cosmic DJ "for the pack" scene in
          dark mode. The wash keeps the heading + glass step cards legible. */}
      <div aria-hidden className="bonk-how-scene bonk-how-scene--light" />
      <div aria-hidden className="bonk-how-scene bonk-how-scene--dark" />
      <div aria-hidden className="bonk-how-wash bonk-how-wash--light" />
      <div aria-hidden className="bonk-how-wash bonk-how-wash--dark" />
      <div style={{ position: 'relative', height: 3, background: 'var(--bonk-grad-sun)' }} />

      <div className="relative z-[1] p-5 sm:p-7">
        <div className="flex items-end justify-between gap-2 mb-5">
          <div>
            <span className="bonk-mono text-[11px] font-bold uppercase tracking-[0.18em]" style={{ color: 'var(--bonk-band-kicker)' }}>
              The playbook
            </span>
            <div className="mt-1 flex items-center gap-2.5">
              <ListChecks size={24} style={{ color: 'var(--bonk-band-icon)' }} />
              <h3 className="bonk-display bonk-band-title" style={{ fontSize: 'clamp(22px, 4vw, 34px)', fontWeight: 900, color: 'var(--bonk-band-fg)' }}>
                How it works
              </h3>
            </div>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/bonk/web-img/BONK_Pose_Point_001_LR.png"
            alt=""
            aria-hidden
            className="hidden shrink-0 select-none sm:block"
            style={{ width: 104, height: 'auto', marginTop: -34, marginBottom: -20, filter: 'drop-shadow(0 14px 22px rgba(0,0,0,0.5))' }}
          />
        </div>

        {/* Steps as glass cards over the scene - two columns on desktop. */}
        <div className="grid gap-3 sm:grid-cols-2">
          {steps.map((s, i) => {
            const tone = s.tone ?? 'default'
            const medal =
              tone === 'danger'
                ? 'linear-gradient(135deg, #ff5a5a 0%, #ff0000 100%)'
                : tone === 'success'
                  ? 'linear-gradient(135deg, #4ade80 0%, #16a34a 100%)'
                  : 'var(--bonk-grad-sun)'
            const leadColor = tone === 'danger' ? '#ff8a8a' : tone === 'success' ? '#86efac' : '#fff'
            const glow =
              tone === 'danger'
                ? '0 6px 16px -6px rgba(255,0,0,0.7)'
                : tone === 'success'
                  ? '0 6px 16px -6px rgba(22,163,74,0.7)'
                  : '0 6px 16px -6px color-mix(in srgb, var(--bonk-ui-orange) 80%, transparent)'
            return (
              <div
                key={i}
                className="flex items-start gap-3 rounded-2xl p-4"
                style={{
                  // Same dark glass base as every other step so the CTA reads
                  // as one of the family; a gold border + soft outer glow marks
                  // it as the call to action without washing the interior bright.
                  background: 'rgba(15,2,20,0.55)',
                  border: s.cta ? '1px solid rgba(253,194,2,0.55)' : '1px solid rgba(255,255,255,0.1)',
                  boxShadow: s.cta ? '0 0 26px -10px rgba(253,194,2,0.6)' : undefined,
                  backdropFilter: 'blur(8px)',
                  WebkitBackdropFilter: 'blur(8px)',
                }}
              >
                <span
                  className="bonk-mono shrink-0 inline-flex items-center justify-center text-sm font-bold tabular-nums"
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 999,
                    background: medal,
                    color: 'var(--bonk-midnight)',
                    fontWeight: 700,
                    boxShadow: glow,
                  }}
                >
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div
                    className="font-display font-bold"
                    style={{ color: leadColor, fontSize: 15, lineHeight: 1.25 }}
                  >
                    {s.lead}
                  </div>
                  <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.74)', lineHeight: 1.5 }}>
                    {s.body}
                  </p>
                </div>
              </div>
            )
          })}

          {/* Friendly heads-up that fills the open grid cell next to the last
              step. Deliberately NOT numbered (icon medal + "Heads up" eyebrow)
              so it reads as advice, not another rule. */}
          <div
            className="flex items-start gap-3 rounded-2xl p-4"
            style={{
              background: 'rgba(15,2,20,0.55)',
              border: '1px solid rgba(255,255,255,0.1)',
              backdropFilter: 'blur(8px)',
              WebkitBackdropFilter: 'blur(8px)',
            }}
          >
            <span
              className="shrink-0 inline-flex items-center justify-center"
              style={{
                width: 34,
                height: 34,
                borderRadius: 999,
                background: 'linear-gradient(135deg, #c084fc 0%, #7933bc 100%)',
                boxShadow: '0 6px 16px -6px rgba(121,51,188,0.7)',
              }}
            >
              <Camera size={17} style={{ color: '#fff' }} />
            </span>
            <div className="min-w-0">
              <span className="bonk-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Heads up
              </span>
              <div className="mt-0.5 font-display font-bold" style={{ color: '#fff', fontSize: 15, lineHeight: 1.25 }}>
                Save your battle logs
              </div>
              <p className="mt-1 text-sm" style={{ color: 'rgba(255,255,255,0.74)', lineHeight: 1.5 }}>
                Screenshot and keep the game log from each match. If a result is ever disputed, having
                your own record makes it quick and painless for an admin to sort out.
              </p>
            </div>
          </div>
        </div>

        {/* Community: matches + content live in Discord, but invite links
            expire - so we never link Discord directly. Point people to X
            (which never expires) to get added to the players chat. */}
        <div
          className="mt-3 flex items-start gap-3 rounded-2xl px-4 py-3.5"
          style={{
            background: 'rgba(88,101,242,0.22)',
            border: '1px solid rgba(88,101,242,0.5)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
          }}
        >
          <DiscordLogo size={22} style={{ color: '#fff', marginTop: 1, flexShrink: 0 }} />
          <span className="text-sm" style={{ color: 'rgba(255,255,255,0.82)', lineHeight: 1.5 }}>
            <span className="bonk-mono text-[10px] font-bold uppercase tracking-[0.16em]" style={{ color: 'rgba(255,255,255,0.6)' }}>
              Community
            </span>
            <span className="block mt-0.5">
              Matches, screenshares, and spectating all happen in our{' '}
              <span className="font-display font-bold" style={{ color: '#fff' }}>Discord</span>.
              Reach out on{' '}
              <a
                href={xProfileUrl('point_onefive')}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Reach out on X"
                style={{ color: '#fff', textDecoration: 'none' }}
              >
                <XLogo size="1.1em" title="X" />
              </a>{' '}
              to be added to the players chat for further instructions and invites.
              Share your replays, deck lists, and highlights there - creating content
              is a great way to get noticed.
            </span>
          </span>
        </div>
      </div>

      {deckHelp && <DeckHelpModal onClose={() => setDeckHelp(false)} />}
    </div>
  )
}

/** Quick reference for exporting an OPTCG Sim deck list to paste at sign-up. */
function DeckHelpModal({ onClose }: { onClose: () => void }) {
  return (
    <ModalPortal onClose={onClose} label="How to copy your deck" maxWidth={460} className="bonk-theme">
      <BonkModuleHeader
        icon={ListChecks}
        title="Copy your deck"
        right={<BonkModalClose onClose={onClose} />}
      />
      <div style={{ padding: '20px 24px 24px', overflowY: 'auto' }}>
        <ol className="flex flex-col gap-2.5 text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <li>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>1.</span> Open your deck in the
            OPTCG Sim deck builder.
          </li>
          <li>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>2.</span> Use the
            export / <em>Copy to Clipboard</em> option. It copies the full list in OPTCG Sim&rsquo;s text
            format (one card per line, with quantities and card codes).
          </li>
          <li>
            <span className="font-bold" style={{ color: 'var(--text-primary)' }}>3.</span> Paste it straight
            into the deck-list box when you sign up. Don&rsquo;t edit the text - submit it exactly as copied.
          </li>
        </ol>
        <p
          className="mt-4 rounded-md p-3 text-xs"
          style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)', lineHeight: 1.5 }}
        >
          Your submitted list is locked for the whole event - the deck you sign up with is the deck you play
          every round.
        </p>
      </div>
    </ModalPortal>
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
  question,
  options,
  canVote,
  signedUp,
  pollOpen,
  onVoted,
}: {
  code: string
  poll: PollResults
  question: string
  options: PollOption[]
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
  const leadCount = total > 0 ? Math.max(...options.map((o) => results.counts[o.id] ?? 0)) : 0
  // Desktop columns: keep rows balanced for any ballot size (2-6). One col
  // on mobile (handled in CSS); 4 options read best as a 2x2.
  const pollCols = options.length <= 3 ? options.length : options.length === 4 ? 2 : 3

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
    <div className="mb-6 overflow-hidden" style={{ ...card, borderRadius: 14 }}>
      <BonkModuleHeader
        icon={PieChart}
        eyebrow="Player feedback"
        title="Community Poll"
        right={<BonkHeaderMascot src="/bonk/web-img/BONK_Pose_Peace_003_LR.png" />}
      />
      <div className="p-5">
      <h3 className="font-display text-lg font-bold tracking-tight text-center">{question}</h3>
      <p className="mb-4 mt-1 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
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

      <div
        className="poll-grid mx-auto"
        style={{ ['--poll-cols' as string]: pollCols, maxWidth: pollCols * 220 } as React.CSSProperties}
      >
        {options.map((opt) => {
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
                      ? 'var(--tcw-accent)'
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
                  {mine && <Check size={14} strokeWidth={3} style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />}
                </div>
                <span className="flex-1 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.35 }}>
                  {opt.blurb}
                </span>
                <div className="flex items-end justify-between gap-1.5">
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-muted)' }} />
                  ) : showResults ? (
                    <>
                      <span className="bonk-mono text-2xl font-bold leading-none tabular-nums">{pct}%</span>
                      <span className="bonk-mono text-[10px] tabular-nums" style={{ color: 'var(--text-muted)' }}>
                        {count} {count === 1 ? 'vote' : 'votes'}
                      </span>
                    </>
                  ) : (
                    <span className="w-full text-center text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--tcw-accent)' }}>
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
                  ? 'color-mix(in srgb, var(--tcw-accent) 55%, transparent)'
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
                className="press-btn"
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
    </div>
  )
}

/**
 * BONK sponsorship banner. Co-brand announcement at the top of the live
 * page: "powered by BONK" lockup, the BONK Dog mascot, and the prize
 * tease. Palette + mascot usage follow public/bonk/BRAND.md (BONK Dog is
 * "a winner!!!"; red reserved for the "!!!"; gradient brings BONK to life).
 */
/**
 * Full-bleed cosmic hero, mirroring the bonkuji.com landing hero: an
 * edge-to-edge dark space banner (no pill container) with a big left-aligned
 * headline, a peeking BONK Dog on the right, warm orange glow + embers. Sits
 * flush under the page header and spans the viewport width.
 */
function BonkHero() {
  return (
    <section className="bonk-hero" aria-label="BONK Championship Series">
      {/* Desktop-only faded cosmic scene to fill the wide real estate. Masked
          toward the left so the headline keeps full contrast. */}
      <div aria-hidden className="bonk-hero__scene" />
      <div aria-hidden className="bonk-hero__embers" />
      <div aria-hidden className="bonk-hero__glow" />
      {/* Mascot is a direct child of the full-bleed section (not the padded
          wrap) so right:0 lands it flush against the true container edge. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/bonk/web-img/BONK_Pose_One_001_LR.png"
        alt="BONK Dog"
        className="bonk-hero__mascot select-none"
      />
      <div className="bonk-hero__wrap">
        <div className="bonk-hero__inner">
          <div className="bonk-hero__copy">
            <span className="bonk-hero__badge bonk-mono">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/bonk/web-img/master_logo.png" alt="" aria-hidden />
              Official prize partner
            </span>
            <h1 className="bonk-hero__title bonk-display">
              BONK Championship<br className="hidden sm:block" /> Series
              <span className="bonk-hero__bang">!!!</span>
            </h1>
            <p className="bonk-hero__sub">
              Prizes for winners, participants, and content creators.
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/**
 * Closing co-brand strip. Bookends the page opposite the sponsor banner:
 * BONK Dog (peace), the brand's own community line, and an attributed
 * "powered by BONK" lockup linking out to bonkcoin.com.
 */
function BonkFooter() {
  return (
    <div
      className="relative mt-8 overflow-hidden"
      style={{
        borderRadius: 20,
        boxShadow: '0 24px 60px -24px rgba(23,0,28,0.7)',
      }}
    >
      {/* Scene + wash swap per theme (warm daytime in light, cosmic sunset at
          night), matching the how-it-works strip so the footer adapts too. */}
      <div aria-hidden className="bonk-foot-scene bonk-foot-scene--light pointer-events-none" />
      <div aria-hidden className="bonk-foot-scene bonk-foot-scene--dark pointer-events-none" />
      <div aria-hidden className="bonk-foot-wash bonk-foot-wash--light pointer-events-none" />
      <div aria-hidden className="bonk-foot-wash bonk-foot-wash--dark pointer-events-none" />
      {/* Warm light source bottom-left, the way BONK lights its dark scenes. */}
      <div
        aria-hidden
        className="bonk-dark-only pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(70% 130% at 12% 100%, color-mix(in srgb, var(--bonk-ui-orange) 38%, transparent) 0%, transparent 60%)' }}
      />
      <div className="relative z-[1] flex flex-col items-center gap-5 px-6 py-8 text-center sm:flex-row sm:gap-7 sm:px-10 sm:text-left">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/bonk/web-img/BONK_Pose_Peace_001_LR.png"
          alt="BONK Dog"
          className="bonk-sway shrink-0"
          style={{ width: 'clamp(96px, 18vw, 128px)', height: 'auto', marginTop: -14, marginBottom: -14, filter: 'drop-shadow(0 14px 22px rgba(0,0,0,0.45))' }}
        />
        <div className="min-w-0 flex-1">
          <p className="bonk-display bonk-band-title" style={{ color: 'var(--bonk-band-fg)', fontSize: 'clamp(18px, 2.6vw, 26px)', fontWeight: 800, lineHeight: 1.15 }}>
            BONK Dog is a winner<span style={{ color: 'var(--bonk-foot-bang)' }}>!!!</span>
          </p>
          <p className="mt-2 text-sm font-medium" style={{ color: 'color-mix(in srgb, var(--bonk-band-fg) 76%, transparent)', lineHeight: 1.5 }}>
            He wins for the community, never gives up, and never surrenders. This
            event&rsquo;s prize pool is proudly backed by BONK.
          </p>
        </div>
        <a
          href="https://bonkcoin.com/"
          target="_blank"
          rel="noopener noreferrer"
          className="bonk-mono shrink-0 inline-flex items-center gap-2.5 rounded-full px-5 py-2.5 text-xs font-bold uppercase tracking-[0.08em] transition-transform hover:-translate-y-0.5"
          style={{ background: 'var(--bonk-grad-ui)', color: '#fff', boxShadow: '0 10px 26px -10px color-mix(in srgb, var(--bonk-ui-orange) 80%, transparent)' }}
          aria-label="Learn more about BONK at bonkcoin.com"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/bonk/web-img/master_logo.png" alt="" aria-hidden style={{ height: 26, width: 'auto', display: 'block' }} />
          bonkcoin.com
        </a>
      </div>
    </div>
  )
}

export function TournamentLive() {
  const { status: walletStatus, profile } = useWalletAuth()
  const [snapshot, setSnapshot] = useState<TournamentSnapshot | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
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
  // Region the player will play from (required at sign-up). Pre-filled from the
  // wallet profile's saved region so a returning player doesn't re-pick.
  const [regionDraft, setRegionDraft] = useState<Region | null>(null)
  // Post-entry deck submission (waitlist conversions who entered without one)
  // and viewing one's own locked list during the event.
  const [submitDeckBusy, setSubmitDeckBusy] = useState(false)
  // The caller's own locked list, fetched inline (no modal) and shown right in
  // the Sign up panel once they're signed up with a deck on file.
  const [ownDeck, setOwnDeck] = useState<{ loading: boolean; text: string | null }>({
    loading: false,
    text: null,
  })
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

  // Pre-fill the sign-up region from the saved profile region (without
  // clobbering an in-progress manual pick).
  useEffect(() => {
    if (profile?.region) setRegionDraft((cur) => cur ?? profile.region)
  }, [profile?.region])

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

  const visiblePlayers = useMemo(() => {
    const active = (snapshot?.players ?? []).filter((p) => p.approvalStatus !== 'rejected')
    // Verified (approved) players float to the top; within each group everyone
    // keeps their original sign-up order (Array.sort is stable).
    return [...active].sort(
      (a, b) =>
        (a.approvalStatus === 'approved' ? 0 : 1) - (b.approvalStatus === 'approved' ? 0 : 1),
    )
  }, [snapshot?.players])

  // "Signed up" reflects only fully approved players. Pending sign-ups and
  // waitlist converts (both stored as approval_status 'pending') surface
  // separately as "in queue" so the headline count isn't inflated by people
  // who haven't been approved yet.
  const approvedCount = useMemo(
    () => visiblePlayers.filter((p) => p.approvalStatus === 'approved').length,
    [visiblePlayers],
  )
  const queuedCount = useMemo(
    () => visiblePlayers.filter((p) => p.approvalStatus === 'pending').length,
    [visiblePlayers],
  )

  const signupOpen = Boolean(
    tournament?.status === 'enrolling' &&
      tournament.enrollClosesAt &&
      new Date(tournament.enrollClosesAt) > new Date(),
  )

  // Status is still 'enrolling' but the sign-up timer has run out (the bracket
  // is started manually, so the cron never flips status on its own). Flag this
  // so the public pill reads "Sign-ups closed" instead of staying green. The
  // 1s signup countdown re-renders this component, so it flips on time.
  const enrollExpired = Boolean(
    tournament?.status === 'enrolling' &&
      tournament.enrollClosesAt &&
      new Date(tournament.enrollClosesAt) <= new Date(),
  )

  // Roster is at capacity (matches the server-side cap check, which counts every
  // non-rejected sign-up). When full, newcomers can't enter even though the
  // sign-up timer is still running, so we steer them to the next-event waitlist
  // instead of a dead-end "tournament is full" error.
  const isFull = Boolean(
    tournament?.maxPlayers != null && visiblePlayers.length >= tournament.maxPlayers,
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
  const rosterMin = ownDeck.text ? ROSTER_MIN_VISIBLE_WITH_DECK : ROSTER_MIN_VISIBLE
  const rosterCap = useMemo(
    () => Math.ceil(rosterMin / rosterCols) * rosterCols,
    [rosterCols, rosterMin],
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
    if (!regionDraft) {
      setActionError('Pick the region you\u2019ll be playing from.')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await apiEnroll(tournament.code, deck, regionDraft)
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

  // Auto-load the caller's own locked list inline (private to the owner + host)
  // once they're signed up with a deck on file - no modal, it renders right in
  // the Sign up panel's open space. Keyed on the stable player *id* (not the
  // myPlayer object, which gets a fresh reference on every snapshot poll) so it
  // fetches once instead of flashing blank->filled on each refresh. Existing
  // text is kept while any re-fetch is in flight, so the panel never blanks.
  const myPlayerId = myPlayer?.id ?? null
  useEffect(() => {
    const code = tournament?.code
    if (!code || !myPlayerId || owesDeckList) {
      setOwnDeck({ loading: false, text: null })
      return
    }
    let cancelled = false
    setOwnDeck((prev) => ({ loading: prev.text == null, text: prev.text }))
    apiOwnDeck(code)
      .then((res) => {
        if (!cancelled) setOwnDeck({ loading: false, text: res.deckList })
      })
      .catch(() => {
        if (!cancelled) setOwnDeck((prev) => ({ loading: false, text: prev.text }))
      })
    return () => {
      cancelled = true
    }
  }, [tournament?.code, myPlayerId, owesDeckList])

  if (loadError && !snapshot) {
    return (
      <TournamentShell hero={<BonkHero />} bonk>
        <div className="mx-auto" style={{ maxWidth: 1080 }}>
          <div className="mx-auto mb-6 max-w-md p-8 text-center" style={card}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/bonk/web-img/BONK_Pose_Head_001_LR.png"
              alt="BONK Dog"
              style={{ width: 116, height: 'auto', margin: '0 auto 14px', display: 'block', filter: 'drop-shadow(0 12px 20px rgba(23,0,28,0.2))' }}
            />
            <p className="font-display text-lg font-bold">No active tournament</p>
            <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
              {loadError.includes('No tournament') ? 'Check back when the next event opens, or get in line below.' : loadError}
            </p>
          </div>
          <WaitlistCard />
          <div className="mt-6 flex justify-center">
            <Link
              href="/tournaments/history"
              className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
            >
              <Trophy size={15} style={{ color: 'var(--tcw-accent)' }} aria-hidden /> Browse past events
              <ChevronRight size={15} aria-hidden />
            </Link>
          </div>
        </div>
      </TournamentShell>
    )
  }

  if (!snapshot || !tournament) {
    return (
      <TournamentShell hero={<BonkHero />} bonk>
        <div className="flex justify-center py-20 gap-2" style={{ color: 'var(--text-muted)' }}>
          <Loader2 size={18} className="animate-spin" /> Loading…
        </div>
      </TournamentShell>
    )
  }

  return (
    <TournamentShell hero={<BonkHero />} bonk>
      <div className="mx-auto" style={{ maxWidth: 1080 }}>
      {/* Global leaderboard across all tournaments */}
      <Leaderboard />

      {/* Archive of finished events (final standings + published deck lists). */}
      <div className="mb-6 flex justify-end">
        <Link
          href="/tournaments/history"
          className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-secondary)', textDecoration: 'none' }}
        >
          <Trophy size={15} style={{ color: 'var(--tcw-accent)' }} aria-hidden /> Past events
          <ChevronRight size={15} aria-hidden />
        </Link>
      </div>

      {/* Next-event waitlist. Shown when the current event is not actively
          enrolling, OR when it is enrolling but already full - either way new
          arrivals can still queue for the next one. */}
      {(!signupOpen || (isFull && !signedUp)) && (
        <WaitlistCard
          note={
            signupOpen && isFull
              ? 'This event is full. Join the waitlist and you\u2019ll be auto-entered (pending approval) the moment the next tournament opens.'
              : undefined
          }
        />
      )}

      {/* Event hero */}
      <div className="mb-6 overflow-hidden" style={{ ...card, borderRadius: 16 }}>
        <BonkModuleHeader
          icon={Trophy}
          title={tournament.name}
          right={<span className="hidden sm:block"><StatusPill status={tournament.status} enrollExpired={enrollExpired} /></span>}
        />
        <BonkSceneBody scene="/bonk/scenes/scene-snowglobe.jpg" sceneLight="/bonk/scenes/scene-bonk-day.jpg" position="center 28%" className="p-5 sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="min-w-0">
              {/* Mobile: even 2-col grid so the chips read as a tidy block
                  instead of an orphaned, lopsided wrap. Desktop: inline row. */}
              <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
                <MetaChip icon={Hash} iconColor="var(--bonk-ui-yellow)">{tournament.code}</MetaChip>
                <MetaChip icon={Swords} iconColor="var(--bonk-ui-orange)">{tournament.format === 'swiss' ? 'Swiss' : 'Single elim'}</MetaChip>
                <MetaChip icon={Users} iconColor="#22c55e">
                  {approvedCount}
                  {tournament.maxPlayers ? ` / ${tournament.maxPlayers}` : ''}
                  <span className="hidden sm:inline"> registered</span>
                </MetaChip>
                <MetaChip icon={Hourglass} iconColor="var(--bonk-pink)">
                  {queuedCount} in queue
                </MetaChip>
              </div>
            </div>
            {signupOpen && <CountdownStat label="Sign-ups close in" value={signupCountdown} />}
            {tournament.status === 'running' && activeRound && (
              <CountdownStat label={`Round ${activeRound.number} ends in`} value={roundCountdown} />
            )}
          </div>
          {tournament.status !== 'complete' && (
            <ScheduleNote
              roundMinutes={tournament.roundMinutes}
              swissRounds={tournament.swissRounds}
              maxPlayers={tournament.maxPlayers}
              format={tournament.format}
            />
          )}
          {tournament.rules && (
            <p className="mt-5 whitespace-pre-wrap rounded-md p-3.5 text-sm" style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {tournament.rules}
            </p>
          )}
          {tournament.contactUrl && (
            <p className="mt-3 text-sm">
              <a href={tournament.contactUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 font-semibold" style={{ color: 'var(--tcw-accent)' }}>
                <CalendarClock size={14} /> Coordination link (Discord / stream)
              </a>
            </p>
          )}
        </BonkSceneBody>
      </div>

      {/* Sign-up form + roster. Once the bracket is live the roster is
          redundant (everyone shows in the bracket/standings), so the whole
          block only renders while the event is still enrolling. */}
      {tournament.status === 'enrolling' && (
      <div className={signupOpen ? 'mb-6 grid gap-6 lg:grid-cols-[1fr_1.2fr]' : 'mb-6'}>
        {/* Sign up */}
        {signupOpen && (
          <div className="overflow-hidden" style={{ ...card, borderRadius: 14 }}>
            <BonkModuleHeader
              icon={UserPlus}
              title="Sign up"
              right={<BonkHeaderMascot src="/bonk/web-img/BONK_Pose_Wave_001_LR.png" />}
            />
            <div className="p-5">
            {signedUp ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  You&rsquo;re in the queue
                  {profile?.xHandle ? ` as @${profile.xHandle}` : ''}. Your handle
                  will be verified before the bracket is posted.
                </p>
                {owesDeckList ? (
                  <div className="flex flex-col gap-2 rounded-md p-3" style={{ background: 'var(--bg)', border: '1px solid rgba(232,93,42,0.4)' }}>
                    <p className="text-xs font-bold" style={{ color: 'var(--tcw-accent)' }}>
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
                      className="footer-btn bonk-cta py-2 text-sm font-bold"
                      style={{ background: 'var(--tcw-accent)', color: '#fff', borderRadius: 6, opacity: submitDeckBusy ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
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
                ) : myPlayer && ownDeck.loading ? (
                  <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                    <Loader2 size={15} className="animate-spin" /> Loading your deck list…
                  </div>
                ) : myPlayer && ownDeck.text ? (
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-1.5 text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
                      <ListChecks size={13} aria-hidden style={{ color: 'var(--tcw-accent)' }} />
                      Your locked deck list
                      <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                        - {deckCardCount(ownDeck.text)} cards, committed for the whole event
                      </span>
                    </div>
                    <DeckListBlock deckList={ownDeck.text} maxHeight={420} />
                  </div>
                ) : null}
              </div>
            ) : isFull ? (
              <div
                className="flex flex-col gap-2 rounded-md px-3.5 py-3"
                style={{
                  background: 'color-mix(in srgb, var(--bonk-pink) 10%, var(--bg))',
                  border: '1px solid color-mix(in srgb, var(--bonk-pink) 28%, transparent)',
                }}
              >
                <p className="text-sm font-bold" style={{ color: 'var(--text-primary)' }}>
                  This tournament is full.
                </p>
                <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  The roster
                  {tournament.maxPlayers ? ` of ${tournament.maxPlayers}` : ''} is set, so
                  sign-ups are closed. Hop on the next-event waitlist above and you&rsquo;ll be
                  auto-entered (pending approval) the moment the next tournament opens.
                </p>
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
                  className="footer-btn bonk-cta py-2.5 text-sm font-bold"
                  style={{ background: 'var(--tcw-accent)', color: '#fff', borderRadius: 6 }}
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
                <RegionPicker
                  value={regionDraft}
                  onChange={setRegionDraft}
                  disabled={busy}
                  hint="Helps us plan events around your time zone."
                />
                {actionError && <p className="text-sm" style={{ color: '#ef4444' }}>{actionError}</p>}
                <button
                  onClick={() => void doEnroll()}
                  disabled={busy || !regionDraft}
                  className="footer-btn bonk-cta py-2.5 text-sm font-bold"
                  style={{ background: 'var(--tcw-accent)', color: '#fff', borderRadius: 6, opacity: busy || !regionDraft ? 0.6 : 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
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
          </div>
        )}

        {/* Roster: balanced beside the form while enrolling, full-width
            multi-column once sign-ups close so it never orphans. */}
        <div className="overflow-hidden" style={{ ...card, borderRadius: 14 }}>
          <BonkModuleHeader
            icon={Users}
            title={signupOpen ? 'Registered' : 'Competitors'}
            right={
              <>
                <span
                  className="inline-flex items-center justify-center self-center font-display text-xs font-bold tabular-nums"
                  style={{ minWidth: 24, height: 22, padding: '0 7px', borderRadius: 6, background: 'var(--bonk-band-chip-bg)', color: 'var(--bonk-band-chip-fg)' }}
                >
                  {approvedCount}
                </span>
                <BonkHeaderMascot src="/bonk/web-img/BONK_Pose_Peace_001_LR.png" />
              </>
            }
          />
          <div className="p-5">
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
      </div>
      )}

      {tournament.prizes.length > 0 && (
        <PrizePool
          prizes={tournament.prizes}
          awarded={tournament.status === 'complete' ? snapshot.awardedPrizes : undefined}
        />
      )}

      {/* Your match - sits directly above the bracket so the two read together */}
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

      {/* Self-drop: a signed-up player can remove themselves from the event. */}
      {signedUp && tournament.status !== 'complete' && (
        <div className="mb-6 flex justify-center">
          {myPlayer?.dropped ? (
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              You&rsquo;ve dropped from this tournament.
            </p>
          ) : (
            <DropSelfButton
              code={tournament.code}
              live={tournament.status === 'running'}
              onDropped={refresh}
            />
          )}
        </div>
      )}

      <PollCard
        code={tournament.code}
        poll={snapshot.poll}
        question={tournament.pollQuestion ?? DEFAULT_POLL_QUESTION}
        options={tournament.pollOptions ?? POLL_OPTIONS}
        canVote={signedUp && tournament.status !== 'complete' && tournament.pollOpen}
        signedUp={signedUp}
        pollOpen={tournament.pollOpen}
        onVoted={refresh}
      />

      <HowItWorks />

      {/* Closing co-brand strip */}
      <BonkFooter />
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
        <ListChecks size={13} style={{ color: 'var(--tcw-accent)' }} /> Deck list (required)
      </label>
      <p className="text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        In OPTCG Sim, open your deck and hit{' '}
        <span className="font-semibold" style={{ color: 'var(--text-secondary)' }}>Copy Deck list to Clipboard</span>,
        then paste it here.
      </p>
      <div
        className="flex items-start gap-1.5 rounded-md px-2.5 py-2 text-xs"
        style={{
          background: 'color-mix(in srgb, #f59e0b 10%, var(--bg))',
          border: '1px solid color-mix(in srgb, #f59e0b 32%, transparent)',
          color: 'var(--text-secondary)',
          lineHeight: 1.5,
        }}
      >
        <AlertTriangle size={13} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 1 }} aria-hidden />
        <span>
          <strong style={{ color: 'var(--text-primary)' }}>Submissions are final.</strong>{' '}
          You can&rsquo;t edit this list after submitting, so double-check it and keep
          your own copy. Make sure your deck is legal under the latest ruleset before
          you submit.{' '}
          <button
            type="button"
            onClick={() =>
              document
                .getElementById('tournament-playbook')
                ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }
            className="font-bold underline underline-offset-2"
            style={{ color: '#f59e0b', background: 'none', border: 'none', padding: 0, cursor: 'pointer', font: 'inherit' }}
          >
            Read the tournament rules.
          </button>
        </span>
      </div>
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

export function RoundBoard({
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
    <div className="mt-6 overflow-hidden" style={{ ...card, borderRadius: 16 }}>
      <BonkModuleHeader
        icon={Swords}
        title={`Round ${selectedRound?.number ?? 1}`}
        subtitle={
          <>Swiss · {totalRounds} rounds total · everyone keeps playing. Pairings shuffle by record.</>
        }
      />
      <BonkSceneBody scene="/bonk/scenes/scene-astronaut.jpg" sceneLight="/bonk/scenes/scene-bonk-day.jpg" position="center 20%" className="p-5 sm:p-6">
        {selectedRound?.status === 'active' && selectedRound.endsAt && (
          <div className="mb-5 flex justify-end">
            <CountdownStat label={`Round ${selectedRound.number} ends in`} value={roundCountdown} />
          </div>
        )}

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
                </button>
              )
            })}
          </div>
        )}

        <p className="mb-5 text-xs" style={{ color: 'var(--text-muted)' }}>
          DM your opponent on <XLogo /> to schedule, then report your result. Matches confirm automatically once you both agree - the admin only steps in to settle disputes.
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
      </BonkSceneBody>
    </div>
  )
}

export function StandingsTable({ standings, nameById, complete }: { standings: StandingRow[]; nameById: Map<string, Player>; complete: boolean }) {
  if (standings.length === 0) return null
  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-3">
        <Trophy size={15} style={{ color: 'var(--tcw-accent)' }} />
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
              <th className="text-left font-bold uppercase tracking-wider py-2 px-2" style={{ fontSize: 10 }}>Deck</th>
              <th className="text-center font-bold uppercase tracking-wider py-2 px-2" style={{ fontSize: 10, width: 90 }}>W-L-D</th>
              <th className="text-right font-bold uppercase tracking-wider py-2 px-2" style={{ fontSize: 10, width: 56 }}>Pts</th>
              <th className="text-right font-bold uppercase tracking-wider py-2 pl-2 pr-3 hidden sm:table-cell" style={{ fontSize: 10, width: 72 }}>OMW%</th>
            </tr>
          </thead>
          <tbody>
            {standings.map((s) => {
              const top = s.rank <= 3 && complete
              const medal = s.rank === 1 ? '#f5b301' : s.rank === 2 ? '#c4cad3' : s.rank === 3 ? '#cd7f32' : null
              const player = nameById.get(s.playerId)
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
                      {s.tied && (
                        <span
                          title="Tied on every tiebreaker - placement decided by a tiebreaker, not by name."
                          className="inline-flex items-center text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5"
                          style={{ color: '#f5b301', background: 'color-mix(in srgb, #f5b301 14%, transparent)', borderRadius: 4, lineHeight: 1 }}
                        >
                          tied
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="py-2 px-2 min-w-0">
                    {player?.leaderCardId ? (
                      <span className="inline-flex items-center gap-1.5" title={player.leaderName ?? player.leaderCardId}>
                        <LeaderThumb
                          image={player.leaderImage}
                          name={player.leaderName}
                          cardId={player.leaderCardId}
                        />
                        <span className="hidden truncate sm:inline" style={{ color: 'var(--text-secondary)', maxWidth: 130 }}>
                          {player.leaderName ?? player.leaderCardId}
                        </span>
                      </span>
                    ) : (
                      <span style={{ color: 'var(--text-muted)' }}>-</span>
                    )}
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
      {standings.some((s) => s.tied) ? (
        <p className="mt-2 text-[11px] leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Ties break on merit only: match points, then opponents&rsquo; win % (OMW),
          head-to-head, then opponents&rsquo; opponents&rsquo; win %. Players still
          dead-even are marked <span style={{ color: '#f5b301', fontWeight: 700 }}>tied</span> and,
          if it affects a placing, settled by a tiebreaker - never by name.
        </p>
      ) : null}
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
    <div className="mt-6 overflow-hidden" style={{ ...card, borderRadius: 16 }}>
      <BonkModuleHeader
        icon={Swords}
        title="Bracket"
        subtitle={<>Single elimination · seeded · lose once and you are out.</>}
        right={
          champion ? (
            <div
              className="inline-flex items-center gap-2 px-3 py-2"
              style={{ background: 'color-mix(in srgb, #f5b301 22%, #17001c)', border: '1px solid color-mix(in srgb, #f5b301 55%, transparent)', borderRadius: 8 }}
            >
              <Trophy size={15} style={{ color: '#f5b301' }} />
              <XProfileLink handle={champion.xHandle} className="text-sm font-bold" color="#fff" />
              <span className="text-[10px] uppercase tracking-widest font-bold" style={{ color: 'rgba(255,255,255,0.55)' }}>
                Champion
              </span>
            </div>
          ) : undefined
        }
      />
      <BonkSceneBody scene="/bonk/scenes/scene-astronaut.jpg" sceneLight="/bonk/scenes/scene-bonk-day.jpg" position="center 20%" className="p-5 sm:p-6">
        <p className="mb-5 text-xs" style={{ color: 'var(--text-muted)' }}>
          DM your opponent on <XLogo /> to schedule, then report your result. Matches confirm automatically and winners advance - the admin only steps in to settle disputes.
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
      </BonkSceneBody>
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
            border: '1px solid color-mix(in srgb, var(--tcw-accent) 45%, var(--border-subtle))',
            boxShadow: 'var(--shadow-card)',
          }}
        >
          <ChevronRight size={16} style={{ color: 'var(--tcw-accent)' }} />
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
  // Provisional single-sided reports carry a winnerId before they're finalized;
  // don't surface them as a decided bracket result.
  const decided = match.status === 'confirmed' || match.status === 'bye'
  const winnerId = decided ? match.winnerId : null
  const pub = publicMatchStatus(match.status)
  return (
    <div
      className="overflow-hidden"
      style={{ background: 'var(--bg)', border: '1px solid var(--border-subtle)', borderRadius: 6 }}
    >
      <ElimSlot player={p1} seed={p1?.seed} winner={winnerId === match.player1Id} />
      <div style={{ height: 1, background: 'var(--border-subtle)' }} />
      {isBye ? (
        <div
          className="px-2.5 py-2 text-[11px] font-semibold italic"
          style={{ color: 'var(--text-muted)', background: 'color-mix(in srgb, var(--text-primary) 4%, var(--bg))' }}
        >
          Bye
        </div>
      ) : (
        <ElimSlot player={p2 ?? undefined} seed={p2?.seed} winner={winnerId === match.player2Id} />
      )}
      {pub && (
        <div
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[9px] font-bold uppercase tracking-widest"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: pub.tone }}
        >
          {pub.icon === 'check' ? (
            <Check size={10} strokeWidth={3} style={{ flexShrink: 0 }} />
          ) : pub.icon === 'alert' ? (
            <AlertTriangle size={10} style={{ flexShrink: 0 }} />
          ) : pub.icon === 'clock' ? (
            <Clock size={10} style={{ flexShrink: 0 }} />
          ) : (
            <Hourglass size={10} style={{ flexShrink: 0 }} />
          )}
          {pub.label}
        </div>
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

/**
 * Public-facing status strip for a match. It signals PROGRESS only and never
 * reveals who reported what - the per-player claims stay private to the two
 * players (only they see their reports on the "Your match" card). States:
 *   - pending   : nobody has reported yet            -> muted "Awaiting result"
 *   - reported  : one player reported, waiting on the other -> yellow
 *   - disputed  : reports conflict, admin to settle   -> orange "Under review"
 *   - confirmed : finalized                           -> green "Confirmed"
 * Byes return null - the bye slot already reads "Bye - advances".
 */
function publicMatchStatus(
  status: Match['status'],
): { label: string; tone: string; icon: 'check' | 'hourglass' | 'alert' | 'clock' } | null {
  switch (status) {
    case 'confirmed':
      return { label: 'Confirmed', tone: '#22c55e', icon: 'check' }
    case 'disputed':
      return { label: 'Under review', tone: '#f59e0b', icon: 'alert' }
    case 'reported':
      return { label: 'Awaiting confirmation', tone: '#eab308', icon: 'hourglass' }
    case 'bye':
      return null
    default:
      return { label: 'Awaiting match', tone: 'var(--text-muted)', icon: 'clock' }
  }
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
  // Only show a winner once the match is actually finalized. A single-sided
  // "reported" match carries a PROVISIONAL winnerId that must not be surfaced
  // as a decided result on the public bracket.
  const decided = match.status === 'confirmed' || match.status === 'bye'
  const winnerId = decided ? match.winnerId : null
  const pub = publicMatchStatus(match.status)

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
      {pub && (
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-bold uppercase tracking-widest"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', color: pub.tone }}
        >
          {pub.icon === 'check' ? (
            <Check size={11} strokeWidth={3} style={{ flexShrink: 0 }} />
          ) : pub.icon === 'alert' ? (
            <AlertTriangle size={11} style={{ flexShrink: 0 }} />
          ) : pub.icon === 'clock' ? (
            <Clock size={11} style={{ flexShrink: 0 }} />
          ) : (
            <Hourglass size={11} style={{ flexShrink: 0 }} />
          )}
          {pub.label}
        </div>
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
      className="flex min-w-0 items-center gap-2 overflow-hidden rounded-md px-2.5 py-2 text-sm"
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
