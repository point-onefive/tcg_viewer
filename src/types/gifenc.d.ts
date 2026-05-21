/**
 * Minimal type shims for `gifenc`, which ships without a `.d.ts`.
 * Only the surface we use in `src/lib/chart-export.ts` is typed
 * here -- extend as more of the gifenc API is adopted. Reference:
 * https://github.com/mattdesl/gifenc#readme
 */
declare module 'gifenc' {
  export interface GIFEncoderFrameOptions {
    /** Indexed palette to write with this frame. */
    palette?: number[][]
    /** Frame display delay in milliseconds. */
    delay?: number
    /** Transparent palette index, if any. */
    transparent?: boolean | number
    /** Disposal method (0=any, 1=keep, 2=restore-bg, 3=restore-prev). */
    dispose?: number
    /** Loop count for the *first* frame (0 = forever). */
    repeat?: number
  }

  export interface GIFEncoderInstance {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: GIFEncoderFrameOptions,
    ): void
    writeHeader(): void
    finish(): void
    bytes(): Uint8Array
    bytesView(): Uint8Array
    reset(): void
  }

  export interface GIFEncoderOptions {
    /** Whether to write the GIF89a header automatically on first frame. */
    auto?: boolean
    /** Initial buffer capacity hint. */
    initialCapacity?: number
  }

  export function GIFEncoder(opts?: GIFEncoderOptions): GIFEncoderInstance

  export type QuantizeFormat = 'rgb565' | 'rgb444' | 'rgba4444'

  export interface QuantizeOptions {
    format?: QuantizeFormat
    oneBitAlpha?: boolean | number
    clearAlpha?: boolean
    clearAlphaThreshold?: number
    clearAlphaColor?: number
  }

  /** Build a 256-colour palette from RGBA pixel data. */
  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions,
  ): number[][]

  /** Map RGBA pixel data to indices in the given palette. */
  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: number[][],
    format?: QuantizeFormat,
  ): Uint8Array
}
