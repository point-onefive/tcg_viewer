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
// globals.css. Keeping the geometry, colours, and timing in sync
// is what makes the exported GIF look identical to what the user
// sees on the page.
const BRAND_ORANGE_RGB = '232, 93, 42'
// CSS border-radius applied to the chart frame in
// tier-list-maker.tsx (`rounded-[12px]`). The runtime border
// radius in the GIF's output coordinate space is this value
// scaled by `pixelRatio * downscaleFactor`, computed at draw
// time so the outline hugs the actual captured corner.
const CSS_BORDER_RADIUS_PX = 12
// Pixel ratio used by `captureChartCanvas` in the GIF path.
// Match this constant if you change the call below.
const GIF_CAPTURE_PIXEL_RATIO = 2
// Thickness of the blip outline in output pixels. 2 matches
// `inset: -2px` on the CSS `::before`.
const BLIP_LINE_WIDTH = 2
// Opacity at the dim baseline (most frames). Matches the
// `chart-blip` keyframe in globals.css.
const BLIP_DIM = 0.3
// Opacity at the peak of the blip flash.
const BLIP_PEAK = 1.0
// Opacity at the post-peak shoulder (matches the 40% keyframe).
const BLIP_SHOULDER = 0.45

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
 * Compute the blip outline's opacity at a given loop progress
 * (0..1). Piecewise-linear interpolation through the same
 * keyframes as the `chart-blip` animation in globals.css:
 *
 *   progress 0.00 -> BLIP_DIM        (baseline)
 *   progress 0.20 -> BLIP_PEAK       (bright flash)
 *   progress 0.40 -> BLIP_SHOULDER   (post-peak shoulder)
 *   progress 1.00 -> BLIP_DIM        (back to baseline)
 *
 * Keeping this in lockstep with the CSS keyframes is what makes
 * the exported GIF read identically to the on-page preview.
 */
function blipOpacity(progress: number): number {
  const p = ((progress % 1) + 1) % 1
  if (p < 0.2) {
    // Ramp up to the peak.
    const t = p / 0.2
    return BLIP_DIM + (BLIP_PEAK - BLIP_DIM) * t
  }
  if (p < 0.4) {
    // Fast drop from peak to shoulder.
    const t = (p - 0.2) / 0.2
    return BLIP_PEAK - (BLIP_PEAK - BLIP_SHOULDER) * t
  }
  // Slow fade from shoulder back to baseline over the rest of the
  // loop, so the blip reads as a decaying flash instead of a
  // two-state strobe.
  const t = (p - 0.4) / 0.6
  return BLIP_SHOULDER - (BLIP_SHOULDER - BLIP_DIM) * t
}

/**
 * Draw a single frame of the brand-orange "blip" outline around
 * the perimeter of the canvas. The outline never moves; its
 * opacity flashes from dim to bright once per loop. The shape is
 * a solid stroked rounded-rectangle that hugs the chart's
 * captured rounded corners.
 *
 * Why this is GIF-friendly:
 *   - Solid colour (no gradient) so the 256-colour palette only
 *     needs a handful of orange shades for the whole loop.
 *   - Same shape every frame, only the colour changes -> the
 *     encoder's frame compression actually helps because most
 *     pixels are identical across consecutive frames.
 *   - Most frames live near the dim baseline, so they share one
 *     palette entry and compress especially well.
 *
 * `borderRadius` is passed from the caller because the captured
 * canvas's actual corner radius depends on the capture's
 * pixelRatio and downscale factor, not the raw CSS value.
 */
function drawBlipOutline(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  borderRadius: number,
) {
  const opacity = blipOpacity(progress)
  ctx.save()
  ctx.strokeStyle = `rgba(${BRAND_ORANGE_RGB}, ${opacity.toFixed(3)})`
  ctx.lineWidth = BLIP_LINE_WIDTH
  // Inset the stroke by half its thickness so it draws inside the
  // canvas bounds instead of being clipped at the edges. Inner
  // radius is shrunk by the same amount so the stroke's outer
  // edge still matches the captured chart's rounded corners.
  const inset = BLIP_LINE_WIDTH / 2
  ctx.beginPath()
  ctx.roundRect(
    inset,
    inset,
    width - BLIP_LINE_WIDTH,
    height - BLIP_LINE_WIDTH,
    Math.max(borderRadius - inset, 1),
  )
  ctx.stroke()
  ctx.restore()
}

/**
 * Composite a single GIF frame onto `out`: draw the static chart
 * canvas first, then overlay the blip outline at the given loop
 * progress. Returns the raw RGBA byte buffer for the encoder.
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
  borderRadius: number,
): Uint8ClampedArray {
  const ctx = out.getContext('2d')
  if (!ctx) throw new Error('2D context unavailable')
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, out.width, out.height)
  ctx.drawImage(baseCanvas, 0, 0, out.width, out.height)
  drawBlipOutline(ctx, out.width, out.height, progress, borderRadius)
  return ctx.getImageData(0, 0, out.width, out.height).data
}

export interface GifOptions {
  /**
   * Number of frames in the loop. The blip animation is mostly
   * a static dim outline with a brief flash; ~25 frames is plenty
   * to render the flash smoothly without bloating the file. 25
   * frames at 10 fps = 2.5s, matching the `chart-blip 2.5s`
   * animation in globals.css exactly.
   */
  numFrames?: number
  /**
   * Frames per second. 10 fps with 25 frames gives a 2.5s loop.
   * Browsers clamp GIF delays to a 10ms minimum, so don't push
   * fps too high or the player will silently slow down.
   */
  fps?: number
  /**
   * Maximum width of the output GIF, in pixels. The captured
   * chart canvas is downscaled to fit. 1100px gives card art
   * enough pixels to stay sharp after palette quantization
   * while keeping a typical 6-tier board comfortably under
   * Twitter's 15MB GIF cap. The blip outline is just a thin
   * stroked rectangle, so it adds negligible bytes per frame.
   */
  maxWidth?: number
  /**
   * Draw the animated blip outline on top of each frame.
   * When `false`, the encoder emits a single static frame --
   * useful when the on-screen border toggle is off and the
   * user wants the export to match what they're previewing.
   * Default: `true`.
   */
  withBorder?: boolean
}

/**
 * Encode the chart as an animated GIF with the brand-orange blip
 * outline animation. Pipeline:
 *
 *  1. Capture the chart DOM node to a canvas once (html-to-image).
 *  2. Downscale to `maxWidth` for a reasonable file size.
 *  3. For each frame, composite the downscaled chart + the blip
 *     outline at this frame's opacity onto a working canvas.
 *  4. Quantize once from a representative frame (the bright peak)
 *     and reuse the palette for every frame -- avoids palette
 *     flicker and lets the encoder elide redundant palette tables.
 *  5. Encode all frames into a single GIF blob via `gifenc`.
 */
export async function captureChartGif(
  node: HTMLElement,
  options: GifOptions = {},
): Promise<Blob> {
  const numFrames = options.numFrames ?? 25
  const fps = options.fps ?? 10
  const maxWidth = options.maxWidth ?? 1100
  const withBorder = options.withBorder ?? true

  // Capture at pixelRatio 2 to match the PNG path. The 1.5x
  // sample we used before was a false economy -- it produced a
  // base canvas that was already softer than the screen, then we
  // downscaled it further to fit `maxWidth`, compounding the blur.
  // At 2x we get a sharp super-sample that downscales cleanly via
  // the 'high' smoothing quality set in `renderGifFrame`.
  const baseCanvas = await captureChartCanvas(node, GIF_CAPTURE_PIXEL_RATIO)

  // Downscale if the captured canvas is wider than the cap.
  const scale = Math.min(1, maxWidth / baseCanvas.width)
  const w = Math.round(baseCanvas.width * scale)
  const h = Math.round(baseCanvas.height * scale)

  // Border radius in output coordinates. The chart is rendered
  // with `rounded-[12px]` in CSS, captured at pixelRatio 2, then
  // downscaled by `scale`. Hardcoding 12 here would drift off the
  // captured chart's actual corners the moment the chart is wider
  // than maxWidth / pixelRatio (i.e. anything wider than 550 CSS
  // px on a 2x retina) -- the chase light would walk inside or
  // outside the visible corner curve depending on direction.
  const borderRadius = CSS_BORDER_RADIUS_PX * GIF_CAPTURE_PIXEL_RATIO * scale

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

  // Derive the palette from the bright-peak frame (progress=0.2,
  // opacity=BLIP_PEAK) so the brightest orange has a dedicated
  // palette entry. Quantizing a baseline-dim frame would still
  // work but the peak frame guarantees the flash colour is
  // sampled at full intensity.
  const representative = renderGifFrame(frameCanvas, baseCanvas, 0.2, borderRadius)
  const palette = quantize(representative, 256)

  for (let i = 0; i < numFrames; i++) {
    // Loop progress 0..1, evenly spaced. `blipOpacity` maps each
    // value to an outline opacity, so the loop renders one full
    // dim -> peak -> dim cycle.
    const progress = i / numFrames
    const frame = renderGifFrame(frameCanvas, baseCanvas, progress, borderRadius)
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
