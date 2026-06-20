// Wagmi v3 config for The Card Wall wallet auth.
//
// Chain: Ethereum mainnet is used for SIWE identity verification.
// No on-chain transactions happen - the chain is only referenced in the
// SIWE message to make wallet apps show the correct network context.
//
// Connectors:
//   - injected: MetaMask, Brave, Rabby, or any browser-injected EVM wallet
//   - coinbaseWallet: Coinbase Wallet (smart wallet + EOA)
//   - walletConnect: mobile wallets via WalletConnect v2 (requires project ID)
//
// WalletConnect is gated on NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID being set.
// Without it the injected + Coinbase connectors still work for desktop users.

import { createConfig, injected } from 'wagmi'
import { coinbaseWallet, walletConnect } from 'wagmi/connectors'
import { http } from 'viem'
import { mainnet } from 'viem/chains'

// Canonical production origin, used as the SSR fallback for WalletConnect
// metadata. On the client we always prefer the live origin (handles preview
// deploys, www vs apex, and localhost) so the dapp url matches exactly.
const FALLBACK_ORIGIN = 'https://thecardwall.com'

// WalletConnect requires dapp metadata whose `url` matches the live origin so
// that mobile wallets can deep-link back to the browser after the user
// approves. Without it, iOS Safari's native browser frequently fails to
// return from the wallet app, which is the only connect path on mobile (there
// is no injected provider there). Desktop is unaffected because it uses the
// injected extension connector instead.
function walletConnectMetadata() {
  const origin = typeof window !== 'undefined' ? window.location.origin : FALLBACK_ORIGIN
  return {
    name: 'The Card Wall',
    description: 'Trading card gallery and tournaments.',
    url: origin,
    icons: [`${origin}/icon.png`],
  }
}

const connectors = [
  injected(),
  coinbaseWallet({ appName: 'The Card Wall' }),
  ...(process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
    ? [
        walletConnect({
          projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
          showQrModal: true,
          metadata: walletConnectMetadata(),
        }),
      ]
    : []),
]

export const wagmiConfig = createConfig({
  chains: [mainnet],
  transports: {
    [mainnet.id]: http(),
  },
  connectors,
  ssr: true,
})

/** EIP-155 chain ID used in SIWE messages. */
export const SIWE_CHAIN_ID = mainnet.id

/** Human-readable app name shown in wallet connection dialogs. */
export const WALLET_APP_NAME = 'The Card Wall'
