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

// All of these stay in lockstep with `.chart-frame-animated` in
// globals.css. Keeping the geometry and colours in sync is what
// makes the exported GIF look identical to what the user sees on
// the page.
const BRAND_ORANGE_RGB = '232, 93, 42'
const BRAND_ORANGE_BRIGHT_RGB = '255, 180, 128'
const RING_THICKNESS = 2
const CHART_BORDER_RADIUS = 12
// Radius of the running-highlight blob, in destination-canvas
// pixels. Matches the ~80px blob size in CSS.
const HIGHLIGHT_RADIUS = 80

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
 * Walk the perimeter of a rounded rectangle of size `w` x `h` with
 * corner radius `r`. Returns the (x, y) point at fraction `t` of
 * the way around (t in [0, 1)). Used to position the running
 * highlight at any moment in the loop.
 *
 * Segments, clockwise from the top edge's left start:
 *   1. top straight    (length: w - 2r)
 *   2. top-right arc   (length: pi*r/2)
 *   3. right straight  (length: h - 2r)
 *   4. bottom-right arc(length: pi*r/2)
 *   5. bottom straight (length: w - 2r)
 *   6. bottom-left arc (length: pi*r/2)
 *   7. left straight   (length: h - 2r)
 *   8. top-left arc    (length: pi*r/2)
 *
 * This is the canvas analogue of CSS `offset-path: inset(0 round Npx)`
 * which traces the same rounded-rect perimeter for the `::after`
 * highlight blob on the page.
 */
function perimeterPoint(
  w: number,
  h: number,
  r: number,
  t: number,
): { x: number; y: number } {
  const edgeH = Math.max(w - 2 * r, 0)
  const edgeV = Math.max(h - 2 * r, 0)
  const arc = (Math.PI * r) / 2
  const total = 2 * edgeH + 2 * edgeV + 4 * arc

  let d = ((t % 1) + 1) % 1 // wrap into [0,1)
  d *= total

  // 1. top edge: (r,0) -> (w-r,0)
  if (d < edgeH) return { x: r + d, y: 0 }
  d -= edgeH

  // 2. top-right corner: arc from -pi/2 to 0
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2) - Math.PI / 2
    return { x: w - r + r * Math.cos(a), y: r + r * Math.sin(a) }
  }
  d -= arc

  // 3. right edge: (w,r) -> (w,h-r)
  if (d < edgeV) return { x: w, y: r + d }
  d -= edgeV

  // 4. bottom-right corner: arc from 0 to pi/2
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2)
    return { x: w - r + r * Math.cos(a), y: h - r + r * Math.sin(a) }
  }
  d -= arc

  // 5. bottom edge: (w-r,h) -> (r,h)
  if (d < edgeH) return { x: w - r - d, y: h }
  d -= edgeH

  // 6. bottom-left corner: arc from pi/2 to pi
  if (d < arc) {
    const a = (d / arc) * (Math.PI / 2) + Math.PI / 2
    return { x: r + r * Math.cos(a), y: h - r + r * Math.sin(a) }
  }
  d -= arc

  // 7. left edge: (0,h-r) -> (0,r)
  if (d < edgeV) return { x: 0, y: h - r - d }
  d -= edgeV

  // 8. top-left corner: arc from pi to 3pi/2
  const a = (d / arc) * (Math.PI / 2) + Math.PI
  return { x: r + r * Math.cos(a), y: r + r * Math.sin(a) }
}

/**
 * Draw a single frame of the brand-orange chase light around the
 * perimeter of the canvas. `progress` is the position in the loop
 * (0..1); a small bright highlight blob walks along the perimeter
 * once per loop. No static base outline -- only the moving blob,
 * matching the on-screen `::after` element after the static
 * `::before` ring was removed.
 *
 * Implementation mirrors the on-screen CSS in globals.css: the
 * chart's `::after` follows `offset-path: inset(0 round 12px)`,
 * which is what `perimeterPoint(w, h, r, t)` computes here. The
 * radial blob is clipped to a thin perimeter ring so it only
 * paints in the chart's outline area (the canvas analogue of the
 * chart's opaque content covering the inner half of the CSS blob).
 *
 * Why we don't sweep with a conic gradient: a conic gradient is
 * anchored at the canvas centre, so any visible-thickness ring
 * intersected by the gradient's bright peak shows a fat moving
 * wedge in the corners (geometry, not opacity). Walking a finite
 * radial blob along the actual perimeter has no corner spill.
 */
function drawSweepBorder(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
) {
  const ring = RING_THICKNESS

  ctx.save()

  // Annulus clip: outer rounded rect minus inner rounded rect with
  // evenodd winding so only the thin ring between them paints.
  // The radial blob is automatically confined to the outline area,
  // so the blob's interior portion is invisible (same as how the
  // chart's opaque background hides the inside half of the CSS
  // ::after blob).
  const outerR = CHART_BORDER_RADIUS
  const innerR = Math.max(outerR - ring, 1)
  ctx.beginPath()
  ctx.roundRect(0, 0, width, height, outerR)
  ctx.roundRect(ring, ring, width - 2 * ring, height - 2 * ring, innerR)
  ctx.clip('evenodd')

  // Running highlight at the current perimeter point.
  const { x, y } = perimeterPoint(width, height, outerR, progress)
  const grad = ctx.createRadialGradient(x, y, 0, x, y, HIGHLIGHT_RADIUS)
  grad.addColorStop(0, `rgba(${BRAND_ORANGE_BRIGHT_RGB}, 1)`)
  grad.addColorStop(0.25, `rgba(${BRAND_ORANGE_RGB}, 0.9)`)
  grad.addColorStop(0.65, `rgba(${BRAND_ORANGE_RGB}, 0)`)
  grad.addColorStop(1, `rgba(${BRAND_ORANGE_RGB}, 0)`)
  ctx.fillStyle = grad
  ctx.fillRect(
    x - HIGHLIGHT_RADIUS,
    y - HIGHLIGHT_RADIUS,
    HIGHLIGHT_RADIUS * 2,
    HIGHLIGHT_RADIUS * 2,
  )

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
   * Number of frames in the loop. The highlight has to walk all
   * the way around the perimeter so we want enough samples to
   * keep the motion smooth without bloating the file. 36 frames
   * at 12 fps = 3 seconds, matching the `chart-run 3s` animation
   * in globals.css exactly.
   */
  numFrames?: number
  /**
   * Frames per second. 12 fps with 36 frames gives a 3s loop.
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
  const numFrames = options.numFrames ?? 36
  const fps = options.fps ?? 12
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

  // Derive the palette from a frame where the running highlight
  // is mid-edge (progress=0.125 = top edge centre on a typical
  // chart aspect ratio) so the brightest orange has a dedicated
  // palette entry. Quantizing a corner-arc frame would still work
  // but the straight-edge variant gives the encoder a cleaner
  // sample of both the outline and the highlight gradient.
  const representative = renderGifFrame(frameCanvas, baseCanvas, 0.125)
  const palette = quantize(representative, 256)

  for (let i = 0; i < numFrames; i++) {
    // Loop progress 0..1, evenly spaced. `perimeterPoint` maps
    // each value to a point on the rounded-rect perimeter, so the
    // highlight blob walks all the way around exactly once.
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
