'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import { Bookmark } from 'lucide-react'
import { Card } from '@/lib/types'
import { useStore } from '@/lib/store'

interface LightboxViewerProps { cards: Card[] }

export function LightboxViewer({ cards }: LightboxViewerProps) {
  const { lightboxCardId, closeLightbox, openLightbox, togglePin, isPinned } = useStore()
  const [focused, setFocused] = useState(0)

  const currentIndex = useMemo(
    () => cards.findIndex((c) => c.id === lightboxCardId),
    [cards, lightboxCardId]
  )
  const card = currentIndex >= 0 ? cards[currentIndex] : null

  // Full list of images: base first, then alternates
  const images = useMemo(() => {
    if (!card) return []
    const base = { id: card.id, src: card.imageLarge || card.imageSmall, label: 'base' }
    const variants = (card.variants ?? []).map(v => ({ id: v.id, src: v.imageUrl, label: v.label }))
    return [base, ...variants]
  }, [card])

  const hasMultiple = images.length > 1

  // Reset focused variant when card changes
  useEffect(() => { setFocused(0) }, [lightboxCardId])

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
    if (currentIndex < cards.length - 1) openLightbox(cards[currentIndex + 1].id)
  }, [currentIndex, cards, openLightbox])

  const goPrev = useCallback(() => {
    if (currentIndex > 0) openLightbox(cards[currentIndex - 1].id)
  }, [currentIndex, cards, openLightbox])

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
              {currentIndex + 1} <span style={{ opacity: 0.4 }}>/</span> {cards.length}
            </div>

            {/* Pin + Close group · rounded-rect matching nav language */}
            <div className="flex items-center gap-2" style={{ pointerEvents: 'auto' }}>
              {card && (() => {
                const img = images[focused]
                const pinArg = focused === 0
                  ? { cardId: card.id }
                  : { cardId: card.id, variantId: img.id }
                const pinned = isPinned(pinArg)
                return (
                  <button
                    className={`lb-hud-btn${pinned ? ' lb-hud-btn--active' : ''}`}
                    onClick={(e) => { e.stopPropagation(); togglePin(pinArg) }}
                    aria-label={pinned ? 'Remove from board' : 'Pin to board'}
                    aria-pressed={pinned}
                  >
                    <Bookmark size={13} strokeWidth={2} fill={pinned ? 'currentColor' : 'none'} />
                    <span className="hidden sm:inline">{pinned ? 'Pinned' : 'Pin'}</span>
                  </button>
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
                const offset = i - focused
                const isActive = i === focused
                return (
                  <motion.div
                    key={img.id}
                    className="lb-card"
                    onClick={() => setFocused(i)}
                    initial={{ opacity: 0, scale: 0.85, y: 30 }}
                    animate={{
                      opacity: Math.abs(offset) > 3 ? 0 : 1 - Math.abs(offset) * 0.12,
                      scale: isActive ? 1 : 0.82 - Math.abs(offset) * 0.05,
                      x: offset * 180,
                      rotate: offset * 4,
                      zIndex: 20 - Math.abs(offset),
                    }}
                    exit={{ opacity: 0, scale: 0.9, y: 20 }}
                    transition={{ type: 'spring', stiffness: 200, damping: 26, mass: 0.8 }}
                    style={{
                      cursor: isActive ? 'default' : 'pointer',
                      pointerEvents: Math.abs(offset) > 3 ? 'none' : 'auto',
                    }}
                  >
                    <Image
                      src={img.src}
                      alt={img.label}
                      fill
                      sizes="(max-width: 640px) 80vw, (max-width: 1024px) 55vw, 460px"
                      className="object-cover rounded-xl"
                      priority={isActive}
                    />
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
                disabled={currentIndex <= 0}
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
              </div>

              <button
                className="lb-arrow"
                onClick={(e) => { e.stopPropagation(); goNext() }}
                disabled={currentIndex >= cards.length - 1}
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
                    className={`lb-dot${i === focused ? ' lb-dot--active' : ''}`}
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
