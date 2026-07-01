'use client'

// PlayerProfileCard - the public, shareable full-page profile at
// /players/[username]. Shares ProfileBody with the popup (PlayerProfileView) so
// the two never drift. Tapping a badge/prize enlarges it in an in-card lightbox
// (no nested modal), matching the popup exactly.

import { useState } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { ProfileBody } from './profile-body'
import { AwardLightbox, type AwardItem } from './award-lightbox'
import type { WalletStanding } from '@/lib/wallet/db'

/** Presentational player profile. Public, shareable. */
export function PlayerProfileCard({ standing }: { standing: WalletStanding }) {
  const [selected, setSelected] = useState<AwardItem | null>(null)

  return (
    <div style={{ minHeight: '100dvh', background: 'var(--bg)', color: 'var(--text-primary)' }}>
      <div className="mx-auto px-4 py-10" style={{ maxWidth: 520 }}>
        <Link
          href="/tournaments"
          className="inline-flex items-center gap-1.5 text-sm font-semibold mb-6"
          style={{ color: 'var(--text-secondary)' }}
        >
          <ArrowLeft size={15} /> Tournaments
        </Link>

        <div
          style={{
            position: 'relative',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            boxShadow: 'var(--shadow-card)',
            overflow: 'hidden',
          }}
        >
          <div style={{ height: 4, background: 'linear-gradient(90deg, var(--tcw-accent), color-mix(in srgb, var(--tcw-accent) 35%, transparent))' }} />

          <div className="p-6 sm:p-8">
            <ProfileBody standing={standing} onSelectAward={setSelected} />
          </div>

          {selected && <AwardLightbox item={selected} onClose={() => setSelected(null)} />}
        </div>
      </div>
    </div>
  )
}
