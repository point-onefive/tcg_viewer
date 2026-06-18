'use client'

// WalletHeaderWidget - wallet connect button + profile modal in one unit.
// Placed in the tournament header so players can identify themselves before
// signing up for a tournament.

import { useEffect, useState } from 'react'
import { WalletConnectButton } from './wallet-connect-button'
import { PlayerProfileModal } from './player-profile-modal'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'

export function WalletHeaderWidget() {
  const [showProfile, setShowProfile] = useState(false)
  const { status } = useWalletAuth()

  // Render the icon-only button on narrow screens so the tournament header
  // stays on a single row. Mounted-gated so SSR + first client render agree
  // (both false), avoiding a hydration mismatch.
  const [compact, setCompact] = useState(false)
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 639px)')
    const sync = () => setCompact(mq.matches)
    sync()
    mq.addEventListener('change', sync)
    return () => mq.removeEventListener('change', sync)
  }, [])

  return (
    <>
      <WalletConnectButton
        compact={compact}
        onProfileClick={() => setShowProfile(true)}
      />
      {showProfile && status === 'signed-in' && (
        <PlayerProfileModal onClose={() => setShowProfile(false)} />
      )}
    </>
  )
}
