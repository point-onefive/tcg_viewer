'use client'

// Central wallet auth hook for The Card Wall.
//
// Encapsulates the full sign-in flow:
//   1. useConnect (wagmi) - connect the wallet to the page
//   2. fetchNonce - get a server-issued one-time nonce
//   3. SiweMessage + useSignMessage - ask the wallet to sign the SIWE message
//   4. verifyWallet - server verifies the signature, creates/finds the profile,
//      and issues a session cookie
//
// Session state (the wallet's profile) is loaded once on mount and stays in
// local React state. Callers can re-fetch via refreshProfile() if needed.
//
// NOTE: Do not call this hook directly in components. Use `useWalletAuth` from
// `wallet-auth-context` so every component shares ONE auth state (otherwise a
// save in one component won't update the others, e.g. the header avatar).

import { useCallback, useEffect, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'
import { SiweMessage } from 'siwe'
import { SIWE_CHAIN_ID } from './config'
import { fetchNonce, verifyWallet, fetchMe, signOut, updateProfile } from './api-client'
import type { WalletStanding, UpdateProfileInput } from './api-client'

export type WalletAuthStatus =
  | 'loading'    // checking session on mount
  | 'idle'       // wallet not connected
  | 'connected'  // wallet connected but not signed in (no session cookie)
  | 'signing'    // awaiting wallet signature
  | 'verifying'  // server-side verification in progress
  | 'signed-in'  // session active, profile loaded
  | 'error'      // last action failed

export interface UseWalletAuthReturn {
  status: WalletAuthStatus
  address: string | undefined
  profile: WalletStanding | null
  connectors: ReturnType<typeof useConnect>['connectors']
  error: string | null

  /** Connect a specific connector and begin the SIWE sign-in flow. Resolves
   * to true on a successful sign-in, false if it failed or was rejected. */
  connectAndSign: (connectorId: string) => Promise<boolean>
  /** Sign out: clear session cookie and disconnect the wallet. */
  disconnect: () => Promise<void>
  /** Refresh the profile from the server. */
  refreshProfile: () => Promise<void>
  /** Update editable profile fields. */
  saveProfile: (input: UpdateProfileInput) => Promise<void>
}

export function useWalletAuthState(): UseWalletAuthReturn {
  const [status, setStatus] = useState<WalletAuthStatus>('loading')
  const [profile, setProfile] = useState<WalletStanding | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { address, isConnected, connector: activeConnector } = useAccount()
  const { connectAsync, connectors } = useConnect()
  const { disconnectAsync } = useDisconnect()
  const { signMessageAsync } = useSignMessage()

  // On mount: check if we have an active session cookie.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const standing = await fetchMe()
      if (cancelled) return
      if (standing) {
        setProfile(standing)
        setStatus('signed-in')
      } else if (isConnected) {
        setStatus('connected')
      } else {
        setStatus('idle')
      }
    })()
    return () => {
      cancelled = true
    }
    // Run once on mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When the wallet connects/disconnects, sync the idle/connected status
  // but only if we don't already have an active session.
  useEffect(() => {
    if (status === 'loading' || status === 'signed-in' || status === 'signing' || status === 'verifying') return
    setStatus(isConnected ? 'connected' : 'idle')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  const connectAndSign = useCallback(
    async (connectorId: string) => {
      setError(null)
      try {
        // Step 1: Connect the wallet, unless it is already connected via this
        // exact connector (calling connect() again throws "already connected").
        const connector = connectors.find((c) => c.id === connectorId)
        if (!connector) throw new Error('Wallet connector not found')

        setStatus('signing')

        let walletAddress: string | undefined
        if (isConnected && activeConnector?.id === connectorId && address) {
          // Already connected with the requested wallet - reuse the account.
          walletAddress = address
        } else {
          // If a different connector is active, disconnect it first so wagmi
          // does not reject the new connect() call.
          if (isConnected && activeConnector && activeConnector.id !== connectorId) {
            await disconnectAsync()
          }
          const { accounts } = await connectAsync({ connector })
          walletAddress = accounts[0]
        }

        if (!walletAddress) throw new Error('No wallet account available')

        // Step 2: Fetch nonce from server.
        const nonce = await fetchNonce()

        // Step 3: Build and sign the SIWE message.
        const domain = window.location.host
        const origin = window.location.origin
        const siweMessage = new SiweMessage({
          domain,
          address: walletAddress,
          statement: 'Sign in to The Card Wall to access tournaments and your player profile.',
          uri: origin,
          version: '1',
          chainId: SIWE_CHAIN_ID,
          nonce,
        })
        const messageString = siweMessage.prepareMessage()
        const signature = await signMessageAsync({ message: messageString })

        // Step 4: Verify on the server and get the profile.
        setStatus('verifying')
        const newProfile = await verifyWallet(messageString, signature)

        // Fetch full standings (W/L etc.) since verify only returns the base profile.
        const standing = await fetchMe()
        setProfile(standing ?? { ...newProfile, tournamentsPlayed: 0, wins: 0, losses: 0, draws: 0 })
        setStatus('signed-in')
        return true
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Sign-in failed'
        setError(msg)
        setStatus(isConnected ? 'connected' : 'idle')
        return false
      }
    },
    [connectors, connectAsync, disconnectAsync, signMessageAsync, isConnected, activeConnector, address],
  )

  const disconnect = useCallback(async () => {
    try {
      await signOut()
      await disconnectAsync()
      setProfile(null)
      setStatus('idle')
      setError(null)
    } catch {
      // Best-effort
    }
  }, [disconnectAsync])

  const refreshProfile = useCallback(async () => {
    const standing = await fetchMe()
    setProfile(standing)
    if (standing) setStatus('signed-in')
  }, [])

  const saveProfile = useCallback(async (input: UpdateProfileInput) => {
    const updated = await updateProfile(input)
    setProfile((prev) =>
      prev
        ? {
            ...prev,
            username: updated.username,
            xHandle: updated.xHandle,
            avatarUrl: updated.avatarUrl,
            availability: updated.availability,
            region: updated.region,
          }
        : null,
    )
  }, [])

  return {
    status,
    address,
    profile,
    connectors,
    error,
    connectAndSign,
    disconnect,
    refreshProfile,
    saveProfile,
  }
}
