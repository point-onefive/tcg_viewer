'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import dynamic from 'next/dynamic'
import { AnimatePresence, motion } from 'motion/react'
import { Bookmark, Layers } from 'lucide-react'
import { Card } from '@/lib/types'
import { useStore } from '@/lib/store'
import { filterAndBuildWall } from '@/lib/card-filter'
import { isErrataCode } from '@/lib/cards-one-piece-errata'

// PricePanel pulls in @/lib/pricing (which lazy-loads the pricing JSON
// bundle on demand) AND the recharts sparkline. Static-importing it here
// would land both in the home-route chunk for every visitor, even the
// 99% who never open a card. Lazy-import keeps it cold until the user
// actually opens the lightbox. ssr:false because the lightbox is a
// client-only overlay (driven by zustand store flags); SSRing it adds
// nothing the client doesn't already render after hydration.
const PricePanel = dynamic(
  () => import('./price-panel').then((m) => m.PricePanel),
  { ssr: false },
)

// How many neighbouring variants on each side of the active one are
// actually loaded as <Image>s. Cards in our dataset can have up to 11
// variants (OP01-016, OP05-062, anniversary boxes…) and mounting every
// one at 460px wide simultaneously fires up to 11 parallel optimizer
// requests; most for cards that are off the rendered fan or barely
// visible behind it. ±2 keeps the fan animation looking the same (we
// already fade anything beyond ±3 to 0 opacity) while halving network
// pressure on big-variant cards.
// Load images for cards within ±N steps of focus. We render the
// entire fan (all variants) so the user sees what's available, but
// the heavy <Image fill> mounts only happen inside this window;
// distant variants render a translucent rounded placeholder. ±4
// covers the typical fan visible area at the current stage scale
// without firing 11 parallel optimizer requests on big-variant cards.
const LIGHTBOX_LOAD_WINDOW = 4

interface LightboxViewerProps { cards: Card[] }

export function LightboxViewer({ cards }: LightboxViewerProps) {
  const {
    lightboxCardId,
    closeLightbox,
    openLightbox,
    togglePin,
    isPinned,
    toggleTierPool,
    isInTierPool,
    activeSet,
    activeRarity,
    activeColor,
    activeCardType,
    onlyAltArt,
    onlyErrata,
    flattenWall,
    searchQuery,
    lightboxPrintId,
    language,
    activeCollection,
  } = useStore()
  const [focused, setFocused] = useState(0)
  const [errataInfoOpen, setErrataInfoOpen] = useState(false)

  // Mirror CardGrid's filter so arrow-key navigation stays inside
  // the user's filter scope. Without this the lightbox walked the
  // entire JSON bundle - opening the first "Leader" then hitting
  // ArrowRight jumped to a non-Leader, which read as a bug because
  // the wall behind the lightbox only showed leaders.
  const { filtered: filteredCards, entries: wallEntries } = useMemo(
    () =>
      filterAndBuildWall(cards, {
        activeSet,
        activeRarity,
        activeColor,
        activeCardType,
        onlyAltArt,
        onlyErrata,
        searchQuery,
        flatten: flattenWall,
        language,
      }),
    [cards, activeSet, activeRarity, activeColor, activeCardType, onlyAltArt, onlyErrata, searchQuery, flattenWall, language],
  )

  // Card lookup uses the *unfiltered* pool on purpose: if the user
  // opens a card and then narrows the filter so it would be excluded
  // (e.g. opens Luffy, then switches Card type to "Event"), we want
  // the lightbox to keep rendering Luffy rather than vanishing
  // mid-view. Navigation will still operate on the filtered list -
  // see `navIndex` below.
  const card = useMemo(
    () => cards.find((c) => c.id === lightboxCardId) ?? null,
    [cards, lightboxCardId],
  )

  const cardNavIndex = useMemo(
    () => filteredCards.findIndex((c) => c.id === lightboxCardId),
    [filteredCards, lightboxCardId],
  )

  const wallNavIndex = useMemo(() => {
    if (!lightboxCardId || !lightboxPrintId) return -1
    return wallEntries.findIndex(
      (e) => e.card.id === lightboxCardId && e.printId === lightboxPrintId,
    )
  }, [wallEntries, lightboxCardId, lightboxPrintId])

  const navIndex = flattenWall ? wallNavIndex : cardNavIndex
  const navTotal = flattenWall ? wallEntries.length : filteredCards.length

  // Full list of images: base first, then alternates.
  //
  // We also carry per-print `distribution` (e.g. "Premium Card
  // Collection · Promo") and `stamp` (winner / event / champion /
  // pre-release / pack) so the bottom info bar can render a small
  // print-specific subtitle when the user focuses a variant. This
  // matters most for prints that LOOK identical to another at
  // thumbnail size; the differentiator is often a holographic
  // treatment or a Winner-stamp overlay rather than the artwork
  // itself, and showing the distribution context tells the user
  // "this isn't a duplicate of the base; it's the tournament-prize
  // version with the same art."
  const images = useMemo(() => {
    if (!card) return []
    const base = {
      id: card.id,
      src: card.imageLarge || card.imageSmall,
      label: 'base',
      distribution: card.distribution,
      stamp: null as string | null,
    }
    const variants = (card.variants ?? []).map((v) => ({
      id: v.id,
      src: v.imageUrl,
      label: v.label,
      distribution: v.distribution,
      stamp: v.stamp ?? null,
    }))
    return [base, ...variants]
  }, [card])

  const hasMultiple = images.length > 1

  // Reset focused variant when the open card changes. Uses React's
  // "adjust state during render" pattern (not a useEffect) so the
  // reset is synchronous - the first render after a card change
  // already uses focused=0. With the old useEffect-based reset the
  // first render still ran with the *previous* card's focused value;
  // if that was >= the new card's images.length (e.g. switching from
  // a 7-variant Nami to a 1-variant Nami while focused=3), the
  // unguarded `images[focused].id` access below crashed the whole
  // page. See https://react.dev/learn/you-might-not-need-an-effect
  // ("Adjusting state when a prop changes").
  const [prevLightboxOpen, setPrevLightboxOpen] = useState({
    cardId: lightboxCardId,
    printId: lightboxPrintId,
  })
  if (
    prevLightboxOpen.cardId !== lightboxCardId ||
    prevLightboxOpen.printId !== lightboxPrintId
  ) {
    setPrevLightboxOpen({ cardId: lightboxCardId, printId: lightboxPrintId })
    if (lightboxPrintId && card) {
      const idx = images.findIndex((img) => img.id === lightboxPrintId)
      setFocused(idx >= 0 ? idx : 0)
    } else {
      setFocused(0)
    }
    setErrataInfoOpen(false)
  }

  // Belt-and-suspenders clamp. The during-render reset above already
  // guarantees focused is 0 the moment a card change is observed,
  // but variant-stepping (wheel / swipe / Arrow up-down / clicking a
  // variant in the fan) could still race ahead of an in-flight card
  // change in theory. A clamp is essentially free and makes the
  // whole block crash-proof regardless of how state gets in.
  const safeFocused = images.length > 0 ? Math.min(focused, images.length - 1) : 0

  const stepVariant = useCallback((delta: number) => {
    setFocused((f) => {
      const next = f + delta
      if (next < 0 || next > images.length - 1) return f
      return next
    })
  }, [images.length])

  // Wheel / trackpad navigation through variants.
  // Accumulate delta with a cooldown so a single trackpad swipe = one step.
  // Attached via native listener so we can call preventDefault (React wheel is passive).
  const stageRef = useRef<HTMLDivElement>(null)
  const wheelAccum = useRef(0)
  const wheelCooldown = useRef(false)
  useEffect(() => {
    if (!lightboxCardId || !hasMultiple) return
    const el = stageRef.current
    if (!el) return
    const handler = (e: WheelEvent) => {
      e.preventDefault()
      if (wheelCooldown.current) return
      const raw = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
      wheelAccum.current += raw
      const THRESHOLD = 40
      if (Math.abs(wheelAccum.current) >= THRESHOLD) {
        stepVariant(wheelAccum.current > 0 ? 1 : -1)
        wheelAccum.current = 0
        wheelCooldown.current = true
        setTimeout(() => { wheelCooldown.current = false }, 220)
      }
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [lightboxCardId, hasMultiple, stepVariant])

  // Touch swipe navigation (mobile).
  const touchStartX = useRef<number | null>(null)
  const touchStartY = useRef<number | null>(null)
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    touchStartY.current = e.touches[0].clientY
  }
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null || touchStartY.current == null) return
    const dx = e.changedTouches[0].clientX - touchStartX.current
    const dy = e.changedTouches[0].clientY - touchStartY.current
    touchStartX.current = null
    touchStartY.current = null
    const THRESHOLD = 40
    // Horizontal swipe wins over vertical
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > THRESHOLD) {
      if (hasMultiple) stepVariant(dx < 0 ? 1 : -1)
    } else if (Math.abs(dy) > THRESHOLD) {
      if (hasMultiple) stepVariant(dy < 0 ? 1 : -1)
    }
  }

  const goNext = useCallback(() => {
    if (navIndex < 0) return
    if (flattenWall) {
      if (navIndex < wallEntries.length - 1) {
        const next = wallEntries[navIndex + 1]
        openLightbox(next.card.id, next.printId)
      }
      return
    }
    if (navIndex < filteredCards.length - 1) {
      openLightbox(filteredCards[navIndex + 1].id)
    }
  }, [navIndex, flattenWall, wallEntries, filteredCards, openLightbox])

  const goPrev = useCallback(() => {
    if (navIndex <= 0) return
    if (flattenWall) {
      const prev = wallEntries[navIndex - 1]
      openLightbox(prev.card.id, prev.printId)
      return
    }
    openLightbox(filteredCards[navIndex - 1].id)
  }, [navIndex, flattenWall, wallEntries, filteredCards, openLightbox])

  useEffect(() => {
    if (!lightboxCardId) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeLightbox()
      if (e.key === 'ArrowRight') goNext()
      if (e.key === 'ArrowLeft') goPrev()
      if (e.key === 'ArrowDown') { e.preventDefault(); stepVariant(1) }
      if (e.key === 'ArrowUp') { e.preventDefault(); stepVariant(-1) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [lightboxCardId, closeLightbox, goNext, goPrev, stepVariant])

  useEffect(() => {
    document.body.style.overflow = lightboxCardId ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [lightboxCardId])

  return (
    <AnimatePresence>
      {card && (
        <motion.div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={closeLightbox}
          ref={stageRef}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {/* Backdrop · theme-aware gradient with subtle vignette */}
          <div
            className="absolute inset-0"
            style={{
              background: 'radial-gradient(ellipse at 50% 40%, var(--lb-backdrop-1) 0%, var(--lb-backdrop-2) 100%)',
              backdropFilter: 'blur(32px) saturate(120%)',
              WebkitBackdropFilter: 'blur(32px) saturate(120%)',
            }}
          />
          {/* Subtle noise/grain overlay */}
          <div
            className="absolute inset-0 pointer-events-none"
            style={{
              background: 'url("data:image/svg+xml,%3Csvg viewBox=\'0 0 200 200\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cfilter id=\'n\'%3E%3CfeTurbulence type=\'fractalNoise\' baseFrequency=\'0.75\' numOctaves=\'4\' stitchTiles=\'stitch\'/%3E%3C/filter%3E%3Crect width=\'100%25\' height=\'100%25\' filter=\'url(%23n)\' opacity=\'0.04\'/%3E%3C/svg%3E")',
              opacity: 0.6,
            }}
          />

          {/* Top HUD: counter left, pin+close right */}
          <div
            className="absolute top-0 left-0 right-0 z-20 flex items-center justify-between px-4 md:px-6"
            style={{ height: 60, pointerEvents: 'none' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Counter */}
            <div
              className="inline-flex items-center gap-1.5 px-3 text-xs font-medium tabular-nums"
              style={{
                pointerEvents: 'none',
                color: 'var(--lb-fg-muted)',
                letterSpacing: '0.08em',
              }}
            >
              {navIndex >= 0 ? navIndex + 1 : '-'}{' '}
              <span style={{ opacity: 0.4 }}>/</span> {navTotal}
            </div>

            {/* Pin + Tier + Close group · rounded-rect matching nav language */}
            <div className="flex items-center gap-2" style={{ pointerEvents: 'auto' }}>
              {card && (() => {
                const img = images[safeFocused]
                if (!img) return null
                const pinArg = safeFocused === 0
                  ? { cardId: card.id }
                  : { cardId: card.id, variantId: img.id }
                const pinned = isPinned(pinArg)
                // Tier-pool entry: keyed by the focused image id (base or variant).
                const poolItem = {
                  id: img.id,
                  src: img.src,
                  label: `${card.name}${img.label && img.label !== 'base' ? ` · ${img.label}` : ''}`,
                }
                const inPool = isInTierPool(img.id)
                return (
                  <>
                    <button
                      className={`lb-hud-btn${pinned ? ' lb-hud-btn--active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); togglePin(pinArg) }}
                      aria-label={pinned ? 'Remove from board' : 'Pin to board'}
                      aria-pressed={pinned}
                    >
                      <Bookmark size={13} strokeWidth={2} fill={pinned ? 'currentColor' : 'none'} />
                      <span className="hidden sm:inline">{pinned ? 'Pinned' : 'Pin'}</span>
                    </button>
                    <button
                      className={`lb-hud-btn${inPool ? ' lb-hud-btn--active' : ''}`}
                      onClick={(e) => { e.stopPropagation(); toggleTierPool(poolItem) }}
                      aria-label={inPool ? 'Remove from tier list pool' : 'Add to tier list pool'}
                      aria-pressed={inPool}
                      title={inPool ? 'Queued for tier list · click to remove' : 'Add to tier list pool'}
                    >
                      <Layers size={13} strokeWidth={2} fill={inPool ? 'currentColor' : 'none'} />
                      <span className="hidden sm:inline">{inPool ? 'In tier list' : 'Tier list'}</span>
                    </button>
                  </>
                )
              })()}
              <button
                className="lb-hud-btn"
                onClick={(e) => { e.stopPropagation(); closeLightbox() }}
                aria-label="Close"
              >
                <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <line x1="2" y1="2" x2="12" y2="12" />
                  <line x1="12" y1="2" x2="2" y2="12" />
                </svg>
                <span className="hidden sm:inline">Close</span>
              </button>
            </div>
          </div>

          {/* Card stage · centered, no side arrows so fan can never be obscured. */}
          <div
            className="relative z-10 flex items-center justify-center w-full"
            style={{ flex: 1, minHeight: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Cards fan */}
            <div className="lb-stage">
              {images.map((img, i) => {
                const offset = i - safeFocused
                const absOffset = Math.abs(offset)
                const isActive = i === safeFocused
                // Visibility band: every variant renders in the fan
                // (no hard cutoff) so the user sees the full carousel.
                // Loading band: only variants within
                // LIGHTBOX_LOAD_WINDOW (=4) actually mount the heavy
                // <Image> tag; anything farther shows the rounded
                // placeholder so we don't fire 11 parallel optimizer
                // requests on big-variant cards.
                const isInLoadWindow = absOffset <= LIGHTBOX_LOAD_WINDOW
                return (
                  <motion.div
                    key={img.id}
                    className="lb-card"
                    onClick={() => setFocused(i)}
                    initial={{ opacity: 0, scale: 0.85, y: 30 }}
                    animate={{
                      // No hard cutoff; render every variant in the
                      // fan so the user sees the full carousel. The
                      // fade is gentler (0.09 per step) and clamps at
                      // 0.2 so even ten-variant cards stay visible
                      // without going invisible.
                      opacity: Math.max(0.2, 1 - absOffset * 0.09),
                      // Tighter scale falloff (0.04 per step, floor 0.55)
                      // so distant cards still read as cards rather than
                      // shrinking to dots.
                      scale: isActive ? 1 : Math.max(0.55, 0.82 - absOffset * 0.04),
                      x: offset * 180,
                      rotate: offset * 4,
                      zIndex: 20 - absOffset,
                    }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 26, mass: 0.8 }}
                    style={{
                      cursor: isActive ? 'default' : 'pointer',
                    }}
                  >
                    {isInLoadWindow ? (
                      <Image
                        src={img.src}
                        alt={img.label}
                        fill
                        sizes="(max-width: 640px) 80vw, (max-width: 1024px) 55vw, 460px"
                        className="object-cover rounded-xl"
                        priority={isActive}
                      />
                    ) : (
                      // Distant variants render only the rounded card-
                      // shape placeholder so the fan keeps its visual
                      // depth without triggering a network request.
                      // The fan animation fades them to 0 opacity at
                      // absOffset > 3 anyway, and step-navigation moves
                      // them into the load window before they ever
                      // become readable.
                      <div
                        className="absolute inset-0 rounded-xl"
                        style={{
                          background:
                            'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))',
                          border: '1px solid rgba(255,255,255,0.06)',
                        }}
                        aria-hidden
                      />
                    )}
                  </motion.div>
                )
              })}
            </div>
          </div>

          {/* Bottom info bar
              ----------------
              Tight vertical rhythm so the entire block reads as a
              single caption unit anchored to the card above. The
              card face already conveys name / rarity / card-type /
              set-index, so the caption is reduced to just the
              set-context line (distribution string, e.g.
              "-ROMANCE DAWN- [OP01]" or "English Version 1st
              Anniversary Set") flanked by prev/next nav arrows,
              optionally with errata + stamp pills, plus the variant
              dots and the pricing strip below.

              `minHeight` reserves the worst-case bar height so the
              card above never shifts vertically when the user
              navigates between simple/multi-print/errata/low-confidence
              variants; the bar's blank space absorbs the difference. */}
          <div
            className="lb-bottom-bar relative z-20 w-full flex flex-col items-center justify-start gap-2 pb-6 pt-2"
            onClick={(e) => e.stopPropagation()}
            style={{ flexShrink: 0 }}
          >
            {/* Set-context row · prev arrow ←─────── distribution ───────→ next arrow.
                Arrows anchor to the LEFT / RIGHT edges of the lightbox
                shell (justify-between) so they never crowd the set text
                in the middle. Set text takes the central flex-1 slot
                with truncation so very-long distribution strings don't
                push arrows off-screen. When the focused print has no
                distribution / stamp / errata data we still render a
                fixed-height spacer so the arrow buttons don't jump as
                the user cycles variants. */}
            <div className="flex items-center justify-between gap-3 md:gap-4 w-full px-6 md:px-10">
              <button
                className="lb-arrow"
                onClick={(e) => { e.stopPropagation(); goPrev() }}
                disabled={navIndex <= 0}
                aria-label="Previous card"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="13 4 7 10 13 16" />
                </svg>
              </button>

              {(() => {
                const img = images[safeFocused]
                // card.id is the canonical card code on base entries
                // (e.g. "OP01-016"); the errata list is keyed on the
                // same canonical codes. Errata applies to the card's
                // effect text and therefore covers every variant of
                // the same code (parallel, alt-art, manga, ...).
                const erratata = isErrataCode(card.id)
                const hasMeta =
                  Boolean(img?.distribution) || Boolean(img?.stamp) || erratata
                const STAMP_LABEL: Record<string, string> = {
                  winner: 'Winner',
                  event: 'Event',
                  champion: 'Champion',
                  'pre-release': 'Pre-release',
                  pack: 'Pack',
                }
                const stampLabel = img?.stamp
                  ? (STAMP_LABEL[img.stamp] ?? img.stamp)
                  : null
                if (!hasMeta) {
                  // Keep a stable 36px row even when the focused
                  // print has no caption text - matches the arrow
                  // button height so the row never collapses.
                  return (
                    <div
                      style={{
                        minHeight: 36,
                        minWidth: 0,
                        flex: '1 1 0',
                      }}
                    />
                  )
                }
                return (
                  <div
                    className="flex items-center justify-center gap-2 text-sm truncate text-center"
                    style={{
                      color: 'var(--lb-fg-muted)',
                      opacity: 0.95,
                      maxWidth: 'min(70vw, 520px)',
                      minWidth: 0,
                      flex: '1 1 0',
                      minHeight: 36,
                    }}
                  >
                    {stampLabel && (
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                        style={{
                          borderRadius: 3,
                          background:
                            'color-mix(in srgb, #E85D2A 18%, transparent)',
                          color: '#E85D2A',
                          letterSpacing: '0.08em',
                          flexShrink: 0,
                        }}
                        title={`${stampLabel} stamp print`}
                      >
                        {stampLabel}
                      </span>
                    )}
                    {erratata && (
                      <span className="lb-errata-anchor">
                        <button
                          type="button"
                          className="lb-errata-pill"
                          onClick={(e) => {
                            e.stopPropagation()
                            setErrataInfoOpen((v) => !v)
                          }}
                          aria-expanded={errataInfoOpen}
                          aria-label="About errata cards"
                          title="Click for details"
                        >
                          Errata
                        </button>
                        {errataInfoOpen && (
                          <div
                            role="dialog"
                            aria-label="Errata explanation"
                            className="lb-errata-popover"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <div className="lb-errata-popover__title">
                              Two distinct printings exist for this card
                            </div>
                            <p>
                              Bandai re-issued this card with corrected text.
                              The original (pre-errata) and corrected
                              (post-errata) printings trade as separate
                              markets and can sell at very different prices.
                            </p>
                            <p>
                              Listing data does not cleanly separate the two
                              printings, so the price shown here is a blended
                              signal across both. Always research and verify
                              which printing you are buying or selling.
                            </p>
                            <a
                              href="https://en.onepiece-cardgame.com/rules/errata_card/"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Bandai&rsquo;s official errata reference
                            </a>
                            <button
                              type="button"
                              className="lb-errata-popover__close"
                              onClick={(e) => {
                                e.stopPropagation()
                                setErrataInfoOpen(false)
                              }}
                              aria-label="Close"
                            >
                              ×
                            </button>
                          </div>
                        )}
                      </span>
                    )}
                    {img?.distribution && (
                      <span className="truncate">{img.distribution}</span>
                    )}
                  </div>
                )
              })()}

              <button
                className="lb-arrow"
                onClick={(e) => { e.stopPropagation(); goNext() }}
                disabled={navIndex < 0 || navIndex >= navTotal - 1}
                aria-label="Next card"
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="7 4 13 10 7 16" />
                </svg>
              </button>
            </div>

            {/* Pricing strip · one horizontal bar that integrates into
                the bottom info column. Same component on every viewport
                . At narrow widths the cells stack vertically. Renders
                nothing when the focused print has no resolved market
                price, so unmatched variants don't pad the bottom bar. */}
            {(() => {
              const focusedId = images[safeFocused]?.id
              if (!focusedId) return null
              return <PricePanel wallCardId={focusedId} collection={activeCollection} />
            })()}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
