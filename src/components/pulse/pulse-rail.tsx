'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { Rail, ScannedCard } from '@/lib/pulse-rails'
import { PulseTile } from './pulse-tile'

interface PulseRailProps {
  rail: Rail
  onCardClick: (scanned: ScannedCard) => void
}

/**
 * One horizontal rail in the Pulse scanner. Native scroll for momentum and
 * a11y; chevron buttons fade in only when there's room to scroll.
 */
export function PulseRail({ rail, onCardClick }: PulseRailProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const [canPrev, setCanPrev] = useState(false)
  const [canNext, setCanNext] = useState(false)

  const updateChevrons = useCallback(() => {
    const el = scrollerRef.current
    if (!el) return
    setCanPrev(el.scrollLeft > 4)
    setCanNext(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    const el = scrollerRef.current
    if (!el) return
    updateChevrons()
    el.addEventListener('scroll', updateChevrons, { passive: true })
    window.addEventListener('resize', updateChevrons)
    return () => {
      el.removeEventListener('scroll', updateChevrons)
      window.removeEventListener('resize', updateChevrons)
    }
  }, [updateChevrons])

  const nudge = useCallback((dir: 1 | -1) => {
    const el = scrollerRef.current
    if (!el) return
    el.scrollBy({ left: dir * Math.max(280, el.clientWidth * 0.7), behavior: 'smooth' })
  }, [])

  return (
    <section className="pulse-rail" aria-labelledby={`rail-${rail.id}-title`}>
      <header className="pulse-rail__header">
        <div className="pulse-rail__heading">
          <h2 id={`rail-${rail.id}-title`} className="pulse-rail__title">{rail.title}</h2>
          <span className="pulse-rail__count">{rail.cards.length}</span>
        </div>
        <p className="pulse-rail__subtitle">{rail.subtitle}</p>
      </header>

      <div className="pulse-rail__viewport">
        {canPrev && (
          <button
            type="button"
            className="pulse-rail__nav pulse-rail__nav--prev"
            onClick={() => nudge(-1)}
            aria-label="Scroll left"
          >
            <ChevronLeft size={16} strokeWidth={2.25} />
          </button>
        )}

        <div
          ref={scrollerRef}
          className="pulse-rail__scroller"
          data-lenis-prevent
        >
          {rail.cards.map((scanned) => (
            <PulseTile
              key={scanned.card.id}
              scanned={scanned}
              onClick={() => onCardClick(scanned)}
            />
          ))}
        </div>

        {canNext && (
          <button
            type="button"
            className="pulse-rail__nav pulse-rail__nav--next"
            onClick={() => nudge(1)}
            aria-label="Scroll right"
          >
            <ChevronRight size={16} strokeWidth={2.25} />
          </button>
        )}
      </div>
    </section>
  )
}
