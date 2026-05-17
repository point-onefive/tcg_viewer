'use client'

import { useState } from 'react'
import Image from 'next/image'
import type { ScannedCard } from '@/lib/pulse-rails'

interface PulseTileProps {
  scanned: ScannedCard
  onClick: () => void
}

/**
 * Compact card tile for the Pulse rails. Smaller and quieter than the
 * gallery's CardTile - no hover shine, no variant stack, no pin button.
 * Each tile shows the card art, name, set code, and a single heat dot
 * tinted to the pulse color. No raw numbers.
 */
export function PulseTile({ scanned, onClick }: PulseTileProps) {
  const [loaded, setLoaded] = useState(false)
  const { card, pulse } = scanned

  return (
    <button
      type="button"
      className={`pulse-tile pulse-tile--${pulse.heat}`}
      style={{ '--pulse-color': pulse.color } as React.CSSProperties}
      onClick={onClick}
      aria-label={`${card.name} (${card.code}) - ${pulse.tags.join(', ')}`}
    >
      <div className="pulse-tile__img">
        {!loaded && <div className="pulse-tile__skeleton" />}
        <Image
          src={card.imageSmall}
          alt={`${card.name} - ${card.code}`}
          fill
          sizes="(max-width: 640px) 120px, 160px"
          className="pulse-tile__image"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
        />
        <span className="pulse-tile__dot" aria-hidden />
      </div>
      <div className="pulse-tile__meta">
        <span className="pulse-tile__name" title={card.name}>{card.name}</span>
        <span className="pulse-tile__sub">
          <span>{card.code}</span>
          {pulse.tags[0] && (
            <>
              <span className="pulse-tile__sep" aria-hidden>·</span>
              <span className="pulse-tile__tag">{pulse.tags[0]}</span>
            </>
          )}
        </span>
      </div>
    </button>
  )
}
