import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { WalletProviders } from './wallet-providers'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
})

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-body',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'The Card Wall',
  description: "Find something you didn't know existed.",
  metadataBase: new URL('https://thecardwall.com'),
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Card Wall',
    statusBarStyle: 'black-translucent',
  },
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: [{ url: '/apple-icon', sizes: '180x180', type: 'image/png' }],
  },
  openGraph: {
    title: 'The Card Wall',
    description: "Find something you didn't know existed.",
    url: 'https://thecardwall.com',
    siteName: 'The Card Wall',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'The Card Wall' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Card Wall',
    description: "Find something you didn't know existed.",
    images: ['/images/og.png'],
  },
}

// Disable native page pinch-zoom so our in-app pinch gesture can drive the
// gallery zoom scale instead. Mobile users zoom via the pinch-to-grid feature.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0a0a0a' },
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
  ],
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`} suppressHydrationWarning>
      <body>
        <WalletProviders>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </WalletProviders>
        <Analytics />
      </body>
    </html>
  )
}
