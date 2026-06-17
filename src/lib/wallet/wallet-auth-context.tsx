'use client'

// Shared wallet auth context.
//
// `useWalletAuthState` (in use-wallet-auth) holds real React state, so calling
// it in multiple components would create multiple independent copies - a save
// in the profile modal would not update the header avatar. This provider calls
// it ONCE and shares the result, so every consumer sees the same live state.

import { createContext, useContext } from 'react'
import { useWalletAuthState, type UseWalletAuthReturn } from './use-wallet-auth'

const WalletAuthContext = createContext<UseWalletAuthReturn | null>(null)

export function WalletAuthProvider({ children }: { children: React.ReactNode }) {
  const value = useWalletAuthState()
  return <WalletAuthContext.Provider value={value}>{children}</WalletAuthContext.Provider>
}

/** Access the shared wallet auth state. Must be used under WalletAuthProvider. */
export function useWalletAuth(): UseWalletAuthReturn {
  const ctx = useContext(WalletAuthContext)
  if (!ctx) {
    throw new Error('useWalletAuth must be used within a WalletAuthProvider')
  }
  return ctx
}
