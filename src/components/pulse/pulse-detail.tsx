'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import { X, Send } from 'lucide-react'
import type { ScannedCard } from '@/lib/pulse-rails'

interface PulseDetailProps {
  scanned: ScannedCard | null
  onClose: () => void
}

function Sparkline({ trend, color }: { trend: number[]; color: string }) {
  const w = 280
  const h = 64
  const stepX = w / (trend.length - 1)
  const d = trend
    .map((y, i) => `${i === 0 ? 'M' : 'L'} ${(i * stepX).toFixed(1)} ${(h - y * h).toFixed(1)}`)
    .join(' ')
  // Area path for a soft fill under the line
  const area = `${d} L ${w} ${h} L 0 ${h} Z`
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="pulse-detail__spark" aria-hidden>
      <defs>
        <linearGradient id="sparkfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#sparkfill)" />
      <path d={d} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" opacity="0.95" />
    </svg>
  )
}

export function PulseDetail({ scanned, onClose }: PulseDetailProps) {
  useEffect(() => {
    if (!scanned) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', handleKey)
      document.body.style.overflow = ''
    }
  }, [scanned, onClose])

  return (
    <AnimatePresence>
      {scanned && (
        <>
          <motion.div
            className="pulse-detail__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />
          <motion.aside
            className="pulse-detail"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 280, damping: 32 }}
            style={{ '--pulse-color': scanned.pulse.color } as React.CSSProperties}
            role="dialog"
            aria-label={`${scanned.card.name} pulse detail`}
          >
            <header className="pulse-detail__header">
              <span className={`pulse-detail__heat pulse-detail__heat--${scanned.pulse.heat}`}>
                <span className="pulse-detail__dot" aria-hidden />
                {scanned.pulse.heat.toUpperCase()}
              </span>
              <button
                type="button"
                className="pulse-detail__close"
                onClick={onClose}
                aria-label="Close"
              >
                <X size={14} strokeWidth={2.25} />
              </button>
            </header>

            <div className="pulse-detail__art">
              <Image
                src={scanned.card.imageLarge ?? scanned.card.imageSmall}
                alt={`${scanned.card.name} - ${scanned.card.code}`}
                fill
                sizes="(max-width: 640px) 90vw, 380px"
                className="pulse-detail__image"
              />
            </div>

            <div className="pulse-detail__body">
              <h3 className="pulse-detail__name">{scanned.card.name}</h3>
              <p className="pulse-detail__sub">
                <span>{scanned.card.code}</span>
                {scanned.card.rarity && <><span className="pulse-detail__sep">·</span>{scanned.card.rarity}</>}
                {scanned.card.cardType && <><span className="pulse-detail__sep">·</span>{scanned.card.cardType}</>}
                {scanned.card.setName && <><span className="pulse-detail__sep">·</span>{scanned.card.setName}</>}
              </p>

              <div className="pulse-detail__tags" role="group" aria-label="Pulse signals">
                {scanned.pulse.tags.map((t) => (
                  <span key={t} className="pulse-detail__tag">{t}</span>
                ))}
              </div>

              <div className="pulse-detail__spark-wrap">
                <span className="pulse-detail__spark-label">30-day shape</span>
                <Sparkline trend={scanned.pulse.trend} color={scanned.pulse.color} />
              </div>

              <div className="pulse-detail__footer">
                <p className="pulse-detail__note">
                  Numbers, sleeper score, and live alerts ship to the private Telegram channel.
                </p>
                <a
                  href="https://t.me/card_wall_pulse_bot"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="pulse-detail__cta"
                >
                  <Send size={13} strokeWidth={2.25} />
                  Open Pulse on Telegram
                </a>
              </div>
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
