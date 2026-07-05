/**
 * Chart export helpers for the tier-list page. Single flavour:
 *
 *  - PNG : single-frame snapshot of the chart frame on a solid
 *          background. The CSS `chart-blip` border (if the user
 *          has the on-page toggle enabled) gets captured at
 *          whatever frame of the animation it's in at the moment
 *          the snapshot is taken.
 *
 * Depends on R2 sending `Access-Control-Allow-Origin: *` on card
 * images (configured via the Cloudflare API one time -- see the
 * conversation that introduced this file). Without that header
 * `html-to-image` taints the canvas it draws into and `toBlob`
 * throws `SecurityError`, which kills the export the moment a
 * real card lands in a tier.
 *
 * `html-to-image` is dynamic-imported inside the capture function
 * so it only lands in the bundle on the first export click, not
 * on every tier-list page load.
 */

function resolveBackground(): string {
  if (typeof document === 'undefined') return '#111'
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  return bg || '#111'
}

/**
 * Render the given DOM node to an `HTMLCanvasElement` via
 * `html-to-image`. `pixelRatio` controls fidelity vs. memory;
 * 2 gives a retina-sharp PNG that downscales cleanly when
 * Twitter / Discord rescale the image to fit a post.
 */
export async function captureChartCanvas(
  node: HTMLElement,
  pixelRatio = 2,
): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image')
  return toCanvas(node, {
    pixelRatio,
    // `cacheBust: true` appends a unique query string to every
    // image fetch so html-to-image bypasses any cached *no-CORS*
    // response the browser might have stashed before R2 grew its
    // CORS headers. Without this, the first export after a page
    // load still hits the pre-CORS cache and the canvas comes
    // back tainted (toBlob -> SecurityError), even though every
    // <img> on the page is now `crossOrigin="anonymous"`. Cost
    // is one re-fetch per card per export, which is fine for a
    // human-triggered action.
    cacheBust: true,
    backgroundColor: resolveBackground(),
  })
}

function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/png'): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('canvas.toBlob() returned null'))
    }, type)
  })
}

/**
 * Capture the chart as a PNG blob.
 */
export async function captureChartPng(node: HTMLElement): Promise<Blob> {
  const canvas = await captureChartCanvas(node, 2)
  return canvasToBlob(canvas, 'image/png')
}

/**
 * Trigger a browser download for the given blob. Tries to reuse
 * a single hidden anchor across calls so we don't pile DOM nodes
 * on every export.
 */
export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Give the browser a tick to start the download before revoking
  // the object URL, otherwise some browsers cancel the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * True on touch-first devices (phones / tablets). Used to decide
 * whether a PNG should go through the native share sheet instead of
 * a hidden `<a download>`, which iOS Safari silently refuses to
 * honour for `blob:` URLs -- the tap looks like it errored and
 * nothing lands in the camera roll (the "can't save image" bug).
 */
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  const coarse =
    typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
  const touch = typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0
  return coarse || touch
}

/**
 * Save a PNG blob the way the current device actually supports.
 *
 *  - Desktop: a hidden `<a download>` (unchanged, works everywhere).
 *  - Mobile: `<a download>` is a no-op on iOS Safari for `blob:`
 *    URLs, so the export looked broken. When the browser can share
 *    files (`navigator.canShare({ files })`, true on iOS 15+ and
 *    modern Android) we hand the PNG to the native share sheet,
 *    which surfaces "Save Image" / "Save to Photos" / "Save to
 *    Files". If sharing is unavailable, or the share call throws for
 *    any reason other than the user dismissing the sheet, we fall
 *    back to the download anchor so the user still walks away with
 *    something.
 *
 * Returns which path ran so the caller can tailor its status flash
 * (`cancelled` = user backed out of the share sheet -> stay silent).
 */
export async function saveOrShareBlob(
  blob: Blob,
  filename: string,
): Promise<'shared' | 'downloaded' | 'cancelled'> {
  if (
    isTouchDevice() &&
    typeof navigator !== 'undefined' &&
    typeof navigator.canShare === 'function' &&
    typeof navigator.share === 'function'
  ) {
    try {
      const file = new File([blob], filename, { type: blob.type || 'image/png' })
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] })
        return 'shared'
      }
    } catch (err) {
      // AbortError = the user tapped away from the share sheet. Treat
      // it as a deliberate cancel and do NOT also fire a download.
      // Any other failure (e.g. the share gesture expired) drops
      // through to the download fallback below.
      if (err instanceof Error && err.name === 'AbortError') return 'cancelled'
    }
  }
  downloadBlob(blob, filename)
  return 'downloaded'
}

/**
 * Try to copy an image blob to the clipboard. Browsers / OS combos
 * that don't allow image clipboard writes (Safari without HTTPS,
 * Firefox at the time of writing, no user gesture, etc.) return
 * `false` so the caller can fall back to a download.
 */
export async function copyBlobToClipboard(blob: Blob): Promise<boolean> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.write !== 'function' ||
    typeof ClipboardItem === 'undefined'
  ) {
    return false
  }
  try {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return true
  } catch (err) {
    console.warn('Clipboard image write rejected', err)
    return false
  }
}

/**
 * Build a date-stamped filename for the export. Format:
 * `tier-list-2026-05-20-2247.png`. Date-stamp matches the
 * user's local timezone so the filename is meaningful when
 * sorting downloads.
 */
export function buildExportFilename(title: string, ext: 'png'): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 40)
  const base = slug || 'tier-list'
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  return `${base}-${stamp}.${ext}`
}
