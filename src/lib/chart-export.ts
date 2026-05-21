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

// Matches `.chart-frame-animated::before { background: #E85D2A }`
// in globals.css. Keeping the colours and ring thickness in sync
// with the CSS is what makes the exported GIF look identical to
// what the user sees on the page.
const BRAND_ORANGE = '232, 93, 42'
const RING_THICKNESS = 2
const CHART_BORDER_RADIUS = 12
// Pulse range matches the `chart-strobe` keyframe in globals.css
// (opacity 0.4 -> 1 -> 0.4 over one loop).
const STROBE_MIN_OPACITY = 0.4
const STROBE_MAX_OPACITY = 1.0

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
 * Capture the chart as a PNG blob. Returns `null` on failure so
 * the caller can surface a friendly error without a thrown
 * exception interrupting the render loop.
 */
export async function captureChartPng(node: HTMLElement): Promise<Blob> {
  const canvas = await captureChartCanvas(node, 2)
  return canvasToBlob(canvas, 'image/png')
}

/**
 * Compute the strobe opacity at a given loop progress (0..1).
 * Smooth in/out sine wave between `STROBE_MIN_OPACITY` and
 * `STROBE_MAX_OPACITY`. One full pulse per loop, matching the
 * `chart-strobe` keyframe in globals.css.
 */
function strobeOpacity(progress: number): number {
  // sin shifted so progress=0 starts at min, progress=0.5 hits max,
  // progress=1 returns to min. Same shape as the CSS keyframe.
  const wave = (1 - Math.cos(progress * Math.PI * 2)) / 2 // 0..1..0
  return STROBE_MIN_OPACITY + (STROBE_MAX_OPACITY - STROBE_MIN_OPACITY) * wave
}

/**
 * Draw a single frame of the brand-orange strobing outline around
 * the perimeter of the canvas. `progress` is the position in the
 * loop (0..1); the outline stays put and only its opacity pulses
 * per the strobe wave.
 *
 * Implementation mirrors the on-screen CSS effect in globals.css:
 * the chart's `::before` pseudo-element is a flat orange box
 * positioned one ring outside the chart, with its opacity animated
 * by the `chart-strobe` keyframe. Here we build the same effect
 * by clipping to a thin perimeter ring (outer rounded rect minus
 * inner rounded rect, evenodd fill) and filling that ring with
 * flat orange at the strobe's current opacity.
 *
 * Why we don't sweep / rotate: a rotating highlight needs the
 * gradient origin to live somewhere (canvas centre is the only
 * sensible choice), but a conic-gradient with a thick highlight
 * lobe inevitably reads as a fat moving wedge in the GIF -- it
 * was the chunky-rotation look you saw before. A pulsing flat
 * outline doesn't have that geometry, and it matches the site.
 */
function drawSweepBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
) {
  const ring = RING_THICKNESS
  const opacity = strobeOpacity(progress)

  ctx.save()

  // Annulus clip: outer rounded rect minus inner rounded rect, with
  // evenodd winding so only the thin ring between them paints. This
  // is the canvas analogue of the CSS `::before` sitting at
  // `inset: -2px` over an opaque chart background.
  const outerR = CHART_BORDER_RADIUS
  const innerR = Math.max(outerR - ring, 1)
  ctx.beginPath()
  ctx.roundRect(0, 0, width, height, outerR)
  ctx.roundRect(ring, ring, width - 2 * ring, height - 2 * ring, innerR)
  ctx.clip('evenodd')

  ctx.fillStyle = `rgba(${BRAND_ORANGE}, ${opacity.toFixed(3)})`
  ctx.fillRect(0, 0, width, height)
  ctx.restore()
}

/**
 * Composite a single GIF frame onto `out`: draw the static chart
 * canvas first, then overlay the strobing outline at the given
 * loop progress. Returns the raw RGBA byte buffer for the encoder.
 *
 * `imageSmoothingQuality = 'high'` is critical when the base canvas
 * is larger than the GIF (e.g. retina capture downscaled to fit the
 * file-size cap) -- the default bilinear filter produces visibly
 * soft card art, whereas the 'high' setting (Lanczos-ish on most
 * browsers) keeps edges crisp.
 */
function renderGifFrame(
  out: HTMLCanvasElement,
  baseCanvas: HTMLCanvasElement,
  progress: number,
): Uint8ClampedArray {
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, out.width, out.height)
  ctx.drawImage(baseCanvas, 0, 0, out.width, out.height)
  drawSweepBorder(ctx, out.width, out.height, progress)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

export interface GifOptions {
  /**
   * Number of frames in the loop. The strobe is a smooth pulse
   * (not a sweep), so we don't need as many frames as a rotation
   * would. 18 frames at 10 fps gives a 1.8s loop that matches the
   * `chart-strobe 1.8s` animation in globals.css exactly.
   */
  numFrames?: number
  /**
   * Frames per second. 10 fps with 18 frames gives a 1.8s loop.
   * Browsers clamp GIF delays to a 10ms minimum, so don't push
   * fps too high or the player will silently slow down.
   */
  fps?: number
  /**
   * Maximum width of the output GIF, in pixels. The captured
   * chart canvas is downscaled to fit. 1100px gives card art
   * enough pixels to stay sharp after palette quantization
   * while keeping a typical 6-tier board comfortably under
   * Twitter's 15MB GIF cap (the trimmed-down 2px outline helps
   * the encoder too -- less orange noise means more palette
   * budget for the actual card images).
   */
  maxWidth?: number
  /**
   * Draw the animated strobing outline on top of each frame.
   * When `false`, the encoder emits a single static frame --
   * useful when the on-screen border toggle is off and the
   * user wants the export to match what they're previewing.
   * Default: `true`.
   */
  withBorder?: boolean
}

/**
 * Encode the chart as an animated GIF with a strobing outline
 * that pulses on a loop. Pipeline:
 *
 *  1. Capture the chart DOM node to a canvas once (html-to-image).
 *  2. Downscale to `maxWidth` for a reasonable file size.
 *  3. For each frame, composite the downscaled chart + the
 *     strobing outline at this frame's pulse opacity onto a
 *     working canvas.
 *  4. Quantize once from a representative frame and reuse the
 *     palette for every frame -- avoids palette flicker between
 *     frames and lets the encoder elide redundant palette tables.
 *  5. Encode all frames into a single GIF blob via `gifenc`.
 */
export async function captureChartGif(
  node: HTMLElement,
  options: GifOptions = {},
): Promise<Blob> {
  const numFrames = options.numFrames ?? 18
  const fps = options.fps ?? 10
  const maxWidth = options.maxWidth ?? 1100
  const withBorder = options.withBorder ?? true

  // Capture at pixelRatio 2 to match the PNG path. The 1.5x
  // sample we used before was a false economy -- it produced a
  // base canvas that was already softer than the screen, then we
  // downscaled it further to fit `maxWidth`, compounding the blur.
  // At 2x we get a sharp super-sample that downscales cleanly via
  // the 'high' smoothing quality set in `renderGifFrame`.
  const baseCanvas = await captureChartCanvas(node, 2)

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

  if (!withBorder) {
    // Static GIF path: render one frame (the bare chart, no
    // sweep), quantize it, and write a single-frame GIF. This
    // exists so the export matches the on-screen preview when
    // the user turns the animated-border toggle off -- they
    // get a still GIF instead of a surprise animation.
    const ctx = frameCanvas.getContext('2d')
    if (!ctx) throw new Error('2D context unavailable')
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'
    ctx.clearRect(0, 0, w, h)
    ctx.drawImage(baseCanvas, 0, 0, w, h)
    const data = ctx.getImageData(0, 0, w, h).data
    const palette = quantize(data, 256)
    const indexed = applyPalette(data, palette)
    encoder.writeFrame(indexed, w, h, { palette, delay })
    encoder.finish()
    const outStatic = new Uint8Array(encoder.bytes())
    return new Blob([outStatic.buffer], { type: 'image/gif' })
  }

  // Derive the palette from the strobe at peak brightness
  // (progress=0.5, opacity=1) so the brightest orange has a
  // dedicated palette entry. Quantizing a dim frame instead
  // would clip the highlight to muddy beige.
  const representative = renderGifFrame(frameCanvas, baseCanvas, 0.5)
  const palette = quantize(representative, 256)

  for (let i = 0; i < numFrames; i++) {
    // Loop progress 0..1, evenly spaced. The strobe wave makes
    // this cycle pulse min -> max -> min in one full loop.
    const progress = i / numFrames
    const frame = renderGifFrame(frameCanvas, baseCanvas, progress)
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
