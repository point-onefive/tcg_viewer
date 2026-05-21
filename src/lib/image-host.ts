/**
 * Helpers for reasoning about card image origins.
 *
 * About 65% of card image URLs in the bundle are hot-linked from
 * Bandai's regional CDNs (en/jp/asia-en/asia-tc/asia-tw) or
 * source.windoent.com (Simplified-Chinese). The rest live on our R2
 * mirror at pub-…r2.dev.
 *
 * Important header gotcha: most Bandai origins respond with
 * `cross-origin-resource-policy: same-site`. That silently blocks any
 * direct cross-origin <img> load from localhost (or any non-Bandai
 * host). The only way these images render in the browser is to proxy
 * them through our own origin — which is exactly what the Next image
 * optimizer (`/_next/image?url=...`) does. Setting
 * `unoptimized={true}` for those URLs is a trap: it bypasses the
 * proxy and the image silently fails to render, leaving the lightbox /
 * tile empty with only the alt text showing.
 *
 * Origins WITHOUT a restrictive CORP header (asia-tw, source.windoent,
 * limitlesstcg) could in principle be loaded directly, but the
 * complexity of branching per-host isn't worth it for ~25% of traffic.
 * Performance work focuses instead on:
 *
 *   - lowering optimizer quality for thumbnails (CardTile q=60)
 *   - reducing virtualizer overscan (fewer mounted tiles per scroll)
 *   - lightbox image windowing (don't mount every variant at once)
 *   - eventually mirroring more languages to R2 so we hot-link less
 *
 * `isR2Hosted` is exposed in case future code wants to make per-host
 * decisions; today neither CardTile nor LightboxViewer call it because
 * both always route through the optimizer.
 */

const R2_PUBLIC_HOST = 'pub-6d5072ccd26a467db70791436c203abb.r2.dev'

export function isR2Hosted(src: string | null | undefined): boolean {
  if (!src) return false
  if (src.includes(R2_PUBLIC_HOST)) return true
  try {
    return new URL(src).hostname === R2_PUBLIC_HOST
  } catch {
    return false
  }
}
