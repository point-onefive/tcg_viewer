'use client'

// WalletConnectModal - centered, OpenSea-style wallet picker.
// Shows the CW favicon, official wallet logos, and "Installed" badges.

import { useEffect, useMemo, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import type { Connector } from 'wagmi'
import { ConnectorIcon, connectorLabel, friendlyWalletError } from './wallet-icons'
import { ModalPortal } from '@/components/ui/modal-portal'

interface WalletConnectModalProps {
  connectors: readonly Connector[]
  pendingId: string | null
  error: string | null
  onPick: (connectorId: string) => void
  onClose: () => void
}

/**
 * Dedupe + order connectors for display:
 *  - Drop the generic `injected` ("Browser Wallet") when specific EIP-6963
 *    wallets are detected (avoids the janky duplicate) OR when the browser
 *    exposes no injected provider at all. The latter is the mobile-normal-
 *    browser case: tapping "Injected" there just throws "Provider not found",
 *    so we hide it rather than offer a dead button.
 *  - Surface EIP-6963 wallets (the ones that carry their own icon) first.
 */
function useDisplayConnectors(connectors: readonly Connector[]): Connector[] {
  // window.ethereum is only meaningful client-side; gate so SSR + first paint
  // agree (both false) and we never flash the broken row.
  const [hasInjectedProvider, setHasInjectedProvider] = useState(false)
  useEffect(() => {
    setHasInjectedProvider(
      typeof window !== 'undefined' &&
        Boolean((window as unknown as { ethereum?: unknown }).ethereum),
    )
  }, [])

  return useMemo(() => {
    const hasDiscovered = connectors.some(
      (c) => c.id !== 'injected' && (c as Connector & { icon?: string }).icon,
    )
    const filtered = connectors.filter(
      (c) => !(c.id === 'injected' && (hasDiscovered || !hasInjectedProvider)),
    )
    // Stable sort: wallets with an icon (installed/discovered) first.
    return [...filtered].sort((a, b) => {
      const ai = (a as Connector & { icon?: string }).icon ? 0 : 1
      const bi = (b as Connector & { icon?: string }).icon ? 0 : 1
      return ai - bi
    })
  }, [connectors, hasInjectedProvider])
}

/** A connector is "installed" if it self-reported an EIP-6963 icon/provider. */
function isInstalled(connector: Connector): boolean {
  return Boolean((connector as Connector & { icon?: string }).icon)
}

export function WalletConnectModal({
  connectors,
  pendingId,
  error,
  onPick,
  onClose,
}: WalletConnectModalProps) {
  const display = useDisplayConnectors(connectors)

  return (
    <ModalPortal onClose={onClose} label="Connect a wallet" maxWidth={384}>
          {/* Close button */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 12px 0', flexShrink: 0 }}>
            <button
              onClick={onClose}
              aria-label="Close"
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '50%',
                width: 30,
                height: 30,
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

          {/* CW favicon header */}
          <div style={{ textAlign: 'center', padding: '0 24px 16px', flexShrink: 0 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/icon.png"
              alt="The Card Wall"
              width={56}
              height={56}
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                margin: '0 auto 12px',
                display: 'block',
                border: '1px solid var(--border-subtle)',
                background: '#0a0a0a',
              }}
            />
            <h2
              className="font-display"
              style={{ fontSize: 'clamp(18px, 5vw, 22px)', fontWeight: 800, letterSpacing: '-0.01em', lineHeight: 1.2 }}
            >
              Connect with The Card Wall
            </h2>
          </div>

          {/* Wallet list (scrollable) */}
          <div style={{ padding: '0 16px 8px', flex: 1, minHeight: 0, overflowY: 'auto' }}>
            <div
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 12,
                overflow: 'hidden',
              }}
            >
              {display.map((connector, i) => {
                const pending = pendingId === connector.id
                const installed = isInstalled(connector)
                return (
                  <button
                    key={connector.uid}
                    onClick={() => onPick(connector.id)}
                    disabled={pendingId !== null}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 14,
                      width: '100%',
                      padding: '14px 16px',
                      background: pending ? 'var(--bg)' : 'transparent',
                      border: 'none',
                      borderTop: i === 0 ? 'none' : '1px solid var(--border-subtle)',
                      cursor: pendingId !== null ? 'default' : 'pointer',
                      textAlign: 'left',
                      transition: 'background 0.12s',
                      opacity: pendingId !== null && !pending ? 0.5 : 1,
                    }}
                    onMouseEnter={(e) => {
                      if (pendingId === null) e.currentTarget.style.background = 'var(--bg)'
                    }}
                    onMouseLeave={(e) => {
                      if (!pending) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <span style={{ display: 'flex', flexShrink: 0 }}>
                      <ConnectorIcon connector={connector} size={30} />
                    </span>
                    <span className="font-display" style={{ fontWeight: 700, fontSize: 15, flex: 1 }}>
                      {connectorLabel(connector)}
                    </span>
                    {pending ? (
                      <Loader2 size={16} style={{ animation: 'spin 1s linear infinite', color: '#E85D2A' }} />
                    ) : installed ? (
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: 'var(--text-muted)',
                          background: 'var(--bg)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: 6,
                          padding: '3px 8px',
                        }}
                      >
                        Installed
                      </span>
                    ) : null}
                  </button>
                )
              })}
            </div>

            {error && (
              <p
                role="alert"
                style={{
                  margin: '12px 4px 0',
                  fontSize: 12,
                  lineHeight: 1.4,
                  color: '#ef4444',
                  textAlign: 'center',
                  overflowWrap: 'break-word',
                }}
              >
                {friendlyWalletError(error)}
              </p>
            )}
          </div>

          {/* Footer helper */}
          <p
            style={{
              padding: '12px 24px 20px',
              margin: 0,
              fontSize: 12,
              lineHeight: 1.5,
              color: 'var(--text-muted)',
              textAlign: 'center',
              flexShrink: 0,
              borderTop: '1px solid var(--border-subtle)',
            }}
          >
            You&apos;ll sign a message to verify ownership. No transaction or gas fee.
          </p>
    </ModalPortal>
  )
}
