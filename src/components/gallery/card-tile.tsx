'use client'

import { useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { Card } from '@/lib/types'
import { useStore } from '@/lib/store'

const COLOR_MAP: Record<string, string> = {
  Red:    '#ef4444',
  Blue:   '#3b82f6',
  Green:  '#22c55e',
  Purple: '#a855f7',
  Black:  '#9ca3af',
  Yellow: '#eab308',
}

interface CardTileProps {
  card: Card
}

export function CardTile({ card }: CardTileProps) {
  const [loaded, setLoaded] = useState(false)
  const openLightbox = useStore((s) => s.openLightbox)
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
      aria-label={`${card.name} — ${card.code}`}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          openLightbox(card.id)
        }
      }}
    >
      {/* Stacked card hint — sits behind the main tile when variants exist */}
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
          alt={`${card.name} — ${card.code}`}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 25vw, 200px"
          className="card-tile__image"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
        />

        {/* Cursor-following shine */}
        <div className="card-tile__shine" />

        {/* Color accent bar — bottom edge on hover */}
        <div className="card-tile__colorbar" />
      </div>
    </div>
  )
}

