'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Card } from '@/lib/types'
import { useStore } from '@/lib/store'

const COLOR_MAP: Record<string, string> = {
  Red:       '#ef4444',
  Blue:      '#3b82f6',
  Green:     '#22c55e',
  Purple:    '#a855f7',
  Black:     '#9ca3af',
  Yellow:    '#eab308',
  // Pokémon energy types
  Grass:     '#78c850',
  Fire:      '#f97316',
  Water:     '#38bdf8',
  Lightning: '#facc15',
  Psychic:   '#c084fc',
  Fighting:  '#b45309',
  Darkness:  '#1f2937',
  Metal:     '#94a3b8',
  Fairy:     '#f472b6',
  Dragon:    '#7c3aed',
  Colorless: '#e5e7eb',
}

interface CardTileProps {
  card: Card
  /**
   * Mark the topmost row of the first visible set as priority so Next's
   * image optimizer eager-loads and the LCP element isn't deferred.
   */
  priority?: boolean
}

export function CardTile({ card, priority = false }: CardTileProps) {
  const [loaded, setLoaded] = useState(false)
  // Pin / tier-pool actions were intentionally moved off the tile and
  // into the lightbox. The tile is now a single-purpose target: click
  // to drill in, see the big art + every alt print, and choose
  // pin / queue from there (per-variant, not just the base art). This
  // keeps the wall feeling like a museum vs. a control surface, and
  // means the hover hit area doesn't reveal floating circular buttons
  // that competed with the card art at small zoom levels.
  const openLightbox = useStore((s) => s.openLightbox)
  const cardRef = useRef<HTMLDivElement>(null)

  const primaryColor = card.colors?.[0] ? (COLOR_MAP[card.colors[0]] ?? 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.15)'
  const variantCount = card.variants?.length ?? 0
  const hasVariants = variantCount > 0

  // Cursor-tracking shine. We throttle to one update per animation frame
  // because mousemove fires at 60–120Hz and each callback both touches the
  // DOM (getBoundingClientRect forces style recalc) AND writes CSS custom
  // properties that trigger a paint on the .card-tile__shine gradient.
  // Coalescing to rAF caps the work at one paint per frame.
  const rafPending = useRef(false)
  const lastEvent = useRef<{ clientX: number; clientY: number } | null>(null)
  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    lastEvent.current = { clientX: e.clientX, clientY: e.clientY }
    if (rafPending.current) return
    rafPending.current = true
    requestAnimationFrame(() => {
      rafPending.current = false
      const el = cardRef.current
      const ev = lastEvent.current
      if (!el || !ev) return
      const rect = el.getBoundingClientRect()
      const x = ((ev.clientX - rect.left) / rect.width) * 100
      const y = ((ev.clientY - rect.top) / rect.height) * 100
      el.style.setProperty('--mx', `${x}%`)
      el.style.setProperty('--my', `${y}%`)
    })
  }, [])

  const tierClass = hasVariants ? ' card-tile--has-variants' : ''

  return (
    <div
      ref={cardRef}
      className={`card-tile${tierClass}`}
      style={{ '--card-color': primaryColor } as React.CSSProperties}
      onClick={() => openLightbox(card.id)}
      onMouseMove={handleMouseMove}
      role="button"
      tabIndex={0}
      aria-label={`${card.name} - ${card.code}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openLightbox(card.id)
        }
      }}
    >
      {/* Stacked card hint - sits behind the main tile when variants exist */}
      {hasVariants && (
        <>
          <div className="card-tile__stack card-tile__stack--2" aria-hidden />
          <div className="card-tile__stack card-tile__stack--1" aria-hidden />
        </>
      )}

      <div className="card-tile__img">
        {!loaded && <div className="card-tile__skeleton" />}

        <Image
          src={card.imageSmall}
          alt={`${card.name} - ${card.code}`}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 25vw, 200px"
          className="card-tile__image"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          priority={priority}
          fetchPriority={priority ? 'high' : 'auto'}
        />

        {/* Cursor-following shine */}
        <div className="card-tile__shine" />

        {/* Color accent bar - bottom edge on hover */}
        <div className="card-tile__colorbar" />
      </div>
    </div>
  )
}

