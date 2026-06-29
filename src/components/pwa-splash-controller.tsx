'use client'

import { useEffect } from 'react'

/**
 * Dismisses the in-app PWA splash overlay (#pwa-splash) once the app is ready.
 *
 * The overlay itself is server-rendered in the root layout and shown only when
 * a tiny inline head script has tagged <html> with `.pwa-standalone` (i.e. the
 * app is launched from the home screen). This controller waits for the page to
 * finish loading - with a minimum on-screen time so it never flash-and-vanishes
 * and a hard cap so it can never get stuck - then adds `.pwa-splash-hide`, which
 * fades the overlay out via CSS. Browser (non-installed) visitors never see it,
 * so there is nothing to dismiss there.
 */
export function PwaSplashController() {
  useEffect(() => {
    const html = document.documentElement
    if (!html.classList.contains('pwa-standalone')) return

    const MIN_MS = 550 // keep it on screen long enough to read
    const MAX_MS = 4000 // safety cap: never let the splash get stuck
    const start = performance.now()
    let done = false

    const hide = () => {
      if (done) return
      done = true
      html.classList.add('pwa-splash-hide')
    }
    const hideAfterMin = () => {
      const wait = Math.max(0, MIN_MS - (performance.now() - start))
      window.setTimeout(hide, wait)
    }

    if (document.readyState === 'complete') hideAfterMin()
    else window.addEventListener('load', hideAfterMin, { once: true })

    const cap = window.setTimeout(hide, MAX_MS)
    return () => {
      window.clearTimeout(cap)
      window.removeEventListener('load', hideAfterMin)
    }
  }, [])

  return null
}
