'use client'

// Pasted/selected images are downscaled + re-encoded to a compact data
// URL before they ever hit the database. Prizes ride inside the polled
// tournament snapshot, so an un-compressed 4MB screenshot would get
// re-downloaded by every viewer every poll - this keeps each image to
// roughly 50–150KB while staying crisp at the sizes we render.

const MAX_DIMENSION = 900
const QUALITY = 0.82

export async function compressImageToDataUrl(
  source: Blob,
  maxDim = MAX_DIMENSION,
  quality = QUALITY,
): Promise<string> {
  const bitmap = await createImageBitmap(source)
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height))
    const w = Math.max(1, Math.round(bitmap.width * scale))
    const h = Math.max(1, Math.round(bitmap.height * scale))

    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = h
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas not supported')
    ctx.drawImage(bitmap, 0, 0, w, h)

    // WebP keeps transparency + compresses best; fall back to JPEG on
    // the handful of browsers that don't encode WebP from a canvas.
    const webp = canvas.toDataURL('image/webp', quality)
    if (webp.startsWith('data:image/webp')) return webp
    return canvas.toDataURL('image/jpeg', quality)
  } finally {
    bitmap.close?.()
  }
}

/** Pull the first image blob out of a paste event, if any. */
export function imageFromClipboard(e: ClipboardEvent | React.ClipboardEvent): Blob | null {
  const items = (e as React.ClipboardEvent).clipboardData?.items
  if (!items) return null
  for (let i = 0; i < items.length; i++) {
    const item = items[i]
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile()
      if (file) return file
    }
  }
  return null
}
