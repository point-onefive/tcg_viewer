/**
 * Shared "board background" model + helpers for the maker tools
 * (tier-list and chart-race). Both pages let the user drop a solid
 * color or an image behind the exported board and dial its opacity.
 *
 * Images are always stored as compressed WebP data URLs (not blob:
 * URLs) for two reasons:
 *   1. blob: URLs die on reload, so a persisted background would
 *      restore as a broken image.
 *   2. data: URLs are same-origin, so they never taint the export
 *      canvas the way a cross-origin remote image would.
 */

export type BoardBackgroundType = 'none' | 'color' | 'image'

export interface BoardBackground {
  type: BoardBackgroundType
  /** Hex color used when `type === 'color'`. */
  color: string
  /** Compressed WebP data URL used when `type === 'image'`. */
  image: string | null
  /** 0..1 opacity applied to the whole background layer. */
  opacity: number
}

export function defaultBoardBackground(): BoardBackground {
  return { type: 'none', color: '#12100e', image: null, opacity: 1 }
}

/** True when the background should actually paint something. */
export function backgroundIsActive(bg: BoardBackground | null | undefined): boolean {
  if (!bg) return false
  if (bg.type === 'color') return true
  if (bg.type === 'image') return Boolean(bg.image)
  return false
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

/**
 * Downscale a raster image (from any data/blob/same-origin URL) to at
 * most `maxDim` on its longest edge and re-encode as WebP. Keeps a
 * pasted 12MP screenshot from bloating localStorage while staying
 * crisp behind a chart. Falls back to the original src on any failure.
 */
export async function downscaleToDataUrl(
  src: string,
  maxDim = 1600,
  quality = 0.82,
): Promise<string> {
  try {
    const img = await loadImage(src)
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return src
    const scale = Math.min(1, maxDim / Math.max(w, h))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    const canvas = document.createElement('canvas')
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d')
    if (!ctx) return src
    ctx.drawImage(img, 0, 0, cw, ch)
    return canvas.toDataURL('image/webp', quality)
  } catch {
    return src
  }
}

/** Turn an uploaded/dropped File into a compressed WebP data URL. */
export async function fileToBackgroundDataUrl(
  file: File,
  maxDim = 1600,
  quality = 0.82,
): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const dataUrl = await readAsDataUrl(file)
    return downscaleToDataUrl(dataUrl, maxDim, quality)
  } catch {
    return null
  }
}

/**
 * Pull the first image off the clipboard as a compressed data URL.
 * Returns null when the browser blocks the read, denies permission,
 * or there simply isn't an image on the clipboard, so callers can show
 * a "use Upload instead" hint.
 */
export async function readClipboardImage(
  maxDim = 1600,
  quality = 0.82,
): Promise<string | null> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.clipboard ||
    typeof navigator.clipboard.read !== 'function'
  ) {
    return null
  }
  try {
    const items = await navigator.clipboard.read()
    for (const item of items) {
      const type = item.types.find((t) => t.startsWith('image/'))
      if (!type) continue
      const blob = await item.getType(type)
      const dataUrl = await readAsDataUrl(blob)
      return downscaleToDataUrl(dataUrl, maxDim, quality)
    }
    return null
  } catch {
    return null
  }
}
