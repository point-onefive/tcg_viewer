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
    // Use ONLY the full-bleed black mark (apple-icon) for the installed app +
    // the OS-generated splash. The other mark (icon.png) is a rounded tile
    // whose edge reads as a faint "ring" on the black splash, and listing both
    // made the splash flicker between the two. Keeping a single, seamless mark
    // makes the splash static. (icon.png stays as the browser-tab favicon via
    // Next's auto <link rel="icon">, which is unaffected by this list.)
    icons: [
      { src: '/apple-icon.png', type: 'image/png', sizes: '1024x1024' },
      { src: '/apple-icon.png', type: 'image/png', sizes: '1024x1024', purpose: 'maskable' },
    ],
  }
}
