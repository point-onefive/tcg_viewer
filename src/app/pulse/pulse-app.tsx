'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, Activity } from 'lucide-react'
import type { Rail, ScannedCard } from '@/lib/pulse-rails'
import { PulseRail } from '@/components/pulse/pulse-rail'
import { PulseDetail } from '@/components/pulse/pulse-detail'

interface PulseAppProps {
  rails: Rail[]
}

export function PulseApp({ rails }: PulseAppProps) {
  const [selected, setSelected] = useState<ScannedCard | null>(null)

  return (
    <main className="pulse-shell">
      <header className="pulse-topbar">
        <div className="pulse-topbar__inner">
          <Link href="/" className="pulse-topbar__back" aria-label="Back to Card Wall">
            <ArrowLeft size={14} strokeWidth={2.25} />
            <span>Card Wall</span>
          </Link>

          <div className="pulse-topbar__brand">
            <Activity size={14} strokeWidth={2.25} />
            <span className="pulse-topbar__wordmark">Pulse</span>
            <span className="pulse-topbar__tag">One Piece TCG · scanner</span>
          </div>

          <div className="pulse-topbar__meta">
            <span className="pulse-topbar__badge" title="Live data lands in a future release">
              mock data
            </span>
          </div>
        </div>
      </header>

      <section className="pulse-hero">
        <h1 className="pulse-hero__title">Pulse</h1>
        <p className="pulse-hero__lede">
          A curated scan of where attention, scarcity, and supply are out of balance
          across the One Piece market. Tap a card for its signal shape. Real numbers
          and live alerts ship to the private Telegram channel.
        </p>
      </section>

      <div className="pulse-rails">
        {rails.length === 0 ? (
          <div className="pulse-empty">
            <p>No signals yet. Once the ingestion worker is running, rails will fill in automatically.</p>
          </div>
        ) : (
          rails.map((rail) => (
            <PulseRail
              key={rail.id}
              rail={rail}
              onCardClick={(s) => setSelected(s)}
            />
          ))
        )}
      </div>

      <PulseDetail scanned={selected} onClose={() => setSelected(null)} />
    </main>
  )
}
