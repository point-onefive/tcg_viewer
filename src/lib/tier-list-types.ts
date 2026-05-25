/**
 * Shared types + defaults for the tier-list page. Lifted out of
 * `components/tier-list/tier-list-maker.tsx` so the Zustand store
 * (`lib/store.ts`) can reference them without creating a backwards
 * `lib → components` dependency cycle. The page now reads / writes
 * its `tiers`, `cards`, and `title` from the store so navigating away
 * to the gallery and back preserves the whole working board.
 */

export type TierDef = {
  id: string
  label: string
  color: string
}

/**
 * Where a tier card image came from. Drives the rendered aspect ratio:
 *
 * - `gallery` - added via the "Add to tier list pool" button on a card
 *   in the main wall. Rendered portrait at the standard TCG card
 *   aspect (5:7) with `object-contain` so the full card art + frame
 *   is always visible (no cropping of the card title, cost, etc.).
 *
 * - `upload` - uploaded from disk or pasted from the clipboard. We
 *   render these at their NATURAL aspect ratio with `object-contain`
 *   so nothing the user pasted is cropped. Height is locked to
 *   `THUMB_H_PORTRAIT` (matching gallery rows so the tier strip
 *   stays vertically aligned) and width floats according to the
 *   intrinsic image dimensions — wide screenshots get wide tiles,
 *   portrait phone pics get narrow tiles, squares stay square.
 */
export type TierCardKind = 'gallery' | 'upload'

export type TierCard = {
  id: string
  src: string
  tierId: string | null
  kind: TierCardKind
  /**
   * Human-readable label for gallery cards (e.g. `"Roronoa Zoro"` or
   * `"Roronoa Zoro · p1"` for alt-art). Populated from the matching
   * `TierPoolItem` when the card is added from the main gallery.
   * Uploaded images don't have one - the Roster section will fall
   * back to `"Uploaded image"` for those.
   */
  label?: string
  /**
   * Intrinsic image aspect ratio (width / height) for `upload`
   * cards. Captured asynchronously when the file is decoded so the
   * tile renders at the pasted image's natural shape instead of
   * being cropped to a square. Undefined until the decode resolves
   * (and always undefined for `gallery` cards — those use the
   * canonical 5:7 TCG ratio).
   */
  aspectRatio?: number
}

/**
 * Factory rather than a frozen constant so each caller gets a fresh
 * array with fresh tier objects. The Zustand store's `resetTierBoard`
 * action calls this every time the user hits "Reset" so the next
 * round of edits never aliases back into the previous board's
 * tier-row instances (no spooky-action-at-a-distance bugs where two
 * boards share the same mutable row).
 */
export function defaultTiers(): TierDef[] {
  return [
    { id: 't-s', label: 'S', color: '#ff5a5f' },
    { id: 't-a', label: 'A', color: '#f6b352' },
    { id: 't-b', label: 'B', color: '#f6e58d' },
    { id: 't-c', label: 'C', color: '#9adf7f' },
  ]
}
