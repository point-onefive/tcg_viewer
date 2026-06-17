'use client'

// WalletProviders wraps the app with wagmi v3 + @tanstack/react-query context.
// Must be a client component (providers use React context).
// Added to the root layout so all pages can use useAccount, useConnect, etc.

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from '@/lib/wallet/config'
import { WalletAuthProvider } from '@/lib/wallet/wallet-auth-context'
import { useState } from 'react'

export function WalletProviders({ children }: { children: React.ReactNode }) {
  // Create QueryClient inside the component to avoid sharing state across requests.
  const [queryClient] = useState(() => new QueryClient())

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <WalletAuthProvider>{children}</WalletAuthProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
