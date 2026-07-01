'use client'

// PlayerProfileView - the player profile shown as a centered popup (same
// ModalPortal styling as the wallet connect / edit profile modals). Used by
// the "View profile" menu item. The public, shareable full-page version lives
// at /players/[username] (PlayerProfileCard). Both share ProfileBody so they
// stay identical.

import { useState } from 'react'
import { X } from 'lucide-react'
import { ProfileBody } from './profile-body'
import { AwardLightbox, type AwardItem } from './award-lightbox'
import { ModalPortal } from '@/components/ui/modal-portal'
import type { WalletStanding } from '@/lib/wallet/api-client'

interface PlayerProfileViewProps {
  standing: WalletStanding
  onClose: () => void
}

export function PlayerProfileView({ standing, onClose }: PlayerProfileViewProps) {
  const [selected, setSelected] = useState<AwardItem | null>(null)

  return (
    <ModalPortal onClose={onClose} label="Player profile" maxWidth={460} maxHeight="min(760px, calc(100dvh - 24px))">
      {/* Relative wrapper so the award lightbox can cover the whole card. */}
      <div style={{ position: 'relative', display: 'flex', flexDirection: 'column', minHeight: 0, flex: 1 }}>
        {/* Accent bar */}
        <div style={{ height: 4, background: 'linear-gradient(90deg, var(--tcw-accent), color-mix(in srgb, var(--tcw-accent) 35%, transparent))', flexShrink: 0 }} />

        {/* Close button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 12px 0', flexShrink: 0 }}>
          <button
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'var(--bg)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '50%',
              width: 32,
              height: 32,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              color: 'var(--text-secondary)',
            }}
          >
            <X size={16} />
          </button>
        </div>

        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '0 24px 24px' }}>
          <ProfileBody standing={standing} onSelectAward={setSelected} />
        </div>

        {selected && <AwardLightbox item={selected} onClose={() => setSelected(null)} />}
      </div>
    </ModalPortal>
  )
}
