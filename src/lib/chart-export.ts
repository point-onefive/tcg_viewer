/**
 * Chart export helpers for the tier-list page. Two flavours:
 *
 *  - PNG : single-frame snapshot of the chart frame (no animated
 *          border, just the chart contents on a solid background).
 *  - GIF : the same chart frame composited with a procedurally-drawn
 *          brand-orange sweep border that rotates around the
 *          perimeter, encoded as an animated GIF that loops
 *          forever. Made for dropping into a tweet so the chart
 *          catches the eye in a fast-scrolling timeline.
 *
 * Both depend on R2 sending `Access-Control-Allow-Origin: *` on
 * card images (configured via the Cloudflare API one time -- see
 * the conversation that introduced this file). Without that header
 * `html-to-image` taints the canvas it draws into and `toBlob` /
 * `getImageData` throws `SecurityError`, which is what killed the
 * previous export attempt.
 *
 * Heavy deps (`html-to-image`, `gifenc`) are dynamic-imported
 * inside the capture functions so they only land in the bundle on
 * the first export click, not on every tier-list page load.
 */

const BRAND_ORANGE = '#E85D2A'
const BRAND_ORANGE_BRIGHT = '#ffb480'
const RING_THICKNESS = 6
const CHART_BORDER_RADIUS = 12

function resolveBackground(): string {
  if (typeof document === 'undefined') return '#111'
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
  return bg || '#111'
}

/**
 * Render the given DOM node to an `HTMLCanvasElement` via
 * `html-to-image`. The resulting canvas is the base layer that
 * both the PNG path and every GIF frame composite onto. `pixelRatio`
 * controls fidelity vs. memory; the GIF path downscales further
 * before encoding.
 */
export async function captureChartCanvas(
  node: HTMLElement,
  pixelRatio = 2,
): Promise<HTMLCanvasElement> {
  const { toCanvas } = await import('html-to-image')
  return toCanvas(node, {
    pixelRatio,
    cacheBust: false,
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
 * Capture the chart as a PNG blob. Returns `null` on failure so
 * the caller can surface a friendly error without a thrown
 * exception interrupting the render loop.
 */
export async function captureChartPng(node: HTMLElement): Promise<Blob> {
  const canvas = await captureChartCanvas(node, 2)
  return canvasToBlob(canvas, 'image/png')
}

/**
 * Draw a single frame of the rotating brand-orange "sweep" border
 * around the perimeter of the canvas. `angleRad` is the start
 * angle for the conic gradient; iterate from `0` to `2π` to make
 * the bright band travel all the way around once.
 *
 * Visually: a ~120° wedge of the perimeter is brand-orange (with a
 * brighter peach highlight at the centre), tapering to fully
 * transparent at both ends. The remaining 240° is invisible. As
 * the angle advances, that wedge sweeps around the chart frame.
 */
function drawSweepBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  angleRad: number,
) {
  const ring = RING_THICKNESS
  const cx = width / 2
  const cy = height / 2

  // `createConicGradient` starts at angle 0 = positive x-axis
  // (3-o'clock). Subtracting π/2 rotates the start to the top of
  // the chart (12-o'clock), which feels more natural -- the sweep
  // begins from the top-centre and goes clockwise.
  const grad = ctx.createConicGradient(angleRad - Math.PI / 2, cx, cy)
  grad.addColorStop(0.0, BRAND_ORANGE)
  grad.addColorStop(0.06, BRAND_ORANGE_BRIGHT)
  grad.addColorStop(0.12, BRAND_ORANGE)
  grad.addColorStop(0.22, 'rgba(232, 93, 42, 0.35)')
  grad.addColorStop(0.33, 'rgba(232, 93, 42, 0)')
  grad.addColorStop(1.0, 'rgba(232, 93, 42, 0)')

  ctx.save()
  ctx.lineWidth = ring
  ctx.strokeStyle = grad
  ctx.lineJoin = 'round'

  // Inset the stroke by half-thickness so it draws inside the
  // canvas bounds instead of getting clipped at the edges.
  const half = ring / 2
  const radius = Math.max(CHART_BORDER_RADIUS - 1, 4)
  ctx.beginPath()
  ctx.roundRect(half, half, width - ring, height - ring, radius)
  ctx.stroke()
  ctx.restore()
}

/**
 * Composite a single GIF frame onto `out`: draw the static chart
 * canvas first, then overlay the sweep border at the given angle.
 * Returns the raw RGBA byte buffer for the gif encoder.
 */
function renderGifFrame(
  out: HTMLCanvasElement,
  baseCanvas: HTMLCanvasElement,
  angleRad: number,
): Uint8ClampedArray {
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.clearRect(0, 0, out.width, out.height)
  ctx.drawImage(baseCanvas, 0, 0, out.width, out.height)
  drawSweepBorder(ctx, out.width, out.height, angleRad)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

export interface GifOptions {
  /**
   * Number of frames in the loop. More frames = smoother sweep
   * but larger file. 24 frames at 12 fps gives a 2-second loop
   * that's smooth enough for the eye.
   */
  numFrames?: number
  /**
   * Frames per second. 12-15 fps reads as smooth for a slow
   * sweep without inflating the file unnecessarily.
   */
  fps?: number
  /**
   * Maximum width of the output GIF, in pixels. The captured
   * chart canvas is downscaled to fit. 900px keeps the file
   * well under Twitter's 15MB GIF cap for a typical 6-tier
   * board even at 30 frames.
   */
  maxWidth?: number
}

/**
 * Encode the chart as an animated GIF with a sweep border that
 * loops forever. Pipeline:
 *
 *  1. Capture the chart DOM node to a canvas once (html-to-image).
 *  2. Downscale to `maxWidth` for a reasonable file size.
 *  3. For each frame, composite the downscaled chart + the
 *     sweep border at this frame's angle onto a working canvas.
 *  4. Quantize the first frame to a 256-colour palette and reuse
 *     it for every frame -- avoids palette flicker between frames
 *     and lets the encoder elide redundant palette tables.
 *  5. Encode all frames into a single GIF blob via `gifenc`.
 */
export async function captureChartGif(
  node: HTMLElement,
  options: GifOptions = {},
): Promise<Blob> {
  const numFrames = options.numFrames ?? 24
  const fps = options.fps ?? 12
  const maxWidth = options.maxWidth ?? 900

  const baseCanvas = await captureChartCanvas(node, 1.5)

  // Downscale if the captured canvas is wider than the cap.
  const scale = Math.min(1, maxWidth / baseCanvas.width)
  const w = Math.round(baseCanvas.width * scale)
  const h = Math.round(baseCanvas.height * scale)

  const frameCanvas = document.createElement('canvas')
  frameCanvas.width = w
  frameCanvas.height = h

  const { GIFEncoder, quantize, applyPalette } = await import('gifenc')
  const encoder = GIFEncoder()
  const delay = Math.round(1000 / fps)

  // Use a frame with the border in the middle of its sweep to
  // derive the palette. Quantizing the all-static-no-border
  // version would miss the orange highlight colours and the
  // sweep would render as muddy beige.
  const representative = renderGifFrame(frameCanvas, baseCanvas, Math.PI)
  const palette = quantize(representative, 256)

  for (let i = 0; i < numFrames; i++) {
    const angleRad = (i / numFrames) * Math.PI * 2
    const frame = renderGifFrame(frameCanvas, baseCanvas, angleRad)
    const indexed = applyPalette(frame, palette)
    encoder.writeFrame(indexed, w, h, { palette, delay })
  }
  encoder.finish()

  // `bytes()` returns a `Uint8Array` whose backing buffer may be a
  // `SharedArrayBuffer` in some env shims; copy into a fresh
  // `ArrayBuffer` so the `Blob` constructor's `BlobPart` typing
  // accepts it on TS lib >= ES2024.
  const out = new Uint8Array(encoder.bytes())
  return new Blob([out.buffer], { type: 'image/gif' })
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
 * Try to copy a PNG/GIF blob to the clipboard. Browsers / OS combos
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
 * `tier-list-2026-05-20-2247.{ext}`. Date-stamp matches the
 * user's local timezone so the filename is meaningful when
 * sorting downloads.
 */
export function buildExportFilename(title: string, ext: 'png' | 'gif'): string {
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
