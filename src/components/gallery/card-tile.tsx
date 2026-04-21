'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Bookmark } from 'lucide-react'
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
}

export function CardTile({ card }: CardTileProps) {
  const [loaded, setLoaded] = useState(false)
  const openLightbox = useStore((s) => s.openLightbox)
  const togglePin = useStore((s) => s.togglePin)
  const isPinned = useStore((s) => s.isPinned({ cardId: card.id }))
  const cardRef = useRef<HTMLDivElement>(null)

  const primaryColor = card.colors?.[0] ? (COLOR_MAP[card.colors[0]] ?? 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.15)'
  const variantCount = card.variants?.length ?? 0
  const hasVariants = variantCount > 0

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const el = cardRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * 100
    const y = ((e.clientY - rect.top) / rect.height) * 100
    el.style.setProperty('--mx', `${x}%`)
    el.style.setProperty('--my', `${y}%`)
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
      data-tour={hasVariants ? 'stack' : undefined}
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
        />

        {/* Cursor-following shine */}
        <div className="card-tile__shine" />

        {/* Color accent bar - bottom edge on hover */}
        <div className="card-tile__colorbar" />

        {/* Pin / bookmark toggle - top-right. Pins the base art.
            Variants are pinned individually from the lightbox. */}
        <button
          type="button"
          className={`card-tile__pin${isPinned ? ' card-tile__pin--active' : ''}`}
          onClick={(e) => {
            e.stopPropagation()
            togglePin({ cardId: card.id })
          }}
          aria-label={isPinned ? 'Remove from board' : 'Pin to board'}
          aria-pressed={isPinned}
        >
          <Bookmark size={14} strokeWidth={2} fill={isPinned ? 'currentColor' : 'none'} />
        </button>
      </div>
    </div>
  )
}

