'use client'

import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  HelpCircle,
  Layers,
  LineChart,
  Menu,
  Package,
  Trophy,
  WalletCards,
  X,
} from 'lucide-react'
import { ThemeToggle } from './theme-toggle'
import { useStore } from '@/lib/store'
import { apiActiveStatus } from '@/lib/tournament/client'

const EASE = [0.22, 1, 0.36, 1] as const

/**
 * Polls the active-tournament status so the hamburger (and the
 * Tournaments row inside the sheet) can show a "live" cue. Mirrors the
 * hook the gallery header uses - kept self-contained here so any page
 * can render the shared nav without dragging in the whole gallery
 * header module.
 */
function useTournamentLive(): boolean {
  const [live, setLive] = useState(false)
  useEffect(() => {
    let cancelled = false
    const check = async () => {
      try {
        const { live: isLive } = await apiActiveStatus()
        if (!cancelled) setLive(isLive)
      } catch {
        // Status endpoint can 503 when Supabase env is unset; treat as
        // "not live" rather than surfacing an error in the nav.
      }
    }
    check()
    const t = window.setInterval(check, 60_000)
    const onFocus = () => check()
    window.addEventListener('focus', onFocus)
    return () => {
      cancelled = true
      clearInterval(t)
      window.removeEventListener('focus', onFocus)
    }
  }, [])
  return live
}

function LiveDot() {
  return (
    <span
      aria-hidden
      className="live-dot absolute rounded-full"
      style={{ top: -3, right: -3, width: 9, height: 9, background: '#ef4444', boxShadow: '0 0 0 2px var(--bg)' }}
    />
  )
}

function LivePill() {
  return (
    <span
      className="inline-flex items-center gap-1 text-[9px] font-bold uppercase leading-none"
      style={{ padding: '2px 5px', borderRadius: 4, background: '#ef4444', color: '#fff', letterSpacing: '0.08em' }}
    >
      <span aria-hidden className="live-dot rounded-full" style={{ width: 5, height: 5, background: '#fff' }} />
      Live
    </span>
  )
}

const ctrl: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid color-mix(in srgb, var(--text-primary) 14%, transparent)',
  borderRadius: 6,
}

const ctrlActive: React.CSSProperties = {
  ...ctrl,
  border: '1px solid color-mix(in srgb, #E85D2A 55%, transparent)',
  boxShadow: '0 0 0 1px color-mix(in srgb, #E85D2A 22%, transparent) inset',
}

/**
 * Shared mobile/site navigation: the theme toggle + hamburger trigger
 * plus the drop-down sheet that lists every destination on the site.
 * Drop this into the right side of any page's top bar so the whole app
 * shares one uniform "logo · theme · menu" header and every page can
 * reach every other page.
 *
 * One-Piece-only destinations (Booster Boxes, Tournaments) follow the
 * same rule as the gallery: they only appear while the active
 * collection (persisted in the store) is One Piece.
 *
 * `topOffset` is where the sheet's top edge sits (it's fixed-positioned
 * so it overlays page content). Pass the host top bar's height.
 */
export function SiteNavMenu({
  topOffset = 56,
  showTheme = true,
}: {
  topOffset?: number
  /**
   * Whether to render the theme toggle alongside the hamburger. Pages
   * that already host their own theme toggle (e.g. the tournament shell)
   * pass `false` so we add navigation without duplicating the control.
   */
  showTheme?: boolean
}) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  // The sheet is fixed-positioned, so we anchor its top edge to the
  // live bottom of the hamburger trigger. That keeps it glued under the
  // top bar on every page regardless of how tall that page's sticky
  // header is (sealed has two rows; the tool pages have one).
  const [sheetTop, setSheetTop] = useState(topOffset)
  // Right offset (px from the viewport's right edge) so the sheet drops
  // straight down under the hamburger trigger instead of centering on the
  // page. On mobile the trigger sits near the right edge, so a small right
  // offset still reads as a near-full-width sheet.
  const [sheetRight, setSheetRight] = useState(0)
  const pathname = usePathname()
  const activeCollection = useStore((s) => s.activeCollection)
  const tierPool = useStore((s) => s.tierPool)
  const tierPoolCount = tierPool.length
  const isOnePiece = activeCollection === 'one-piece'
  const tournamentLive = useTournamentLive()

  // Close the sheet whenever the route changes so a tapped link never
  // leaves a stale open menu behind on the next page.
  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Lock body scroll while the sheet is open so the page behind doesn't
  // scroll under the overlay, and keep the sheet pinned just below the
  // trigger as the viewport changes.
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const measure = () => {
      const r = triggerRef.current?.getBoundingClientRect()
      if (r) {
        setSheetTop(Math.round(r.bottom + 6))
        setSheetRight(Math.round(window.innerWidth - r.right))
      }
    }
    measure()
    window.addEventListener('resize', measure)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('resize', measure)
    }
  }, [open])

  const rowStyle = (href: string): React.CSSProperties =>
    pathname === href ? { ...ctrlActive } : { ...ctrl }

  const rowClass =
    'footer-btn inline-flex items-center justify-center gap-2 px-3 py-2.5 text-sm font-medium'

  return (
    <>
      <div className="flex shrink-0 items-center gap-1.5">
        {showTheme && <ThemeToggle />}
        <button
          ref={triggerRef}
          type="button"
          className={`footer-btn relative inline-flex items-center justify-center${tournamentLive && !open ? ' tournament-live-breathe' : ''}`}
          style={{ ...ctrl, width: 36, height: 36 }}
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? 'Close menu' : tournamentLive ? 'Open menu (tournament live now)' : 'Open menu'}
          aria-expanded={open}
          aria-controls="site-nav-menu"
        >
          {open ? <X size={16} /> : <Menu size={16} />}
          {tournamentLive && !open && <LiveDot />}
        </button>
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            key="site-nav-backdrop"
            className="fixed inset-0"
            style={{ zIndex: 55, background: 'color-mix(in srgb, var(--bg) 55%, transparent)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: EASE }}
            onClick={() => setOpen(false)}
            aria-hidden
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="site-nav-menu"
            id="site-nav-menu"
            role="menu"
            aria-label="Site menu"
            className="fixed flex flex-col gap-2.5 overflow-y-auto px-4 pb-4 pt-3"
            style={{
              top: sheetTop,
              right: sheetRight,
              zIndex: 56,
              maxWidth: 'min(520px, calc(100vw - 16px))',
              maxHeight: `calc(100dvh - ${sheetTop}px)`,
              background: 'var(--bg-surface)',
              borderBottom: '1px solid var(--border-subtle)',
              borderLeft: '1px solid var(--border-subtle)',
              borderRight: '1px solid var(--border-subtle)',
              borderBottomLeftRadius: 16,
              borderBottomRightRadius: 16,
              boxShadow: 'var(--shadow-card)',
            }}
            initial={{ opacity: 0, y: -12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -12 }}
            transition={{ duration: 0.2, ease: EASE }}
          >
            {isOnePiece && (
              <Link
                href="/tournaments"
                onClick={() => setOpen(false)}
                className={`${rowClass}${tournamentLive ? ' tournament-live-breathe' : ''}`}
                style={rowStyle('/tournaments')}
                aria-label={tournamentLive ? 'Tournaments (live now)' : 'Tournaments'}
              >
                <Trophy size={16} strokeWidth={2.25} aria-hidden />
                <span>Tournaments</span>
                {tournamentLive && <LivePill />}
              </Link>
            )}

            {isOnePiece && (
              <Link href="/sealed" onClick={() => setOpen(false)} className={rowClass} style={rowStyle('/sealed')} aria-label="Booster box dashboard">
                <Package size={16} strokeWidth={2.25} aria-hidden />
                <span>Booster Boxes</span>
              </Link>
            )}

            <Link href="/deck-builder" onClick={() => setOpen(false)} className={rowClass} style={rowStyle('/deck-builder')} aria-label="Deck builder">
              <WalletCards size={16} strokeWidth={2.25} aria-hidden />
              <span>Deck Builder</span>
            </Link>

            <Link
              href="/tier-list"
              onClick={() => setOpen(false)}
              className={rowClass}
              style={rowStyle('/tier-list')}
              aria-label={tierPoolCount > 0 ? `Tier list maker (${tierPoolCount} queued)` : 'Tier list maker'}
            >
              <Layers size={16} strokeWidth={2.25} aria-hidden fill={tierPoolCount > 0 ? 'currentColor' : 'none'} />
              <span>Tier List Maker</span>
              {tierPoolCount > 0 && (
                <span
                  className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
                  style={{ minWidth: 18, height: 18, padding: '0 5px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
                >
                  {tierPoolCount}
                </span>
              )}
            </Link>

            <Link href="/chart-race" onClick={() => setOpen(false)} className={rowClass} style={rowStyle('/chart-race')} aria-label="Chart Race maker">
              <LineChart size={16} strokeWidth={2.25} aria-hidden />
              <span>Chart Race Maker</span>
            </Link>

            <Link href="/help" onClick={() => setOpen(false)} className={rowClass} style={rowStyle('/help')} aria-label="How it works">
              <HelpCircle size={14} strokeWidth={2.25} aria-hidden />
              <span>How it works</span>
            </Link>

            <a
              href="https://x.com/point_onefive"
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={rowClass}
              style={{ ...ctrl }}
              aria-label="Feedback on X (@point_onefive)"
            >
              <svg width="12" height="12" viewBox="0 0 1200 1227" fill="currentColor" aria-hidden>
                <path d="M714.2 519.3 1160.9 0H1055L667.1 450.9 357.3 0H0l468.5 681.8L0 1226.4h105.9L515.5 750.2l327.3 476.2H1200L714.2 519.3Zm-145 168.5-47.5-67.9L144 79.7h162.6l305 436.2 47.5 67.9 395.9 566.3H892.4L569.2 687.8Z" />
              </svg>
              <span>Feedback (@point_onefive)</span>
            </a>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
