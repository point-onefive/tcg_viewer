'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import { Bookmark, Layers } from 'lucide-react'
import { Card } from '@/lib/types'
import { useStore } from '@/lib/store'
import { filterAndBuildWall } from '@/lib/card-filter'

// How many neighbouring variants on each side of the active one are
// actually loaded as <Image>s. Cards in our dataset can have up to 11
// variants (OP01-016, OP05-062, anniversary boxes…) and mounting every
// one at 460px wide simultaneously fires up to 11 parallel optimizer
// requests — most for cards that are off the rendered fan or barely
// visible behind it. ±2 keeps the fan animation looking the same (we
// already fade anything beyond ±3 to 0 opacity) while halving network
// pressure on big-variant cards.
const LIGHTBOX_LOAD_WINDOW = 2

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
  } = useStore()
  const [focused, setFocused] = useState(0)

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
  // thumbnail size — the differentiator is often a holographic
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
              {navIndex >= 0 ? navIndex + 1 : '—'}{' '}
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

          {/* Card stage · centered, no side arrows so fan can never be obscured */}
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
                // Visibility band: cards beyond ±3 are fully faded out
                // and non-interactive anyway. Loading band: we go one
                // tighter (LIGHTBOX_LOAD_WINDOW = 2) so anything two
                // steps from the focus is already cached the moment
                // the user steps the fan, but distant variants don't
                // race the active one for bandwidth.
                const isInLoadWindow = absOffset <= LIGHTBOX_LOAD_WINDOW
                return (
                  <motion.div
                    key={img.id}
                    className="lb-card"
                    onClick={() => setFocused(i)}
                    initial={{ opacity: 0, scale: 0.85, y: 30 }}
                    animate={{
                      opacity: absOffset > 3 ? 0 : 1 - absOffset * 0.12,
                      scale: isActive ? 1 : 0.82 - absOffset * 0.05,
                      x: offset * 180,
                      rotate: offset * 4,
                      zIndex: 20 - absOffset,
                    }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 26, mass: 0.8 }}
                    style={{
                      cursor: isActive ? 'default' : 'pointer',
                      pointerEvents: absOffset > 3 ? 'none' : 'auto',
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
                    {/* Variant label */}
                    {hasMultiple && (
                      <div className="lb-card__label">
                        {img.label === 'base' ? 'Base' : img.label.toUpperCase()}
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </div>
          </div>

          {/* Bottom info bar */}
          <div
            className="relative z-20 w-full flex flex-col items-center gap-3 pb-6 pt-3"
            onClick={(e) => e.stopPropagation()}
            style={{ flexShrink: 0 }}
          >
            {/* Card name row with prev/next arrows flanking · never overlaps the fan */}
            <div className="flex items-center justify-center gap-3 md:gap-4 w-full px-4">
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

              <div className="flex flex-col items-center gap-1 text-center" style={{ minWidth: 0, flex: '0 1 auto' }}>
                <span
                  className="font-bold tracking-tight leading-tight truncate"
                  style={{ color: 'var(--lb-fg)', fontFamily: 'var(--font-display)', fontSize: 'clamp(16px, 3vw, 22px)', maxWidth: 'min(70vw, 520px)' }}
                >
                  {card.name}
                </span>
                <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--lb-fg-muted)' }}>
                  {card.setCode && <span>{card.setCode}</span>}
                  {card.rarity && <><span style={{ opacity: 0.3 }}>·</span><span>{card.rarity}</span></>}
                  {card.cardType && <><span style={{ opacity: 0.3 }}>·</span><span>{card.cardType}</span></>}
                </div>
                {/* Print-level subtitle: shows the focused variant's
                    distribution context (e.g. "Premium Card Collection",
                    "Promo · Winner-stamped") so visually-similar prints
                    aren't mistaken for duplicates. The pipeline already
                    merges near-duplicate variants by image filename
                    (see card-filter.ts `dedupeVariants`) and folds
                    their distribution strings together with " · "
                    separators, so a single surviving print can read
                    "Premium Card Collection -Best Selection- · 2024
                    Anniversary Promo". A stamp icon appears alongside
                    for tournament-prize / event prints whose artwork
                    is otherwise indistinguishable from the base. The
                    row stays hidden for the base card when it has no
                    distribution metadata of its own — empty space is
                    better than empty padding. */}
                {(() => {
                  const img = images[safeFocused]
                  if (!img) return null
                  const hasMeta = Boolean(img.distribution) || Boolean(img.stamp)
                  if (!hasMeta) return null
                  const STAMP_LABEL: Record<string, string> = {
                    winner: 'Winner',
                    event: 'Event',
                    champion: 'Champion',
                    'pre-release': 'Pre-release',
                    pack: 'Pack',
                  }
                  const stampLabel = img.stamp ? (STAMP_LABEL[img.stamp] ?? img.stamp) : null
                  return (
                    <div
                      className="flex items-center gap-2 text-[11px] truncate"
                      style={{
                        color: 'var(--lb-fg-muted)',
                        opacity: 0.85,
                        maxWidth: 'min(70vw, 520px)',
                      }}
                    >
                      {stampLabel && (
                        <span
                          className="inline-flex items-center px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider"
                          style={{
                            borderRadius: 3,
                            background: 'color-mix(in srgb, #E85D2A 18%, transparent)',
                            color: '#E85D2A',
                            letterSpacing: '0.08em',
                            flexShrink: 0,
                          }}
                          title={`${stampLabel} stamp print`}
                        >
                          {stampLabel}
                        </span>
                      )}
                      {img.distribution && (
                        <span className="truncate">{img.distribution}</span>
                      )}
                    </div>
                  )
                })()}
              </div>

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

            {/* Variant dots */}
            {hasMultiple && (
              <div className="lb-dots">
                {images.map((img, i) => (
                  <button
                    key={img.id}
                    className={`lb-dot${i === safeFocused ? ' lb-dot--active' : ''}`}
                    onClick={() => setFocused(i)}
                    aria-label={`View ${img.label}`}
                  />
                ))}
              </div>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
