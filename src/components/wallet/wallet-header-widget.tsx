'use client'

// WalletHeaderWidget - wallet connect button + profile modal in one unit.
// Placed in the tournament header so players can identify themselves before
// signing up for a tournament.

import { useState } from 'react'
import { WalletConnectButton } from './wallet-connect-button'
import { PlayerProfileModal } from './player-profile-modal'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'

export function WalletHeaderWidget() {
  const [showProfile, setShowProfile] = useState(false)
  const { status } = useWalletAuth()

  return (
    <>
      <WalletConnectButton
        onProfileClick={() => setShowProfile(true)}
      />
      {showProfile && status === 'signed-in' && (
        <PlayerProfileModal onClose={() => setShowProfile(false)} />
      )}
    </>
  )
}
