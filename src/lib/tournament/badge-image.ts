'use client'

// Badge images are normalized in the browser on upload so every badge - past or
// future, whoever made it - reads at the same visual size with equal padding on
// a 1:1 canvas. This mirrors the one-off ImageMagick pipeline documented in
// docs/badges.md:
//
//   trim transparent border  ->  fit longest side to 460px  ->  center on a
//   512x512 transparent canvas.
//
// Output is a WebP data URL (keeps transparency, compresses well) so it stays
// small enough to ride in the tournament snapshot, with a PNG fallback for the
// rare browser that can't encode WebP with alpha from a canvas.

/** Content-fit target (longest side, px) inside the square canvas. */
const FIT = 460
/** Final square canvas (px). 512 - 460 => ~26px even transparent margin. */
const CANVAS = 512
/** Cap the working canvas so a huge upload doesn't blow memory during the scan. */
const WORK_MAX = 1000
/** Alpha at/above this counts as "content" when trimming. */
const ALPHA_THRESHOLD = 8

export async function normalizeBadgeImageToDataUrl(source: Blob): Promise<string> {
  const bitmap = await createImageBitmap(source)
  try {
    const bw = bitmap.width
    const bh = bitmap.height
    if (!bw || !bh) throw new Error('Empty image')

    // Draw into a working canvas (downscaled if large) so we can read pixels.
    const s0 = Math.min(1, WORK_MAX / Math.max(bw, bh))
    const ww = Math.max(1, Math.round(bw * s0))
    const wh = Math.max(1, Math.round(bh * s0))
    const work = document.createElement('canvas')
    work.width = ww
    work.height = wh
    const wctx = work.getContext('2d')
    if (!wctx) throw new Error('Canvas not supported')
    wctx.drawImage(bitmap, 0, 0, ww, wh)

    // Trim: find the bounding box of non-transparent pixels.
    const { data } = wctx.getImageData(0, 0, ww, wh)
    let minX = ww
    let minY = wh
    let maxX = -1
    let maxY = -1
    for (let y = 0; y < wh; y++) {
      for (let x = 0; x < ww; x++) {
        if (data[(y * ww + x) * 4 + 3] >= ALPHA_THRESHOLD) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
    }
    // Fully transparent (shouldn't happen): fall back to the whole image.
    if (maxX < 0) {
      minX = 0
      minY = 0
      maxX = ww - 1
      maxY = wh - 1
    }

    const cw = maxX - minX + 1
    const ch = maxY - minY + 1
    const scale = FIT / Math.max(cw, ch) // fit longest side to 460 (up or down)
    const dw = Math.max(1, Math.round(cw * scale))
    const dh = Math.max(1, Math.round(ch * scale))

    const out = document.createElement('canvas')
    out.width = CANVAS
    out.height = CANVAS
    const octx = out.getContext('2d')
    if (!octx) throw new Error('Canvas not supported')
    octx.imageSmoothingEnabled = true
    octx.imageSmoothingQuality = 'high'
    octx.drawImage(
      work,
      minX,
      minY,
      cw,
      ch,
      Math.round((CANVAS - dw) / 2),
      Math.round((CANVAS - dh) / 2),
      dw,
      dh,
    )

    const webp = out.toDataURL('image/webp', 0.92)
    if (webp.startsWith('data:image/webp')) return webp
    return out.toDataURL('image/png')
  } finally {
    bitmap.close?.()
  }
}
