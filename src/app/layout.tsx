import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter } from 'next/font/google'
import { ThemeProvider } from '@/components/theme-provider'
import { SmoothScroll } from '@/components/smooth-scroll'
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
  description: 'A premium gallery of trading card games.',
  metadataBase: new URL('https://thecardwall.com'),
  openGraph: {
    title: 'The Card Wall',
    description: 'A premium gallery of trading card games.',
    url: 'https://thecardwall.com',
    siteName: 'The Card Wall',
    images: [{ url: '/images/og.png', width: 1200, height: 657, alt: 'The Card Wall' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Card Wall',
    description: 'A premium gallery of trading card games.',
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
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className={`${spaceGrotesk.variable} ${inter.variable}`} suppressHydrationWarning>
      <body>
        <ThemeProvider>
          <SmoothScroll />
          {children}
        </ThemeProvider>
      </body>
    </html>
  )
}
