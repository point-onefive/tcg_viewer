'use client'

// Wallet brand icons + resolver.
//
// Most installed wallets are discovered via EIP-6963 and already carry an
// official icon as a data URI on `connector.icon`. We prefer that. For the
// statically-configured connectors that don't self-report an icon (Coinbase
// Wallet SDK, WalletConnect) we ship official-style SVGs below, plus a generic
// fallback for any unknown injected provider.

import type { Connector } from 'wagmi'

// ── Official-style brand SVGs (used as fallbacks) ──────────────────────────

export function CoinbaseIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-hidden>
      <rect width="1024" height="1024" rx="228" fill="#0052FF" />
      <circle cx="512" cy="512" r="256" fill="#fff" />
      <rect x="404" y="404" width="216" height="216" rx="34" fill="#0052FF" />
    </svg>
  )
}

export function WalletConnectIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 480 480" aria-hidden>
      <rect width="480" height="480" rx="120" fill="#3396FF" />
      <path
        d="M140 178c55-54 145-54 200 0l7 7a7 7 0 0 1 0 10l-23 22a4 4 0 0 1-5 0l-9-9c-38-37-101-37-139 0l-10 10a4 4 0 0 1-5 0l-23-22a7 7 0 0 1 0-10l12-8zm247 46 20 20a7 7 0 0 1 0 10l-92 90a7 7 0 0 1-10 0l-65-64a2 2 0 0 0-3 0l-65 64a7 7 0 0 1-10 0l-92-90a7 7 0 0 1 0-10l20-20a7 7 0 0 1 10 0l65 64a2 2 0 0 0 3 0l65-64a7 7 0 0 1 10 0l65 64a2 2 0 0 0 3 0l65-64a7 7 0 0 1 11 0z"
        fill="#fff"
      />
    </svg>
  )
}

export function MetaMaskIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
      <rect width="40" height="40" rx="9" fill="#fff" />
      <path d="M31.5 7 22 13.9l1.8-4.1L31.5 7z" fill="#E2761B" stroke="#E2761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M8.5 7l9.4 7-1.7-4.2L8.5 7zM27.8 25.6l-2.5 3.8 5.4 1.5 1.5-5.2-4.4-.1zM7.9 25.7l1.5 5.2 5.4-1.5-2.5-3.8-4.4.1z" fill="#E4761B" stroke="#E4761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M14.5 18.2l-1.5 2.3 5.3.3-.2-5.8-3.6 3.2zM25.5 18.2l-3.7-3.3-.1 5.9 5.3-.3-1.5-2.3zM14.8 29.4l3.3-1.5-2.8-2.2-.5 3.7zM21.9 27.9l3.2 1.5-.4-3.7-2.8 2.2z" fill="#E4761B" stroke="#E4761B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M25.1 29.4l-3.2-1.5.3 2.1v.9l2.9-1.5zM14.8 29.4l2.9 1.5v-.9l.2-2.1-3.1 1.5z" fill="#D7C1B3" stroke="#D7C1B3" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M17.8 24.3l-2.7-.8 1.9-.9.8 1.7zM22.1 24.3l.8-1.7 1.9.9-2.7.8z" fill="#233447" stroke="#233447" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M14.8 29.4l.5-3.8-2.9.1 2.4 3.7zM24.6 25.6l.5 3.8 2.4-3.7-2.9-.1zM27 20.5l-5.3.3.5 2.7.8-1.7 1.9.9 2.1-2.2zM15.1 23.5l1.9-.9.8 1.7.5-2.7-5.3-.3 2.1 2.2z" fill="#CD6116" stroke="#CD6116" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M13 20.5l2.2 4.3-.1-2.1L13 20.5zM27 20.5l-2.2 2.2-.1 2.1 2.3-4.3zM18.3 20.8l-.5 2.7.6 3.2.1-4.2-.2-1.7zM21.7 20.8l-.2 1.7.1 4.2.6-3.2-.5-2.7z" fill="#E4751F" stroke="#E4751F" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M22.1 24.3l-.6 3.2.4.3 2.8-2.2.1-2.1-2.7.8zM15.1 23.5l.1 2.1 2.8 2.2.4-.3-.6-3.2-2.7-.8z" fill="#F6851B" stroke="#F6851B" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M22.2 30.9v-.9l-.3-.2h-3.8l-.2.2v.9l-2.9-1.5 1 .8 2 1.4h3.9l2.1-1.4 1-.8-2.8 1.5z" fill="#C0AD9E" stroke="#C0AD9E" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M21.9 27.9l-.4-.3h-3l-.4.3-.2 2.1.2-.2h3.8l.3.2-.3-2.1z" fill="#161616" stroke="#161616" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M31.9 14.4l.8-3.9-1.2-3.5-9 6.7 3.5 2.9 4.9 1.4 1.1-1.3-.5-.3.8-.7-.6-.4.8-.6-.5-.4zM7.3 10.5l.8 3.9-.5.4.8.6-.6.4.8.7-.5.3 1.1 1.3 4.9-1.4 3.5-2.9-9-6.7-1.3 3.5z" fill="#763D16" stroke="#763D16" strokeWidth=".4" strokeLinejoin="round" />
      <path d="M30.9 16.6l-4.9-1.4 1.5 2.3-2.3 4.3 3-.1h4.4l-1.7-5.1zM14 15.2l-4.9 1.4-1.6 5.1h4.4l3 .1-2.3-4.3 1.4-2.3zM21.7 20.8l.3-5.4 1.4-3.8h-6.8l1.4 3.8.3 5.4.1 1.7v4.2h3v-4.2l.1-1.7z" fill="#F6851B" stroke="#F6851B" strokeWidth=".4" strokeLinejoin="round" />
    </svg>
  )
}

export function GenericWalletIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <rect x="2" y="5" width="20" height="14" rx="3" fill="var(--bg)" stroke="currentColor" strokeWidth="1.6" />
      <path d="M2 9h20" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="17" cy="14" r="1.5" fill="currentColor" />
    </svg>
  )
}

// ── Resolver ───────────────────────────────────────────────────────────────

/**
 * Returns a renderable icon for a connector. Prefers the wallet's own
 * EIP-6963 icon (a data URI), falling back to a bundled brand SVG matched by
 * id/name, then a generic wallet glyph.
 */
export function ConnectorIcon({ connector, size = 28 }: { connector: Connector; size?: number }) {
  // 1. EIP-6963 / connector-provided icon (already official + correct).
  const icon = (connector as Connector & { icon?: string }).icon
  if (icon) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={icon}
        alt=""
        width={size}
        height={size}
        style={{ borderRadius: 7, display: 'block' }}
      />
    )
  }

  // 2. Bundled fallbacks by id/name keyword.
  const key = `${connector.id} ${connector.name}`.toLowerCase()
  if (key.includes('coinbase')) return <CoinbaseIcon size={size} />
  if (key.includes('walletconnect')) return <WalletConnectIcon size={size} />
  if (key.includes('metamask')) return <MetaMaskIcon size={size} />

  // 3. Generic fallback.
  return (
    <span style={{ color: 'var(--text-muted)', display: 'flex' }}>
      <GenericWalletIcon size={size} />
    </span>
  )
}

/** A nicer human label for a connector (strips reverse-DNS ids). */
export function connectorLabel(connector: Connector): string {
  const name = connector.name?.trim()
  if (name && !name.includes('.')) return name
  // Map common rdns ids to friendly names.
  const id = connector.id.toLowerCase()
  if (id.includes('metamask')) return 'MetaMask'
  if (id.includes('rabby')) return 'Rabby Wallet'
  if (id.includes('phantom')) return 'Phantom'
  if (id.includes('coinbase')) return 'Coinbase Wallet'
  if (id.includes('rainbow')) return 'Rainbow'
  if (id.includes('trust')) return 'Trust Wallet'
  if (id.includes('brave')) return 'Brave Wallet'
  if (id === 'injected') return 'Browser Wallet'
  return name || connector.id
}

/**
 * Turn a raw wallet/provider error into a short, human message. Wallet libs
 * often repeat themselves ("User rejected the request. Details: User rejected
 * the request..."), so we collapse to the first sentence and map common cases.
 */
export function friendlyWalletError(raw: string): string {
  const text = raw.trim()
  if (/user rejected|user denied|rejected the request/i.test(text)) {
    return 'Request rejected in your wallet.'
  }
  if (/already pending|request of type/i.test(text)) {
    return 'Check your wallet - a request is already open.'
  }
  if (/connector not found|no provider|not installed/i.test(text)) {
    return 'Wallet not detected. Is the extension unlocked?'
  }
  const firstSentence = text.split(/\.\s|: /)[0]
  return firstSentence.length > 120 ? `${firstSentence.slice(0, 117)}...` : firstSentence
}
