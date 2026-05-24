'use client'

import { useState, useRef, useCallback, useMemo, useEffect } from 'react'
import Image from 'next/image'
import type { WallEntry } from '@/lib/card-filter'
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
  entry: WallEntry
  /**
   * Mark the topmost row of the first visible set as priority so Next's
   * image optimizer eager-loads and the LCP element isn't deferred.
   */
  priority?: boolean
  /** Stacked-card hint behind the tile (default view only). */
  showStack?: boolean
}

export function CardTile({ entry, priority = false, showStack = false }: CardTileProps) {
  const [loaded, setLoaded] = useState(false)
  const [srcIndex, setSrcIndex] = useState(0)
  const openLightbox = useStore((s) => s.openLightbox)
  const cardRef = useRef<HTMLDivElement>(null)
  const { card } = entry

  const imageSources = useMemo(
    () => [entry.imageSmall, ...(entry.imageFallbacks ?? [])],
    [entry.imageSmall, entry.imageFallbacks],
  )
  const imageSrc = imageSources[srcIndex] ?? entry.imageSmall

  useEffect(() => {
    setSrcIndex(0)
    setLoaded(false)
  }, [entry.wallKey, entry.imageSmall])

  const handleImageError = useCallback(() => {
    setSrcIndex((i) => {
      if (i + 1 < imageSources.length) {
        setLoaded(false)
        return i + 1
      }
      return i
    })
  }, [imageSources.length])

  const primaryColor = card.colors?.[0] ? (COLOR_MAP[card.colors[0]] ?? 'rgba(255,255,255,0.15)') : 'rgba(255,255,255,0.15)'
  const showVariantLabel = entry.kind === 'variant'

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

  const tierClass = showStack ? ' card-tile--has-variants' : ''
  const ariaName =
    entry.kind === 'variant'
      ? `${card.name} - ${card.code} (${entry.printLabel})`
      : `${card.name} - ${card.code}`

  const open = () => openLightbox(card.id, entry.printId)

  return (
    <div
      ref={cardRef}
      className={`card-tile${tierClass}`}
      style={{ '--card-color': primaryColor } as React.CSSProperties}
      onClick={open}
      onMouseMove={handleMouseMove}
      role="button"
      tabIndex={0}
      aria-label={ariaName}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          open()
        }
      }}
    >
      {showStack && (
        <>
          <div className="card-tile__stack card-tile__stack--2" aria-hidden />
          <div className="card-tile__stack card-tile__stack--1" aria-hidden />
        </>
      )}

      <div className="card-tile__img">
        {!loaded && <div className="card-tile__skeleton" />}

        <Image
          src={imageSrc}
          alt={ariaName}
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1280px) 25vw, 200px"
          className="card-tile__image"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={handleImageError}
          priority={priority}
          fetchPriority={priority ? 'high' : 'auto'}
          quality={60}
        />

        <div className="card-tile__shine" />
        <div className="card-tile__colorbar" />

        {showVariantLabel && (
          <span className="card-tile__print-pill" aria-hidden>
            {entry.printLabel}
          </span>
        )}
      </div>
    </div>
  )
}
