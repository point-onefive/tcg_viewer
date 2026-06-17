'use client'

// WalletConnectButton - multi-step wallet connection flow.
//
// States rendered:
//   idle       - shows "Connect Wallet" button; clicking opens connector picker
//   connected  - shows "Sign in" prompt (wallet connected but no session)
//   signing    - waiting for wallet signature
//   verifying  - server verification in progress
//   signed-in  - shows avatar/username + dropdown menu
//   error      - shows error message + retry option

import { useState } from 'react'
import { Loader2, LogOut, Wallet, ChevronDown, Edit3, ExternalLink } from 'lucide-react'
import { useWalletAuth } from '@/lib/wallet/wallet-auth-context'
import { WalletConnectModal } from './wallet-connect-modal'
import { friendlyWalletError } from './wallet-icons'
import { PlayerAvatar } from './player-avatar'

// Short display for a 0x address: 0x1234...abcd
function shortAddress(addr: string): string {
  if (addr.length < 10) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

interface WalletConnectButtonProps {
  /** If true, renders a compact icon-only version for tight layouts. */
  compact?: boolean
  /** Called after a successful sign-in. */
  onSignedIn?: () => void
  /** Called after sign-out. */
  onSignedOut?: () => void
  /** Called when the user clicks their profile. */
  onProfileClick?: () => void
}

export function WalletConnectButton({
  compact = false,
  onSignedIn,
  onSignedOut,
  onProfileClick,
}: WalletConnectButtonProps) {
  const { status, address, profile, connectors, error, connectAndSign, disconnect } =
    useWalletAuth()

  const [showPicker, setShowPicker] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [pendingId, setPendingId] = useState<string | null>(null)

  const handleConnect = async (connectorId: string) => {
    setPendingId(connectorId)
    try {
      const ok = await connectAndSign(connectorId)
      if (ok) {
        setShowPicker(false)
        onSignedIn?.()
      }
    } finally {
      setPendingId(null)
    }
  }

  const handleDisconnect = async () => {
    setShowMenu(false)
    await disconnect()
    onSignedOut?.()
  }

  const btnBase: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: compact ? '7px 10px' : '8px 14px',
    borderRadius: 8,
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    transition: 'opacity 0.15s',
    border: '1px solid var(--border-subtle)',
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    position: 'relative' as const,
  }

  const pickerModal = showPicker ? (
    <WalletConnectModal
      connectors={connectors}
      pendingId={pendingId}
      error={error}
      onPick={handleConnect}
      onClose={() => { if (pendingId === null) setShowPicker(false) }}
    />
  ) : null

  // Loading / checking session.
  if (status === 'loading') {
    return (
      <div style={{ ...btnBase, opacity: 0.5 }}>
        <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
        {!compact && <span>Checking...</span>}
      </div>
    )
  }

  // Signed in: show avatar + username/address.
  if (status === 'signed-in' && profile) {
    const displayName = profile.username ?? shortAddress(profile.walletAddress)
    return (
      <div style={{ position: 'relative' }}>
        <button
          onClick={() => setShowMenu((v) => !v)}
          style={{ ...btnBase, padding: compact ? '4px' : '5px 12px 5px 6px', background: 'var(--bg-surface)', borderColor: '#E85D2A' }}
          aria-label="Profile menu"
          aria-expanded={showMenu}
        >
          <PlayerAvatar
            username={profile.username}
            xHandle={profile.xHandle}
            avatarUrl={profile.avatarUrl}
            walletAddress={profile.walletAddress}
            size={28}
          />
          {!compact && <span>{displayName}</span>}
          <ChevronDown size={12} style={{ color: 'var(--text-muted)' }} />
        </button>

        {showMenu && (
          <>
            {/* Backdrop */}
            <div
              style={{ position: 'fixed', inset: 0, zIndex: 49 }}
              onClick={() => setShowMenu(false)}
            />
            <div
              style={{
                position: 'absolute',
                top: 'calc(100% + 6px)',
                right: 0,
                zIndex: 50,
                background: 'var(--bg-surface)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                boxShadow: 'var(--shadow-card)',
                minWidth: 200,
                overflow: 'hidden',
              }}
            >
              {/* Profile info header */}
              <div
                style={{
                  padding: '10px 14px',
                  borderBottom: '1px solid var(--border-subtle)',
                }}
              >
                <div className="font-display font-bold text-sm">{displayName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                  {shortAddress(profile.walletAddress)}
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>
                  {profile.wins}W / {profile.losses}L
                  {profile.draws > 0 ? ` / ${profile.draws}D` : ''}
                  {profile.tournamentsPlayed > 0
                    ? ` · ${profile.tournamentsPlayed} event${profile.tournamentsPlayed !== 1 ? 's' : ''}`
                    : ''}
                </div>
              </div>

              {/* Menu items */}
              {profile.username && (
                <a
                  href={`/players/${encodeURIComponent(profile.username)}`}
                  onClick={() => setShowMenu(false)}
                  style={{ ...menuItemStyle, textDecoration: 'none' }}
                >
                  <ExternalLink size={14} />
                  View profile
                </a>
              )}
              <button
                onClick={() => { setShowMenu(false); onProfileClick?.() }}
                style={menuItemStyle}
              >
                <Edit3 size={14} />
                Edit profile
              </button>
              <button onClick={handleDisconnect} style={{ ...menuItemStyle, color: '#ef4444' }}>
                <LogOut size={14} />
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    )
  }

  // Signing or verifying: spinner.
  if (status === 'signing' || status === 'verifying') {
    return (
      <>
        <div style={{ ...btnBase, opacity: 0.7, cursor: 'default' }}>
          <Loader2 size={15} style={{ animation: 'spin 1s linear infinite' }} />
          {!compact && (
            <span>{status === 'signing' ? 'Waiting for signature...' : 'Verifying...'}</span>
          )}
        </div>
        {pickerModal}
      </>
    )
  }

  // Idle or error: show connect button.
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setShowPicker(true)}
        style={{
          ...btnBase,
          background: status === 'error' ? 'rgba(239,68,68,0.1)' : 'var(--bg-surface)',
          borderColor: status === 'error' ? '#ef4444' : 'var(--border-subtle)',
        }}
        aria-expanded={showPicker}
      >
        <Wallet size={15} />
        {!compact && (
          <span>
            {status === 'error' ? 'Try again' : 'Connect Wallet'}
          </span>
        )}
      </button>

      {error && !showPicker && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            right: 0,
            zIndex: 50,
            background: 'rgba(239,68,68,0.1)',
            border: '1px solid rgba(239,68,68,0.3)',
            borderRadius: 6,
            padding: '8px 12px',
            fontSize: 12,
            lineHeight: 1.4,
            color: '#ef4444',
            width: 'max-content',
            maxWidth: 'min(260px, calc(100vw - 32px))',
            whiteSpace: 'normal',
            overflowWrap: 'break-word',
          }}
          role="alert"
        >
          {friendlyWalletError(error)}
        </div>
      )}

      {pickerModal}
    </div>
  )
}

const menuItemStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  width: '100%',
  padding: '9px 14px',
  fontSize: 13,
  fontWeight: 600,
  color: 'var(--text-primary)',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  textAlign: 'left',
}
