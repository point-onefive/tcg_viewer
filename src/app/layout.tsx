import type { Metadata, Viewport } from 'next'
import { Space_Grotesk, Inter } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { ThemeProvider } from '@/components/theme-provider'
import { WalletProviders } from './wallet-providers'
import { PwaSplashController } from '@/components/pwa-splash-controller'
import './globals.css'

// Runs before the body paints. If the app was launched from the home screen
// (installed PWA, on Android or iOS), it tags <html> so CSS reveals our in-app
// splash overlay immediately. Browser visitors never get the class, so they
// never see the overlay. Kept inline + tiny so it can block paint safely.
const PWA_SPLASH_DETECT =
  "try{if(window.matchMedia('(display-mode: standalone)').matches||window.matchMedia('(display-mode: fullscreen)').matches||window.navigator.standalone===true){document.documentElement.classList.add('pwa-standalone')}}catch(e){}"

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

// iPhone/iPad portrait classes (logical width x height @ device-pixel-ratio).
// Each maps to a baked launch image at its physical resolution so iOS shows
// our static splash (black + mark + wordmark) instead of auto-generating one
// from the icon + system font. Covers the common modern devices; anything
// unmatched simply falls back to the manifest-driven splash.
const APPLE_SPLASH_DEVICES: { dw: number; dh: number; dpr: number }[] = [
  { dw: 440, dh: 956, dpr: 3 }, // 16 Pro Max
  { dw: 430, dh: 932, dpr: 3 }, // 15/14 Pro Max, 16 Plus
  { dw: 402, dh: 874, dpr: 3 }, // 16 Pro
  { dw: 393, dh: 852, dpr: 3 }, // 15/15 Pro/14 Pro/16
  { dw: 390, dh: 844, dpr: 3 }, // 14/13/13 Pro/12/12 Pro
  { dw: 375, dh: 812, dpr: 3 }, // 13 mini/12 mini/11 Pro/X/XS
  { dw: 414, dh: 896, dpr: 3 }, // 11 Pro Max/XS Max
  { dw: 414, dh: 896, dpr: 2 }, // 11/XR
  { dw: 414, dh: 736, dpr: 3 }, // 8 Plus/7 Plus
  { dw: 375, dh: 667, dpr: 2 }, // SE 2/3, 8, 7, 6s
  { dw: 320, dh: 568, dpr: 2 }, // SE 1
]

const appleStartupImages = APPLE_SPLASH_DEVICES.map(({ dw, dh, dpr }) => ({
  url: `/splash?w=${dw * dpr}&h=${dh * dpr}`,
  media: `(device-width: ${dw}px) and (device-height: ${dh}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)`,
}))

export const metadata: Metadata = {
  title: 'The Card Wall',
  description: 'The whole game, on one wall.',
  metadataBase: new URL('https://thecardwall.com'),
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    title: 'Card Wall',
    statusBarStyle: 'black-translucent',
    startupImage: appleStartupImages,
  },
  openGraph: {
    title: 'The Card Wall',
    description: 'The whole game, on one wall.',
    url: 'https://thecardwall.com',
    siteName: 'The Card Wall',
    images: [{ url: '/images/og.png', width: 1200, height: 630, alt: 'The Card Wall' }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'The Card Wall',
    description: 'The whole game, on one wall.',
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
      <body suppressHydrationWarning>
        <script dangerouslySetInnerHTML={{ __html: PWA_SPLASH_DETECT }} />
        {/* Preload the mark so our overlay paints it instantly (it's the same
            asset Android's system splash uses, so it's typically cached too) -
            this keeps the mark from blinking out between the two frames. */}
        <link rel="preload" as="image" href="/apple-icon.png" fetchPriority="high" />
        <div id="pwa-splash" aria-hidden="true">
          {/* The exact same artwork Android's system splash renders, centered
              at the same dead-center position, so the handoff from the OS frame
              to ours is just the wordmark appearing - no mark jump or redraw. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img className="pwa-splash-mark-img" src="/apple-icon.png" alt="" />
          <div className="pwa-splash-word">
            <span className="pwa-splash-the">the</span>
            <span className="pwa-splash-cw">Card Wall</span>
          </div>
        </div>
        <WalletProviders>
          <ThemeProvider>
            {children}
          </ThemeProvider>
        </WalletProviders>
        <PwaSplashController />
        <Analytics />
      </body>
    </html>
  )
}
