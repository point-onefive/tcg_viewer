import type { MetadataRoute } from 'next'

// Web app manifest for "Add to Home Screen" (Android / Chrome) and as a
// companion to the apple-touch-icon for iOS. Keeps the installed shortcut
// branded as The Card Wall with the CW mark instead of a generic screenshot.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'The Card Wall',
    short_name: 'Card Wall',
    description: 'The whole game, on one wall.',
    start_url: '/',
    display: 'standalone',
    background_color: '#0a0a0a',
    theme_color: '#0a0a0a',
    icons: [
      { src: '/icon.png', type: 'image/png', sizes: '512x512' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '1254x1254' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '1254x1254', purpose: 'maskable' },
    ],
  }
}
