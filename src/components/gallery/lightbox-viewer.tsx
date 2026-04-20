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
          className="fixed inset-0 z-[100] flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={closeLightbox}
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0"
            style={{ background: 'rgba(0,0,0,0.92)', backdropFilter: 'blur(28px)', WebkitBackdropFilter: 'blur(28px)' }}
          />

          {/* Stage - variants fan out horizontally */}
          <div
            className="relative z-10 flex items-center justify-center w-full h-full px-8"
            onClick={(e) => e.stopPropagation()}
          >
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
                      sizes="(max-width: 768px) 80vw, 460px"
                      className="object-cover rounded-xl"
                      priority={isActive}
                    />
                    {/* Variant label - subtle tag at bottom */}
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

          {/* Pin focused image (base or variant) */}
          {card && (() => {
            const img = images[focused]
            const pinArg = focused === 0
              ? { cardId: card.id }
              : { cardId: card.id, variantId: img.id }
            const pinned = isPinned(pinArg)
            return (
              <button
                className={`lb-pin-btn${pinned ? ' lb-pin-btn--active' : ''}`}
                onClick={(e) => { e.stopPropagation(); togglePin(pinArg) }}
                aria-label={pinned ? 'Remove from board' : 'Pin to board'}
                aria-pressed={pinned}
              >
                <Bookmark size={14} strokeWidth={2} fill={pinned ? 'currentColor' : 'none'} />
              </button>
            )
          })()}

          {/* Close */}
          <button
            className="lb-close-btn"
            onClick={(e) => { e.stopPropagation(); closeLightbox() }}
            aria-label="Close"
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <line x1="2" y1="2" x2="12" y2="12" />
              <line x1="12" y1="2" x2="2" y2="12" />
            </svg>
          </button>

          {/* Variant dots - only if more than one */}
          {hasMultiple && (
            <div className="lb-dots" onClick={(e) => e.stopPropagation()}>
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

          {/* Prev / Next cards */}
          <button
            className="lb-arrow lb-arrow--prev"
            onClick={(e) => { e.stopPropagation(); goPrev() }}
            disabled={currentIndex <= 0}
            aria-label="Previous card"
          >
            ‹
          </button>
          <button
            className="lb-arrow lb-arrow--next"
            onClick={(e) => { e.stopPropagation(); goNext() }}
            disabled={currentIndex >= cards.length - 1}
            aria-label="Next card"
          >
            ›
          </button>

          {/* Counter - subtle */}
          <div className="lb-counter" onClick={(e) => e.stopPropagation()}>
            {currentIndex + 1} / {cards.length}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
