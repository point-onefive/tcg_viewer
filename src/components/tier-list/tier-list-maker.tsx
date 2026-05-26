'use client'

import Link from 'next/link'
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  rectSortingStrategy,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import { defaultTiers, tiersMatchDefault, type TierCard, type TierCardKind, type TierDef } from '@/lib/tier-list-types'
import {
  Check,
  ClipboardList,
  Copy,
  GripVertical,
  Image as ImageIcon,
  ImagePlus,
  Inbox,
  Layers,
  Loader2,
  Plus,
  RotateCcw,
  Trash2,
  Trophy,
  Upload,
} from 'lucide-react'
import {
  buildExportFilename,
  captureChartPng,
  copyBlobToClipboard,
  downloadBlob,
} from '@/lib/chart-export'
import { ThemeToggle } from '@/components/gallery/theme-toggle'

// `TierDef`, `TierCard`, `TierCardKind`, and `defaultTiers()` now
// live in `@/lib/tier-list-types` so the Zustand store can reference
// them (the page persists this state across navigation). Re-exported
// for any caller still importing from this module.
export type { TierDef, TierCard, TierCardKind } from '@/lib/tier-list-types'

/**
 * Row height shared by every tier tile. Derived from the standard
 * TCG card ratio (5:7) so portrait gallery cards land at ~78×109 with
 * no cropping. Upload tiles pin the same height and let their width
 * float by aspect ratio — squares become 109×109, 16:9 screenshots
 * become ~194×109, etc.
 *
 * `THUMB_W_DEFAULT` is the fallback width for an upload that hasn't
 * decoded yet (we don't know its intrinsic dimensions until the
 * browser parses the file). Sized to match the gallery card so a
 * just-pasted tile doesn't shove the row layout twice — once at
 * paste time and again when the natural dimensions arrive.
 */
const THUMB_W_DEFAULT = 78
const THUMB_H_PORTRAIT = Math.round(THUMB_W_DEFAULT * (7 / 5)) // 109

function thumbDimensions(kind: TierCardKind, aspectRatio?: number) {
  if (kind === 'gallery') {
    return { width: THUMB_W_DEFAULT, height: THUMB_H_PORTRAIT, fit: 'contain' as const }
  }
  const width = aspectRatio
    ? Math.max(24, Math.round(THUMB_H_PORTRAIT * aspectRatio))
    : THUMB_W_DEFAULT
  return { width, height: THUMB_H_PORTRAIT, fit: 'contain' as const }
}

/**
 * Cloudflare R2 bucket that hosts the mirrored card images. R2 is
 * configured to send `Access-Control-Allow-Origin: *`, so anything
 * coming from this host can be rendered with `crossOrigin="anonymous"`
 * and drawn into a canvas without tainting it (which is what powers
 * the PNG export below).
 */
const R2_HOSTNAME = 'pub-6d5072ccd26a467db70791436c203abb.r2.dev'

/**
 * Rewrite a remote card image URL so the tier-list page can render
 * it (and html-to-image can capture it) regardless of whether the
 * upstream host serves CORS headers.
 *
 * Background: the tile `<img>` below sets `crossOrigin="anonymous"`
 * so a chart export's canvas isn't tainted. That works for R2
 * mirrors (R2 returns `Access-Control-Allow-Origin: *`) and for
 * `blob:` / `data:` URLs (same-origin by definition), but it
 * breaks for any other host -- the browser refuses to render the
 * image, and the user sees a broken-thumb icon in the pool.
 *
 * That's exactly what happens for off-R2 alt arts and promo cards
 * that point at `www.onepiece-cardgame.com`, `asia-tc.onepiece-cardgame.com`,
 * `source.windoent.com`, etc. None of those hosts send ACAO, so
 * the moment they hit the tier list maker they fail to load.
 *
 * Fix: for any URL that isn't already CORS-safe, route it through
 * Next's image optimizer (`/_next/image?url=…&w=384&q=75`). That
 * endpoint:
 *   - lives on the same origin as the page (no CORS at all)
 *   - is allow-listed for every card-image host in `next.config.js`
 *   - normalises everything to optimised WebP at a thumbnail-sized
 *     resolution that's plenty for both the 78×109 pool tile and
 *     the 2× pixelRatio chart export
 *
 * The width (384) and quality (75) are intentionally picked from the
 * `imageSizes` / `qualities` allow-lists already declared in
 * `next.config.js` so the optimizer doesn't reject the request.
 */
function toCorsSafeImageSrc(src: string): string {
  if (!src) return src
  if (src.startsWith('blob:') || src.startsWith('data:')) return src
  if (src.startsWith('/_next/image')) return src
  if (!src.startsWith('http://') && !src.startsWith('https://')) return src
  try {
    const u = new URL(src)
    if (u.hostname === R2_HOSTNAME) return src
  } catch {
    return src
  }
  return `/_next/image?url=${encodeURIComponent(src)}&w=384&q=75`
}

const ctrlBase: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
}

const accentRing = '2px solid color-mix(in srgb, #E85D2A 50%, transparent)'

/**
 * Section label used for the Pool / Chart / Editor headers below
 * the page lede. Mirrors the visual language of the /help page's
 * <Section> component: a small brand-orange icon, a tracked-out
 * uppercase wordmark, and a tapering orange gradient rule that
 * carries the eye into whatever action sits on the right (Clear
 * pool, Clear chart, etc.).
 *
 * The rule is what makes this helper worth extracting - without
 * it the labels read as plain UI text. With it the page reads as
 * a *document* with named regions, which nudges the tier-list
 * page closer in feel to the chrome-heavy main gallery rather
 * than feeling like a stripped-down secondary tool.
 */
function SectionLabel({
  icon: Icon,
  label,
  right,
}: {
  icon: React.ComponentType<{
    size?: number
    strokeWidth?: number
    style?: React.CSSProperties
    'aria-hidden'?: boolean
  }>
  label: string
  right?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
        <h2
          className="font-display"
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </h2>
      </div>
      <div
        aria-hidden
        className="hidden flex-1 sm:block"
        style={{
          height: 1,
          minWidth: 24,
          background:
            'linear-gradient(to right, color-mix(in srgb, #E85D2A 50%, transparent), transparent)',
        }}
      />
      {right && <div className="ml-auto flex items-center gap-3 sm:ml-0">{right}</div>}
    </div>
  )
}

/**
 * Brand lockup that exactly mirrors the main nav header lockup
 * (mascot chip · "the" · "Card Wall"). Used both for the tier page top-left
 * brand and as the import to keep visual parity.
 */
function BrandLockup() {
  return (
    <span
      className="inline-flex items-stretch overflow-hidden"
      style={{
        background: 'var(--text-primary)',
        color: 'var(--bg)',
        borderRadius: 6,
        height: 30,
      }}
    >
      <span
        className="inline-flex items-center justify-center"
        style={{
          background: 'var(--bg)',
          padding: '0 5px',
          border: '1px solid var(--text-primary)',
          borderRight: 'none',
          borderTopLeftRadius: 6,
          borderBottomLeftRadius: 6,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/site-logo.png"
          alt=""
          aria-hidden
          width={22}
          height={22}
          style={{
            height: 22,
            width: 'auto',
            imageRendering: 'pixelated',
            display: 'block',
          }}
        />
      </span>
      <span
        className="inline-flex items-center whitespace-nowrap"
        style={{
          padding: '0 11px',
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 16,
          lineHeight: 1,
          letterSpacing: '-0.015em',
          textTransform: 'uppercase',
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 11,
            fontWeight: 500,
            fontStyle: 'italic',
            letterSpacing: '0.02em',
            textTransform: 'lowercase',
            opacity: 0.65,
            marginRight: 5,
            lineHeight: 1,
          }}
        >
          the
        </span>
        <span>Card Wall</span>
      </span>
    </span>
  )
}

/**
 * Branded footer stamp that lives below the tier rows inside the board
 * container. Uses the same mascot + wordmark as the nav, no pill fill,
 * so it reads as a faded watermark when the board is exported.
 */
function BoardWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none mt-6 flex items-center justify-center gap-3 opacity-30"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/images/site-logo.png"
        alt=""
        width={28}
        height={28}
        style={{
          height: 28,
          width: 'auto',
          imageRendering: 'pixelated',
          display: 'block',
        }}
      />
      <span
        className="whitespace-nowrap"
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 18,
          lineHeight: 1,
          letterSpacing: '-0.015em',
          textTransform: 'uppercase',
          color: 'var(--text-primary)',
        }}
      >
        <span
          aria-hidden
          style={{
            fontSize: 12,
            fontWeight: 500,
            fontStyle: 'italic',
            letterSpacing: '0.02em',
            textTransform: 'lowercase',
            opacity: 0.7,
            marginRight: 6,
            lineHeight: 1,
          }}
        >
          the
        </span>
        <span>Card Wall</span>
      </span>
    </div>
  )
}

/**
 * Sortable tile = the wrapper + image button + remove (×) button as
 * a single unit. We register `setNodeRef` on the wrapper (not the
 * inner button) for two reasons:
 *
 *   1. The × is absolutely positioned relative to the wrapper. If
 *      the inner button got the sortable transform instead, the ×
 *      would stay put while the image translated to its new slot
 *      during neighbour bumps - visible desync.
 *   2. We want `visibility: hidden` on the whole tile (image + ×)
 *      while it's being actively dragged so only the DragOverlay
 *      clone follows the cursor; applying it to the wrapper does
 *      that in one step.
 *
 * Drag listeners stay on the inner image button so pressing the ×
 * never starts a drag - its onPointerDown also stops propagation
 * defensively in case any sibling listener gets added later.
 */
function SortableCard({
  id,
  src,
  kind,
  aspectRatio,
  onRemove,
}: {
  id: string
  src: string
  kind: TierCardKind
  aspectRatio?: number
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id,
    data: { kind: 'card', id },
  })

  const { width, height, fit } = thumbDimensions(kind, aspectRatio)
  const renderedSrc = toCorsSafeImageSrc(src)

  return (
    <div
      ref={setNodeRef}
      className="group relative tier-list-thumb"
      style={{
        // While this tile is the one being dragged we deliberately
        // skip the transform + transition that useSortable hands us.
        // For the active item, `transform` is the *cursor-delta*
        // (how far the user has dragged); applying that to a
        // visibility:hidden element is invisible during the drag but
        // produces a visible "shake" on release - visibility flips
        // back, the still-applied cursor transform transitions back
        // toward 0, and the post-drop FLIP transform fights it.
        //
        // With both suppressed during isDragging, the source sits
        // hidden at its DOM slot, and on release the only thing
        // useSortable applies is the clean FLIP delta (old slot →
        // new slot), which animates as a single smooth bump.
        transform: isDragging ? undefined : CSS.Translate.toString(transform),
        transition: isDragging ? undefined : transition,
        visibility: isDragging ? 'hidden' : undefined,
        width,
        height,
        flexShrink: 0,
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        zIndex: isDragging ? 50 : undefined,
      }}
    >
      <button
        type="button"
        // draggable={false} + onDragStart preventDefault eliminate the
        // browser's native HTML5 drag preview (a translucent screenshot
        // that macOS browsers attach to image buttons, on top of
        // @dnd-kit's DragOverlay - visible "ghost" above the overlay).
        draggable={false}
        onDragStart={(e) => e.preventDefault()}
        {...listeners}
        {...attributes}
        aria-label="Drag to rank image"
        style={{
          display: 'block',
          width: '100%',
          height: '100%',
          padding: 0,
          margin: 0,
          background: 'transparent',
          border: 'none',
          cursor: 'grab',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={renderedSrc}
          alt=""
          draggable={false}
          // `crossOrigin="anonymous"` forces the browser to load the
          // image with a CORS request (Origin header). Without it,
          // even though R2 now sends `Access-Control-Allow-Origin: *`,
          // the browser may have cached a previous *no-CORS* load
          // that still taints any canvas the image draws into -- and
          // a tainted canvas makes `toBlob()` / `getImageData()`
          // throw SecurityError, which is exactly what kills the
          // chart export the moment a real card lands in a tier.
          // For uploaded `blob:` URLs the attribute is ignored
          // (same-origin), so unconditional is safe.
          crossOrigin="anonymous"
          // Self-heal a stale browser cache. When the same URL
          // exists in HTTP cache from a previous *no-CORS* load,
          // some browsers revalidate via `If-Modified-Since`, get
          // back a 304 without CORS headers, and refuse to use
          // the cached entry -- the image just silently fails to
          // load and the user sees a broken thumb. We catch the
          // failure and retry with a cache-bust query string,
          // which forces a fresh `200` complete with CORS
          // headers. One retry per element, only for remote URLs
          // (blob: uploads can't be cache-busted, and a failed
          // upload shouldn't retry endlessly).
          onError={(e) => {
            const img = e.currentTarget
            if (img.dataset.busted === '1') return
            if (img.src.startsWith('blob:')) return
            img.dataset.busted = '1'
            const sep = img.src.includes('?') ? '&' : '?'
            img.src = `${img.src}${sep}_cb=${Date.now()}`
          }}
          // pointer-events:none forwards every press / drag motion
          // straight to the parent <button>, so the browser never has
          // a chance to initiate native image-drag against the <img>.
          // -webkit-user-drag:none is the Safari/Chrome belt to the
          // draggable:false suspenders.
          style={{
            width: '100%',
            height: '100%',
            objectFit: fit,
            display: 'block',
            pointerEvents: 'none',
            userSelect: 'none',
            WebkitUserSelect: 'none',
            WebkitUserDrag: 'none',
          } as React.CSSProperties}
        />
      </button>
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation()
          onRemove()
        }}
        // Tucked *inside* the top-right corner because the parent
        // `.tier-list-thumb` uses `overflow: hidden` to clip the card
        // image to the rounded corners -- anything positioned outside
        // the tile (negative offsets) would be cut off mid-button.
        // `z-10` keeps the chip painted above the image on every
        // browser, regardless of stacking contexts further up.
        className="absolute right-1 top-1 z-10 flex items-center justify-center rounded-full opacity-0 shadow-md transition group-hover:opacity-100"
        style={{
          width: 22,
          height: 22,
          background: 'var(--text-primary)',
          color: 'var(--bg)',
          border: '1px solid var(--border-subtle)',
          fontSize: 11,
          fontWeight: 700,
        }}
        aria-label="Remove image"
      >
        ✕
      </button>
    </div>
  )
}

function DropZone({
  id,
  children,
  className,
  style,
}: {
  id: string
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  const { setNodeRef, isOver } = useDroppable({ id, data: { kind: 'zone', id } })
  return (
    <div
      ref={setNodeRef}
      data-tier-drop={id}
      className={className}
      style={{
        ...style,
        transition: 'box-shadow 160ms ease, outline 160ms ease',
        outline: isOver ? accentRing : undefined,
        outlineOffset: isOver ? 0 : undefined,
      }}
    >
      {children}
    </div>
  )
}

function resolveDropZone(
  overId: string | undefined,
  cards: TierCard[],
): { tierId: string | null; overCardId?: string } | null {
  if (!overId) return null
  if (overId === 'bank') return { tierId: null }
  if (overId.startsWith('tier-')) return { tierId: overId.slice('tier-'.length) }

  // Otherwise overId is a sortable card id (useSortable registers
  // each card as a droppable under its own id, no prefix).
  const hit = cards.find((c) => c.id === overId)
  if (!hit) return null
  return { tierId: hit.tierId, overCardId: overId }
}

function moveCardToTarget(
  cards: TierCard[],
  activeId: string,
  target: { tierId: string | null; overCardId?: string },
) {
  const activeIndex = cards.findIndex((c) => c.id === activeId)
  if (activeIndex < 0) return cards
  const active = cards[activeIndex]

  if (target.overCardId && target.overCardId !== activeId) {
    const overIndex = cards.findIndex((c) => c.id === target.overCardId)
    if (overIndex < 0) return cards

    const overCard = cards[overIndex]
    const moved = { ...active, tierId: overCard.tierId }
    const withoutActive = cards.filter((c) => c.id !== activeId)
    let insertAt = withoutActive.findIndex((c) => c.id === target.overCardId)
    if (active.tierId === overCard.tierId && activeIndex < overIndex) insertAt += 1

    return [...withoutActive.slice(0, insertAt), moved, ...withoutActive.slice(insertAt)]
  }

  const moved = { ...active, tierId: target.tierId }
  return [...cards.filter((c) => c.id !== activeId), moved]
}

function tierRemoveBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    ...ctrlBase,
    display: 'inline-flex',
    width: 28,
    height: 28,
    padding: 0,
    alignItems: 'center',
    justifyContent: 'center',
    color: disabled ? 'var(--text-muted)' : '#dc2626',
    opacity: disabled ? 0.35 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

/**
 * Locks any drag transform to the vertical axis. Used by the tier-row
 * DragOverlay so the lifted clone slides up/down only - horizontal
 * cursor wobble can't drag a row out of its column, which makes the
 * vertical list feel deliberate and rails-y instead of free-floating.
 */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
})

/**
 * Read-only visual twin of `SortableTierRow`. Rendered inside the
 * `DragOverlay` so the user sees a floating, fully-styled row track
 * the cursor during a drag - same pattern the card sortables use.
 * Width is forwarded from the source row (captured on drag start)
 * so the floating clone matches the original row exactly instead of
 * collapsing to its content's intrinsic width when portaled to body.
 */
function TierRowOverlay({ tier, width }: { tier: TierDef; width: number | null }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 p-2"
      style={{
        width: width ?? undefined,
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-surface) 96%, var(--bg))',
        boxShadow: 'var(--shadow-lightbox)',
        cursor: 'grabbing',
        pointerEvents: 'none',
      }}
    >
      <span
        className="inline-flex shrink-0 items-center justify-center"
        style={{
          ...ctrlBase,
          width: 28,
          height: 30,
          padding: 0,
          color: 'var(--text-muted)',
        }}
      >
        <GripVertical size={16} aria-hidden />
      </span>
      <span
        aria-hidden
        className="rounded"
        style={{
          height: 36,
          width: 48,
          background: tier.color,
          border: '1px solid var(--border-subtle)',
        }}
      />
      <span
        className="min-w-[6rem] flex-1 px-2 py-1.5 text-sm font-bold"
        style={{ ...ctrlBase, borderRadius: 6 }}
      >
        {tier.label}
      </span>
      <span
        className="inline-flex items-center justify-center"
        style={tierRemoveBtnStyle(false)}
      >
        <Trash2 size={16} />
      </span>
    </div>
  )
}

/**
 * One row in the tier editor. The whole `<li>` is the sortable node so
 * the FLIP transform shifts the entire row (handle + inputs + delete)
 * together when neighbours bump out of the way. Drag listeners live
 * *only* on the grip button - the color picker and label input must
 * stay clickable/typeable without triggering a drag, and pointer-down
 * on the delete button gets stopPropagation defensively in case dnd-kit
 * ever decides to listen at the wrapper level.
 *
 * Physics parity with `SortableCard`: during the drag, the source is
 * hidden in-place via `visibility: hidden` and receives no cursor-delta
 * transform, while the `DragOverlay` clone (see `TierRowOverlay`) does
 * all the visible cursor-tracking work. On release, useSortable applies
 * a single FLIP delta (old slot → new slot) for a smooth bump.
 */
function SortableTierRow({
  tier,
  idx,
  onLabelChange,
  onColorChange,
  onRemove,
  canRemove,
}: {
  tier: TierDef
  idx: number
  onLabelChange: (value: string) => void
  onColorChange: (value: string) => void
  onRemove: () => void
  canRemove: boolean
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: tier.id,
    data: { kind: 'tier-row', id: tier.id },
  })

  return (
    <li
      ref={setNodeRef}
      className="flex flex-wrap items-center gap-2 p-2"
      style={{
        // Mirror SortableCard's physics. While this row is the one being
        // dragged we hide it in-place and skip the cursor-delta transform
        // - the floating clone in the DragOverlay does the visible work,
        // so the source's only job is to hold the DOM slot. On release,
        // useSortable applies one clean FLIP delta (old slot → new) and
        // animates the bump without fighting any lingering transforms.
        transform: isDragging ? undefined : CSS.Translate.toString(transform),
        transition: isDragging ? undefined : transition,
        visibility: isDragging ? 'hidden' : undefined,
        zIndex: isDragging ? 5 : undefined,
        borderRadius: 6,
        border: '1px solid var(--border-subtle)',
        background: 'color-mix(in srgb, var(--bg-surface) 88%, var(--bg))',
      }}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        aria-label={`Reorder tier ${tier.label}`}
        title="Drag to reorder"
        className="inline-flex shrink-0 items-center justify-center"
        style={{
          ...ctrlBase,
          width: 28,
          height: 30,
          padding: 0,
          cursor: isDragging ? 'grabbing' : 'grab',
          touchAction: 'none',
          color: 'var(--text-muted)',
        }}
      >
        <GripVertical size={16} aria-hidden />
      </button>
      <input
        aria-label={`Tier ${idx + 1} color`}
        type="color"
        value={tier.color}
        onChange={(e) => onColorChange(e.target.value)}
        className="h-9 w-12 cursor-pointer rounded border bg-transparent"
        style={{ borderColor: 'var(--border-subtle)' }}
      />
      <input
        aria-label={`Tier ${idx + 1} label`}
        type="text"
        value={tier.label}
        onChange={(e) => onLabelChange(e.target.value)}
        className="min-w-[6rem] flex-1 px-2 py-1.5 text-sm font-bold outline-none"
        style={{ ...ctrlBase, borderRadius: 6 }}
      />
      <button
        type="button"
        onPointerDown={(e) => e.stopPropagation()}
        className="inline-flex items-center justify-center"
        style={tierRemoveBtnStyle(!canRemove)}
        disabled={!canRemove}
        onClick={onRemove}
        aria-label="Remove tier"
      >
        <Trash2 size={16} />
      </button>
    </li>
  )
}

/**
 * Pull a `{ name, code }` pair out of a `TierCard` for the Roster
 * section. Gallery cards expose the card code in parens; uploads
 * have no code. The display name comes from `card.label` when set,
 * otherwise a sensible default (`Pasted image` for uploads, card
 * code for gallery).
 */
function rosterEntryFor(card: TierCard): { name: string; code: string | null } {
  if (card.kind === 'upload') {
    return { name: card.label?.trim() || 'Pasted image', code: null }
  }
  const code = card.id.includes('_') ? card.id.slice(0, card.id.indexOf('_')) : card.id
  const name = card.label?.trim() || code
  return { name, code }
}

/**
 * Build the plain-text payload the Roster's Copy button drops on
 * the clipboard. Tweet-friendly: short header, then each non-empty
 * tier as `<label>: name (code), name (code)`. Inline commas over
 * bullets/newlines keep the whole list compact enough for a
 * standard tweet or chat message without manual reformatting.
 */
function rosterToPlainText(
  tiers: TierDef[],
  cards: TierCard[],
  title: string,
): string {
  const header = (title.trim() || 'Tier list').trim()
  const lines: string[] = [header]
  for (const tier of tiers) {
    const tierCards = cards.filter((c) => c.tierId === tier.id)
    if (tierCards.length === 0) continue
    const entries = tierCards
      .map((c) => {
        const { name, code } = rosterEntryFor(c)
        return code ? `${name} (${code})` : name
      })
      .join(', ')
    lines.push(`${tier.label}: ${entries}`)
  }
  return lines.join('\n')
}

/**
 * Single roster row with an inline-editable name. Gallery cards still
 * show the card code in muted mono text beside the name field.
 */
function RosterEntryRow({
  card,
  onUpdateLabel,
}: {
  card: TierCard
  onUpdateLabel: (id: string, label: string) => void
}) {
  const { name, code } = rosterEntryFor(card)
  const editValue = card.label ?? name

  return (
    <li className="flex items-center gap-2 leading-snug">
      <input
        type="text"
        value={editValue}
        onChange={(e) => onUpdateLabel(card.id, e.target.value)}
        className="min-w-0 flex-1 px-1.5 py-0.5 text-sm font-medium outline-none"
        style={{
          ...ctrlBase,
          borderRadius: 4,
          background: 'transparent',
          border: '1px solid transparent',
          color: 'var(--text-primary)',
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = 'var(--border-subtle)'
          e.currentTarget.style.background = 'var(--bg)'
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = 'transparent'
          e.currentTarget.style.background = 'transparent'
        }}
        aria-label={code ? `Roster name for ${code}` : 'Roster name for pasted image'}
      />
      {code && (
        <span
          className="shrink-0 font-mono text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          {code}
        </span>
      )}
    </li>
  )
}

/**
 * Summary of every charted card, grouped by tier, with inline-editable
 * names and a Copy button that drops the same data on the clipboard
 * as plain text. Lives below the visual chart so it serves as the
 * quick-reference / shareable version of the tier list - you can
 * paste the output straight into a tweet, DM, or notes file
 * without having to retype card names or look up serial numbers.
 *
 * Hidden entirely when no cards are charted yet so the page
 * doesn't render an empty stub. Tiers with zero charted cards
 * are also skipped to keep the block tight.
 */
function RosterSection({
  tiers,
  cards,
  title,
  onUpdateLabel,
}: {
  tiers: TierDef[]
  cards: TierCard[]
  title: string
  onUpdateLabel: (id: string, label: string) => void
}) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)

  // Clear any pending "Copied!" timer if the component unmounts
  // mid-flight - prevents a setState on an unmounted component
  // and stops a stale label from briefly flashing in if the user
  // navigates away and back.
  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const chartedTiers = useMemo(
    () =>
      tiers
        .map((tier) => ({
          tier,
          tierCards: cards.filter((c) => c.tierId === tier.id),
        }))
        .filter((t) => t.tierCards.length > 0),
    [tiers, cards],
  )

  if (chartedTiers.length === 0) return null

  const handleCopy = async () => {
    const text = rosterToPlainText(tiers, cards, title)
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard API can fail in non-secure contexts or when the
      // browser denies permission. Fall back to a textarea +
      // execCommand select-and-copy so the button is still useful
      // on older mobile browsers / http origins.
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.select()
      try {
        document.execCommand('copy')
        setCopied(true)
        if (copyTimerRef.current !== null) {
          window.clearTimeout(copyTimerRef.current)
        }
        copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
      } finally {
        document.body.removeChild(ta)
      }
    }
  }

  return (
    <section aria-label="Roster" className="mt-8">
      <SectionLabel
        icon={ClipboardList}
        label="Roster"
        right={
          <button
            type="button"
            onClick={handleCopy}
            className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
            style={{
              ...ctrlBase,
              height: 30,
              color: copied ? '#1f7a3f' : 'var(--text-primary)',
              borderColor: copied
                ? 'color-mix(in srgb, #1f7a3f 50%, var(--border-subtle))'
                : 'var(--border-subtle)',
            }}
            aria-label="Copy roster as plain text"
          >
            {copied ? (
              <>
                <Check size={14} aria-hidden />
                Copied
              </>
            ) : (
              <>
                <Copy size={14} aria-hidden />
                Copy as text
              </>
            )}
          </button>
        }
      />

      <div
        className="overflow-hidden rounded-[8px]"
        style={{
          border: '1px solid var(--border-subtle)',
          boxShadow: 'var(--shadow-card)',
          background: 'var(--bg-surface)',
        }}
      >
        {chartedTiers.map(({ tier, tierCards }, idx) => (
          <div
            key={tier.id}
            className="flex"
            style={{
              borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)',
            }}
          >
            <div
              className="flex w-[84px] shrink-0 items-center justify-center px-1 py-3 font-display text-base font-black leading-none sm:w-[94px] sm:text-lg"
              style={{
                background: tier.color,
                color: '#111',
                borderRight: '1px solid var(--border-subtle)',
              }}
            >
              <span className="break-words text-center">{tier.label}</span>
            </div>
            <ul
              className="flex flex-1 flex-col gap-1 px-3 py-2.5 text-sm"
              style={{ color: 'var(--text-primary)' }}
            >
              {tierCards.map((c) => (
                <RosterEntryRow key={c.id} card={c} onUpdateLabel={onUpdateLabel} />
              ))}
            </ul>
          </div>
        ))}
      </div>

      <p
        className="mt-2 text-xs"
        style={{ color: 'var(--text-muted)' }}
      >
        One-tap copy drops a tweet-ready version of this list on your clipboard. Tap any name to edit it first.
      </p>
    </section>
  )
}

export function TierListMaker() {
  const formId = useId()

  const tierPool = useStore((s) => s.tierPool)
  const removeFromTierPool = useStore((s) => s.removeFromTierPool)

  // Tiers / cards / title all live in the Zustand store now (see
  // `tierBoard*` in lib/store.ts) so the whole working board
  // survives navigating away to the gallery to queue more cards
  // and back. Previously this state was local React state that
  // got wiped every unmount -- after even one round trip the user
  // would find their custom tier rows (S+, D, etc.), their tier
  // assignments, AND their chart title all silently reset, which
  // was the user complaint that motivated this refactor.
  const tiers = useStore((s) => s.tierBoardTiers)
  const setTiers = useStore((s) => s.setTierBoardTiers)
  const cards = useStore((s) => s.tierBoardCards)
  const setCards = useStore((s) => s.setTierBoardCards)
  const title = useStore((s) => s.tierBoardTitle)
  const setTitle = useStore((s) => s.setTierBoardTitle)
  const resetBoard = useStore((s) => s.resetTierBoard)
  const resetTierChart = useStore((s) => s.resetTierChart)
  const [activeId, setActiveId] = useState<string | null>(null)
  // Tier-row drag state. Kept in its own pair (instead of widening
  // `activeId`) because the two DndContexts are independent and we
  // don't want a card drag to ever resolve against tierActiveId or
  // vice-versa. `tierActiveWidth` is captured on drag start so the
  // floating overlay matches the source row's width exactly.
  const [tierActiveId, setTierActiveId] = useState<string | null>(null)
  const [tierActiveWidth, setTierActiveWidth] = useState<number | null>(null)
  const [editorOpen, setEditorOpen] = useState(true)
  const [pasteHint, setPasteHint] = useState('Paste images anywhere on this page')

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const pointerHits = pointerWithin(args)
    if (pointerHits.length > 0) return pointerHits
    return rectIntersection(args)
  }, [])

  const activeCard = useMemo(() => cards.find((c) => c.id === activeId), [cards, activeId])

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id))
  }, [])

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null)
      const active = String(e.active.id)
      const drop = resolveDropZone(e.over?.id ? String(e.over.id) : undefined, cards)
      if (!drop) return
      setCards((prev) => moveCardToTarget(prev, active, drop))
    },
    [cards],
  )

  const onDragCancel = useCallback(() => setActiveId(null), [])

  const addImageFiles = useCallback((files: Iterable<File>) => {
    const next: TierCard[] = []
    for (const file of files) {
      if (!file.type.startsWith('image/')) continue
      next.push({
        id: crypto.randomUUID(),
        src: URL.createObjectURL(file),
        tierId: null,
        kind: 'upload',
        label: 'Pasted image',
      })
    }
    if (!next.length) return
    setCards((c) => [...c, ...next])
    setPasteHint(`${next.length} image${next.length === 1 ? '' : 's'} added`)

    // Resolve each upload's intrinsic aspect ratio async, then patch
    // it back onto the matching TierCard. Until this resolves the
    // tile renders at the THUMB_W_DEFAULT × THUMB_H_PORTRAIT
    // fallback; once it lands the tile snaps to the pasted image's
    // natural shape (squares stay square, wide screenshots get wide
    // tiles, phone portraits get narrow tiles) — and `object-contain`
    // guarantees nothing is cropped during either phase. We measure
    // off-DOM with `new Image()` so the layout-affecting tier-row
    // <img> doesn't need its own onLoad handler / state.
    for (const tile of next) {
      const probe = new Image()
      probe.onload = () => {
        const w = probe.naturalWidth
        const h = probe.naturalHeight
        if (!w || !h) return
        const ratio = w / h
        setCards((cs) =>
          cs.map((c) => (c.id === tile.id ? { ...c, aspectRatio: ratio } : c)),
        )
      }
      probe.onerror = () => {
        // Image failed to decode (corrupt paste, unsupported format).
        // Leave aspectRatio undefined — the tile stays at the square
        // fallback rather than crashing the row layout.
      }
      probe.src = tile.src
    }
  }, [])

  const addFiles = useCallback(
    (files: FileList | null) => {
      if (!files?.length) return
      addImageFiles(Array.from(files))
    },
    [addImageFiles],
  )

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      const isTextField =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)

      const files = Array.from(event.clipboardData?.items ?? [])
        .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
        .map((item) => item.getAsFile())
        .filter((file): file is File => Boolean(file))

      if (!files.length) return
      if (!isTextField) event.preventDefault()
      addImageFiles(files)
    }

    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [addImageFiles])

  // NOTE: we deliberately do NOT revoke blob: URLs on unmount any
  // more. `cards` now lives in the Zustand store, so when the user
  // navigates away from this page the upload tiles need their blob
  // URLs to STAY ALIVE so the images still render when they come
  // back. Per-item revoke still happens at the explicit removal
  // sites (`removeCard`, `clearBankOnly`) which is when we actually
  // know the URL is no longer needed. The small downside is that an
  // upload that's never explicitly removed leaks its blob until the
  // tab closes -- acceptable tradeoff for "the gallery round-trip
  // doesn't nuke my board".

  // Merge in any items queued from the main gallery (store.tierPool) as
  // pool cards. Runs on mount and whenever the queue changes - so adding
  // a card from the Card Wall in another tab/window shows up live here.
  // Items the user has already moved into a tier are left alone.
  useEffect(() => {
    if (tierPool.length === 0) return
    setCards((current) => {
      const have = new Set(current.map((c) => c.id))
      const additions: TierCard[] = []
      for (const item of tierPool) {
        if (!have.has(item.id)) {
          // Every tierPool item comes from the main gallery, so render
          // them in the natural TCG card aspect (portrait, full-card).
          additions.push({
            id: item.id,
            src: item.src,
            tierId: null,
            kind: 'gallery',
            label: item.label,
          })
        }
      }
      if (additions.length === 0) return current
      return [...current, ...additions]
    })
  }, [tierPool])

  const updateCardLabel = useCallback(
    (id: string, label: string) => {
      setCards((prev) => prev.map((c) => (c.id === id ? { ...c, label } : c)))
    },
    [setCards],
  )

  const removeCard = useCallback(
    (id: string) => {
      setCards((prev) => {
        const hit = prev.find((c) => c.id === id)
        if (hit && hit.src.startsWith('blob:')) URL.revokeObjectURL(hit.src)
        return prev.filter((c) => c.id !== id)
      })
      // Keep the gallery button state in sync if this came from the queue.
      removeFromTierPool(id)
    },
    [removeFromTierPool],
  )

  // Move every tier-assigned card back to the pool. Non-destructive:
  // images aren't removed, blob URLs aren't revoked, and gallery items
  // stay in the tierPool store - so the user can re-rank them without
  // losing their working set.
  const clearChart = useCallback(() => {
    setCards((prev) => {
      if (!prev.some((c) => c.tierId !== null)) return prev
      return prev.map((c) => (c.tierId === null ? c : { ...c, tierId: null }))
    })
  }, [])

  const handleResetTierChart = useCallback(() => {
    const hasCustomTiers = !tiersMatchDefault(tiers)
    const hasAssignments = cards.some((c) => c.tierId !== null)
    if (!hasCustomTiers && !hasAssignments) return
    resetTierChart()
  }, [tiers, cards, resetTierChart])

  // ─── Chart export ────────────────────────────────────────────────
  // `chartFrameRef` points at the bordered chart container that the
  // PNG export pipeline snapshots. The CSS gradient ring lives on
  // the chart's `::before` (z-index -1, inset:0, the
  // `chart-grad-spin` keyframes rotating `--chart-grad-angle`), so
  // html-to-image captures whatever angle the gradient is at the
  // exact moment of capture. Since we no longer export an animated
  // GIF, that single still frame is the whole point -- the
  // rotation just makes the on-screen preview eye-catching, while
  // the PNG bakes in one frozen angle of the brand-palette ring.
  // See src/lib/chart-export.ts.
  const chartFrameRef = useRef<HTMLDivElement | null>(null)
  const [exporting, setExporting] = useState<'png' | 'copy' | null>(null)
  const [exportFlash, setExportFlash] = useState<string | null>(null)
  // Rotating gradient ring around the chart -- mascot-palette
  // conic-gradient (hat orange · goggle cyan · jeans royal blue)
  // spinning once every 6s. Defaults OFF -- it's an opt-in flourish
  // for users who want the eye-catching version for a social share,
  // not the default visual treatment. Preference persists to
  // localStorage so users who turn it on don't have to redo the
  // toggle every page visit. Reading localStorage is deferred to a
  // post-mount effect to avoid an SSR / hydration mismatch (the
  // server has no `localStorage`).
  const [borderAnimated, setBorderAnimated] = useState(false)
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem('tier-list:border-animated')
      if (stored === '1') setBorderAnimated(true)
    } catch {
      // localStorage may throw in private windows / quota-full;
      // leaving the default is fine.
    }
  }, [])
  useEffect(() => {
    try {
      window.localStorage.setItem('tier-list:border-animated', borderAnimated ? '1' : '0')
    } catch {
      // see note above
    }
  }, [borderAnimated])
  const exportFlashTimerRef = useRef<number | null>(null)
  useEffect(() => {
    return () => {
      if (exportFlashTimerRef.current !== null) {
        window.clearTimeout(exportFlashTimerRef.current)
      }
    }
  }, [])

  const flashExport = useCallback((msg: string) => {
    setExportFlash(msg)
    if (exportFlashTimerRef.current !== null) {
      window.clearTimeout(exportFlashTimerRef.current)
    }
    exportFlashTimerRef.current = window.setTimeout(() => setExportFlash(null), 2400)
  }, [])

  const handleCopyPng = useCallback(async () => {
    if (!chartFrameRef.current || exporting !== null) return
    setExporting('copy')
    setExportFlash(null)
    try {
      const blob = await captureChartPng(chartFrameRef.current)
      const ok = await copyBlobToClipboard(blob)
      if (ok) {
        flashExport('Copied PNG to clipboard')
      } else {
        // Clipboard write rejected (no permission, no user gesture
        // path, Safari/Firefox image-write gating, etc.) -- fall
        // through to a download so the user still walks away with
        // their snapshot instead of an empty error.
        downloadBlob(blob, buildExportFilename(title, 'png'))
        flashExport('Clipboard blocked - downloaded PNG instead')
      }
    } catch (err) {
      console.error('Copy PNG failed', err)
      flashExport('Export failed - try again')
    } finally {
      setExporting(null)
    }
  }, [exporting, title, flashExport])

  const handleSavePng = useCallback(async () => {
    if (!chartFrameRef.current || exporting !== null) return
    setExporting('png')
    setExportFlash(null)
    try {
      const blob = await captureChartPng(chartFrameRef.current)
      downloadBlob(blob, buildExportFilename(title, 'png'))
      flashExport('Saved PNG')
    } catch (err) {
      console.error('PNG export failed', err)
      flashExport('Export failed - try again')
    } finally {
      setExporting(null)
    }
  }, [exporting, title, flashExport])

  const clearBankOnly = useCallback(() => {
    const removedFromStore: string[] = []
    setCards((prev) => {
      for (const c of prev.filter((x) => x.tierId === null)) {
        if (c.src.startsWith('blob:')) URL.revokeObjectURL(c.src)
        else removedFromStore.push(c.id)
      }
      return prev.filter((c) => c.tierId !== null)
    })
    for (const id of removedFromStore) removeFromTierPool(id)
  }, [removeFromTierPool])

  const addTier = useCallback(() => {
    const n = tiers.length + 1
    setTiers((t) => [
      ...t,
      { id: crypto.randomUUID(), label: `Tier ${n}`, color: '#90caf9' },
    ])
  }, [tiers.length])

  const removeTier = useCallback((tierId: string) => {
    setTiers((prev) => (prev.length <= 1 ? prev : prev.filter((t) => t.id !== tierId)))
    setCards((prev) => prev.map((c) => (c.tierId === tierId ? { ...c, tierId: null } : c)))
  }, [])

  // Reorder the tier rows when the user drags a row's grip handle.
  // Lives in its own DndContext below, completely independent of the
  // card-drag context - these two interactions never share a sortable
  // tree, so we don't need to dispatch on data.kind here.
  //
  // The trio of start/end/cancel mirrors the card-drag handlers below
  // so the tier-row drag has full physics parity: source hides, clone
  // tracks cursor in the DragOverlay, FLIP bumps neighbours on release.
  const onTierDragStart = useCallback((e: DragStartEvent) => {
    setTierActiveId(String(e.active.id))
    // `initial` is the source rect captured at the moment the drag
    // activated. Width is forwarded to the overlay clone so it
    // doesn't collapse to its content's intrinsic width when the
    // portal lifts it out of the list's flex container.
    setTierActiveWidth(e.active.rect.current.initial?.width ?? null)
  }, [])

  const onTierDragEnd = useCallback((e: DragEndEvent) => {
    setTierActiveId(null)
    setTierActiveWidth(null)
    const { active, over } = e
    if (!over || active.id === over.id) return
    setTiers((prev) => {
      const oldIndex = prev.findIndex((t) => t.id === active.id)
      const newIndex = prev.findIndex((t) => t.id === over.id)
      if (oldIndex < 0 || newIndex < 0) return prev
      return arrayMove(prev, oldIndex, newIndex)
    })
  }, [])

  const onTierDragCancel = useCallback(() => {
    setTierActiveId(null)
    setTierActiveWidth(null)
  }, [])

  const activeTier = useMemo(
    () => (tierActiveId ? tiers.find((t) => t.id === tierActiveId) ?? null : null),
    [tierActiveId, tiers],
  )

  const uploadChip: React.CSSProperties = {
    ...ctrlBase,
    borderColor: 'color-mix(in srgb, #E85D2A 40%, var(--border-subtle))',
    boxShadow: '0 0 0 1px color-mix(in srgb, #E85D2A 18%, transparent) inset',
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    alignItems: 'center',
    gap: 6,
    padding: '6px 12px',
    height: 30,
    display: 'inline-flex',
  }

  return (
    <div
      className="relative min-h-screen pb-28"
      style={{
        background: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* px-4 lives on the *inner* max-w-6xl div, not the outer
          <header>, so the header's horizontal bounds line up
          exactly with the main content wrapper below (which also
          uses `mx-auto max-w-6xl px-4`). When px-4 sits on the
          outer element instead, the inner content can grow to
          the full 1152px max-w-6xl while the main content tops
          out at 1120px (1152 - 32), leaving the nav buttons 16px
          further left and right than the chart frame on wide
          viewports. Same pattern as the main gallery (header.tsx
          + card-grid.tsx both put px-4 inside the maxWidth). */}
      <header
        className="sticky top-0 z-20 py-3"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4">
          <div className="flex flex-wrap items-center gap-3">
            {/* Brand cluster: logo + beta tag stay tightly paired (gap-2)
                so they read as one identity unit, distinct from the page
                title that follows past the divider. */}
            <div className="flex items-center gap-2">
              <Link
                href="/"
                className="group inline-flex"
                aria-label="The Card Wall - home"
                style={{
                  transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
                }}
              >
                <span className="group-hover:scale-[1.02] transition-transform">
                  <BrandLockup />
                </span>
              </Link>
              {/* Beta tag, mirrors the main nav for cross-page consistency. */}
              <span
                aria-label="Beta release"
                title="Beta release"
                className="inline-flex select-none"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 10,
                  fontStyle: 'italic',
                  fontWeight: 700,
                  letterSpacing: '0.18em',
                  textTransform: 'lowercase',
                  color: '#E85D2A',
                  opacity: 0.78,
                  lineHeight: 1,
                  transform: 'translateY(1px)',
                }}
              >
                beta
              </span>
            </div>
            {/* Vertical rule separates site identity (brand + beta) from
                page identity (Tier list maker). Same divider language the
                main nav uses between filter and zoom controls. */}
            <div
              aria-hidden
              className="hidden sm:block"
              style={{
                width: 1,
                height: 22,
                background: 'var(--text-muted)',
                opacity: 0.4,
                margin: '0 4px',
              }}
            />
            <div className="flex items-center gap-2">
              <Layers size={18} strokeWidth={2.25} style={{ color: '#E85D2A' }} aria-hidden />
              <h1 className="font-display text-base font-bold tracking-tight sm:text-lg">
                Tier list maker
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <button
              type="button"
              onClick={() => setEditorOpen((v) => !v)}
              className="footer-btn inline-flex items-center px-3 text-xs font-medium"
              style={{ ...ctrlBase, height: 30 }}
            >
              {editorOpen ? 'Hide tier editor' : 'Edit tiers'}
            </button>
            <label htmlFor={`${formId}-file`} className="footer-btn" style={uploadChip}>
              <Upload size={14} aria-hidden />
              Upload images
              <input
                id={`${formId}-file`}
                type="file"
                accept="image/*"
                multiple
                className="sr-only"
                onChange={(e) => {
                  addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
            </label>
          </div>
        </div>
      </header>

      {/* Snarky page lede. Sets the tone the moment you land: this
          is free, this is irreverent, the rest of the internet is
          getting away with murder for this. Visual language mirrors
          the main gallery's italic-display tagline (orange quote
          marks + display font) so the two pages feel like siblings
          rather than the tier-list page feeling like a stripped-down
          secondary tool.

          Both lines are pinned to a single row at every viewport.
          On mobile the quote was wrapping mid-phrase ("...to make /
          tier lists") which neutered the punchline rhythm, and the
          value-statement triplet was wrapping each pill onto its
          own line, which looked accidental. Solution: lock both
          with white-space:nowrap and use viewport-width-keyed
          clamps for font-size / letter-spacing / gap so the text
          scales down smoothly on narrow phones instead of
          breaking. The clamp lower bounds were tuned against
          iPhone SE (375px) and the smallest common Android width
          (~360px) using the dev-tools device emulator. */}
      <section
        aria-label="About this page"
        className="mx-auto max-w-3xl px-4 pt-8 pb-2 text-center"
      >
        <p
          style={{
            fontFamily: 'var(--font-display)',
            // Sized to fit the 52-char line inside the px-4 content
            // box at every common phone width. Empirical scaling
            // from a measured 694px-viewport render: at 694px the
            // line is ~660px wide at 23.6px font, so we need
            // fontSize <= ~10.5px at 320px usable width (288px),
            // ~11.5px at 360 (328 usable), ~12.5px at 390 (358),
            // etc. 3vw + 10px floor satisfies all of those with a
            // small safety margin. Cap stays at 26px so the
            // desktop look is unchanged from the previous design.
            fontSize: 'clamp(10px, 3vw, 26px)',
            fontStyle: 'italic',
            fontWeight: 700,
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: '#E85D2A', fontWeight: 800, marginRight: 3 }}>“</span>
          I can&rsquo;t believe sites charge money to make tier lists
          <span style={{ color: '#E85D2A', fontWeight: 800, marginLeft: 3 }}>”</span>
        </p>
        <p
          className="mt-3 flex flex-nowrap items-center justify-center"
          style={{
            // Triple-clamped: font, letter-spacing, and gap all
            // shrink together on narrow widths so the three pills
            // ("Always free · No signup · Runs in your browser")
            // fit on one line down to ~360px. Above ~480px we hit
            // the upper bounds and the strip looks identical to
            // the previous fixed-11px design.
            fontSize: 'clamp(8.5px, 2.4vw, 11px)',
            letterSpacing: 'clamp(0.06em, 0.5vw, 0.18em)',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            gap: 'clamp(4px, 1.4vw, 12px)',
          }}
        >
          <span>Always free</span>
          <span aria-hidden style={{ opacity: 0.5 }}>·</span>
          <span>No signup</span>
          <span aria-hidden style={{ opacity: 0.5 }}>·</span>
          <span>Runs in your browser</span>
        </p>
      </section>

      <div className="mx-auto max-w-6xl px-4 pt-6">
        {editorOpen && (
          <section
            aria-label="Customize tiers"
            className="mb-6 flex flex-col p-4"
            style={{
              ...ctrlBase,
              borderRadius: 8,
              boxShadow: 'var(--shadow-card)',
            }}
          >
            <SectionLabel
              icon={Layers}
              label="Tier rows"
              right={
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleResetTierChart}
                    className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
                    style={{ ...ctrlBase, height: 28 }}
                    title="Restore default S, A, B, C rows and move charted cards back to the pool. Cards and chart title stay as they are."
                  >
                    Reset
                  </button>
                  <button
                    type="button"
                    onClick={addTier}
                    className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
                    style={{ ...ctrlBase, height: 28 }}
                  >
                    <Plus size={14} aria-hidden />
                    Add tier
                  </button>
                </div>
              }
            />
            {/* Tier-row reorder lives in its own DndContext, isolated
                from the card-drag context below. closestCenter is the
                right choice for a vertical list - the cursor's vertical
                center picks the nearest neighbour row cleanly. The
                restrictToVerticalAxis modifier keeps the floating
                overlay locked to the column for a rails-y feel. */}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={onTierDragStart}
              onDragEnd={onTierDragEnd}
              onDragCancel={onTierDragCancel}
            >
              <SortableContext items={tiers.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                <ul className="flex flex-col gap-2">
                  {tiers.map((tier, idx) => (
                    <SortableTierRow
                      key={tier.id}
                      tier={tier}
                      idx={idx}
                      onLabelChange={(value) =>
                        setTiers((prev) => prev.map((t) => (t.id === tier.id ? { ...t, label: value } : t)))
                      }
                      onColorChange={(value) =>
                        setTiers((prev) => prev.map((t) => (t.id === tier.id ? { ...t, color: value } : t)))
                      }
                      onRemove={() => removeTier(tier.id)}
                      canRemove={tiers.length > 1}
                    />
                  ))}
                </ul>
              </SortableContext>
              <DragOverlay adjustScale={false} dropAnimation={null}>
                {activeTier ? (
                  <TierRowOverlay tier={activeTier} width={tierActiveWidth} />
                ) : null}
              </DragOverlay>
            </DndContext>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Drag the grip handle to reorder rows. Rename tiers (S+, S-, etc.) and drag images between rows. Reset restores the default four rows and moves charted cards back to the pool.
            </p>
          </section>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <section aria-label="Image pool" className="mb-8">
            <SectionLabel
              icon={Inbox}
              label="Pool"
              right={
                <>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {pasteHint}
                  </span>
                  {cards.some((c) => c.tierId === null) && (
                    <button
                      type="button"
                      onClick={clearBankOnly}
                      className="footer-btn inline-flex items-center px-2 py-1 text-xs font-semibold"
                      style={{ ...ctrlBase, height: 28 }}
                    >
                      Clear pool
                    </button>
                  )}
                </>
              }
            />
            {(() => {
              const poolCards = cards.filter((c) => c.tierId === null)
              const isEmpty = poolCards.length === 0
              return (
                <DropZone
                  id="bank"
                  className="flex min-h-[128px] flex-wrap content-center items-center gap-2 p-3"
                  style={{
                    borderRadius: 8,
                    // Dashed border in the empty state visually advertises
                    // the drop zone (matches the platform convention every
                    // user has internalized from Notion / Figma / Drive
                    // upload widgets). Switches to a solid 1px border once
                    // there are cards in the pool so the dashed pattern
                    // doesn't fight visually with the rendered thumbs.
                    border: isEmpty
                      ? '1.5px dashed color-mix(in srgb, var(--text-primary) 22%, transparent)'
                      : '1px solid var(--border-subtle)',
                    boxShadow: 'var(--shadow-card)',
                    background: isEmpty
                      ? 'color-mix(in srgb, var(--bg-surface) 70%, transparent)'
                      : 'var(--bg-surface)',
                  }}
                >
                  {isEmpty ? (
                    <div className="w-full py-8 text-center">
                      <ImagePlus
                        size={28}
                        strokeWidth={1.75}
                        aria-hidden
                        style={{
                          color: '#E85D2A',
                          opacity: 0.7,
                          display: 'inline-block',
                          marginBottom: 6,
                        }}
                      />
                      <p
                        className="text-sm"
                        style={{ color: 'var(--text-primary)', fontWeight: 600 }}
                      >
                        Drop images here to get started
                      </p>
                      <p
                        className="mt-1 text-xs"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        Upload, paste from clipboard, or add cards from the
                        gallery with the layers icon.
                      </p>
                    </div>
                  ) : (
                    <SortableContext items={poolCards.map((c) => c.id)} strategy={rectSortingStrategy}>
                      {poolCards.map((c) => (
                        <SortableCard
                          key={c.id}
                          id={c.id}
                          src={c.src}
                          kind={c.kind}
                          aspectRatio={c.aspectRatio}
                          onRemove={() => removeCard(c.id)}
                        />
                      ))}
                    </SortableContext>
                  )}
                </DropZone>
              )
            })()}
          </section>

          {/* Section header for the chart. Same SectionLabel pattern
              as the Pool above so the page reads as two consistent
              named regions. The action slot holds Clear chart, which
              sends every tier-assigned card back to the pool - only
              rendered when there's something to clear so the slot
              doesn't sit inert. */}
          <SectionLabel
            icon={Trophy}
            label="Chart"
            right={(() => {
              const hasChartedCards = cards.some((c) => c.tierId !== null)
              // Disable export when the board is totally empty
              // (no charted cards AND no pool cards) - there's
              // nothing meaningful to capture beyond an empty
              // tier table. As soon as the user adds something to
              // either side the buttons become live.
              const hasAnyCards = cards.length > 0
              const exportDisabled = !hasAnyCards
              const emptyHint = exportDisabled
                ? 'Add a card to the board to enable export'
                : null
              const flashColor = exportFlash?.startsWith('Saved') || exportFlash?.startsWith('Copied')
                ? '#1f7a3f'
                : 'var(--text-muted)'
              return (
                <div className="flex flex-wrap items-center gap-2">
                  {(exportFlash || emptyHint) && (
                    <span
                      role="status"
                      aria-live="polite"
                      className="hidden text-xs font-medium sm:inline"
                      style={{ color: exportFlash ? flashColor : 'var(--text-muted)' }}
                    >
                      {exportFlash ?? emptyHint}
                    </span>
                  )}
                  {/* Toggle the mascot-palette gradient ring around
                      the chart frame -- a thin conic gradient
                      (orange · cyan · royal blue) rotating once
                      every 6s. The PNG export captures whatever
                      angle the gradient is on screen at the moment
                      of capture, so leave the toggle on if you
                      want the rainbow line baked into the saved
                      PNG. State persists across reloads via
                      localStorage (see borderAnimated useEffect
                      above). */}
                  <button
                    type="button"
                    onClick={() => setBorderAnimated((v) => !v)}
                    aria-pressed={borderAnimated}
                    className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
                    style={{
                      ...ctrlBase,
                      height: 30,
                      color: borderAnimated ? '#E85D2A' : 'var(--text-muted)',
                      borderColor: borderAnimated
                        ? 'color-mix(in srgb, #E85D2A 45%, var(--border-subtle))'
                        : 'var(--border-subtle)',
                    }}
                    title={
                      borderAnimated
                        ? 'Hide the mascot-palette gradient outline around the chart'
                        : 'Show a rotating mascot-palette gradient outline around the chart (PNG exports will bake in whatever angle the ring is on at capture time)'
                    }
                  >
                    Border: {borderAnimated ? 'On' : 'Off'}
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyPng}
                    disabled={exporting !== null || exportDisabled}
                    className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
                    style={{
                      ...ctrlBase,
                      height: 30,
                      opacity: exportDisabled ? 0.4 : exporting !== null && exporting !== 'copy' ? 0.5 : 1,
                    }}
                    aria-label="Copy chart image to clipboard"
                    title="Copy a PNG of the chart to your clipboard - paste straight into a tweet, DM, or doc"
                  >
                    {exporting === 'copy' ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <Copy size={14} aria-hidden />
                    )}
                    Copy PNG
                  </button>
                  <button
                    type="button"
                    onClick={handleSavePng}
                    disabled={exporting !== null || exportDisabled}
                    className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
                    style={{
                      ...ctrlBase,
                      height: 30,
                      opacity: exportDisabled ? 0.4 : exporting !== null && exporting !== 'png' ? 0.5 : 1,
                    }}
                    aria-label="Download chart as PNG"
                    title="Download a still PNG of the chart"
                  >
                    {exporting === 'png' ? (
                      <Loader2 size={14} className="animate-spin" aria-hidden />
                    ) : (
                      <ImageIcon size={14} aria-hidden />
                    )}
                    Save PNG
                  </button>
                  {hasChartedCards && (
                    <button
                      type="button"
                      onClick={clearChart}
                      disabled={exporting !== null}
                      className="footer-btn inline-flex items-center gap-1 px-3 text-xs font-medium"
                      style={{ ...ctrlBase, height: 30 }}
                      aria-label="Move every charted card back to the pool"
                    >
                      <RotateCcw size={14} aria-hidden />
                      Clear chart
                    </button>
                  )}
                </div>
              )
            })()}
          />

          <div
            ref={chartFrameRef}
            className={`relative overflow-hidden rounded-[12px] p-4 sm:p-5${
              borderAnimated ? ' chart-frame-animated' : ''
            }`}
            style={{
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--bg-surface) 97%, var(--bg)) 0%, color-mix(in srgb, var(--bg-surface) 92%, var(--bg)) 100%)',
            }}
          >
            {/* Brand-orange top accent strip. Two-pixel band fading
                left + right so the chart frame reads as a *board*
                with a header, not just another panel. Pointer-events
                none so it never intercepts a drag-over the chart's
                top edge. */}
            <div
              aria-hidden
              className="pointer-events-none absolute left-0 right-0 top-0"
              style={{
                height: 2,
                background:
                  'linear-gradient(90deg, transparent 0%, color-mix(in srgb, #E85D2A 75%, transparent) 30%, color-mix(in srgb, #E85D2A 75%, transparent) 70%, transparent 100%)',
                opacity: 0.85,
              }}
            />
            {/* Editable chart title. Lives inside the chart frame so it
                pairs with the BoardWatermark footer (title up top,
                brand stamp down bottom) and will be captured by any
                future "export as image" feature. We use a real <input>
                rather than contentEditable for accessibility (proper
                label semantics, form-style focus ring, placeholder)
                and to dodge the host of selection / paste / IME quirks
                that contentEditable brings. Background is transparent
                and the only chrome is a focus underline so the field
                reads as a heading at rest and an editor on focus. */}
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Untitled tier list"
              maxLength={80}
              aria-label="Tier list title"
              className="tier-list-title mb-3 block w-full bg-transparent text-center font-display font-extrabold tracking-tight outline-none transition-colors sm:mb-4"
              style={{
                color: 'var(--text-primary)',
                fontSize: 'clamp(20px, 3.4vw, 28px)',
                lineHeight: 1.15,
                letterSpacing: '-0.015em',
                // Hairline placeholder when empty; on focus we draw a
                // brand-accent underline so it's obvious the field is
                // live without flashing a heavy input border that
                // would compete visually with the tier rows below.
                borderBottom: '1px solid transparent',
                paddingBottom: 4,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderBottomColor =
                  'color-mix(in srgb, #E85D2A 55%, transparent)'
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderBottomColor = 'transparent'
              }}
            />
            <section
              aria-label="Tier list"
              className="relative z-[1] flex flex-col overflow-hidden"
              style={{
                border: '1px solid var(--border-subtle)',
                borderRadius: 8,
                background: 'var(--bg-surface)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
              }}
            >
              {tiers.map((tier, idx) => (
                <div
                  key={tier.id}
                  className="flex"
                  style={{
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface)',
                  }}
                >
                  <div
                    className="flex w-[84px] shrink-0 items-center justify-center border-r px-1 py-3 font-display text-xl font-black leading-none sm:w-[94px] sm:text-2xl"
                    style={{
                      background: tier.color,
                      color: '#111',
                      borderRightColor: 'var(--border-subtle)',
                    }}
                  >
                    <span className="break-words text-center">{tier.label}</span>
                  </div>
                  <DropZone
                    id={`tier-${tier.id}`}
                    className="flex min-h-[112px] flex-1 flex-wrap content-center items-center gap-2 p-2"
                    style={{ background: 'var(--bg-surface)' }}
                  >
                    {(() => {
                      const rowCards = cards.filter((c) => c.tierId === tier.id)
                      return (
                        <SortableContext items={rowCards.map((c) => c.id)} strategy={rectSortingStrategy}>
                          {rowCards.map((c) => (
                            <SortableCard
                              key={c.id}
                              id={c.id}
                              src={c.src}
                              kind={c.kind}
                              aspectRatio={c.aspectRatio}
                              onRemove={() => removeCard(c.id)}
                            />
                          ))}
                        </SortableContext>
                      )
                    })()}
                  </DropZone>
                </div>
              ))}
            </section>
            <BoardWatermark />
          </div>

          <DragOverlay adjustScale={false} dropAnimation={null}>
            {activeCard ? (() => {
              const { width, height, fit } = thumbDimensions(activeCard.kind, activeCard.aspectRatio)
              return (
                <div
                  className="pointer-events-none overflow-hidden opacity-[0.98]"
                  style={{
                    width,
                    height,
                    borderRadius: 8,
                    border: '1px solid var(--border-subtle)',
                    background: 'var(--bg-surface)',
                    boxShadow: 'var(--shadow-lightbox)',
                    transformOrigin: 'top left',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={toCorsSafeImageSrc(activeCard.src)}
                    alt=""
                    draggable={false}
                    // See SortableCard above for why this matters --
                    // keeps the drag-overlay image CORS-clean so it
                    // doesn't taint a downstream chart capture if
                    // the drag is interrupted mid-export.
                    crossOrigin="anonymous"
                    onError={(e) => {
                      const img = e.currentTarget
                      if (img.dataset.busted === '1') return
                      if (img.src.startsWith('blob:')) return
                      img.dataset.busted = '1'
                      const sep = img.src.includes('?') ? '&' : '?'
                      img.src = `${img.src}${sep}_cb=${Date.now()}`
                    }}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: fit,
                      display: 'block',
                      userSelect: 'none',
                    }}
                  />
                </div>
              )
            })() : null}
          </DragOverlay>
        </DndContext>

        {/* Plain-text roster of every charted card, grouped by
            tier, with editable names and a Copy button for quick
            share. Lives outside the DndContext above on purpose -
            it doesn't need any of the drag wiring. Self-hides when
            nothing is charted yet. */}
        <RosterSection
          tiers={tiers}
          cards={cards}
          title={title}
          onUpdateLabel={updateCardLabel}
        />

        {/* Footer note. The "always free / no signup / runs in
            browser" trio already lives in the lede above, so down
            here we say the part that matters specifically for the
            tier-list page: uploaded images never leave the device. */}
        <p className="mt-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Your images stay on your device. Nothing is uploaded to any server.
        </p>
        <p className="mt-2 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Your tier rows, card placements, and chart title are saved on
          this device — they'll be here when you come back.{' '}
          <button
            type="button"
            onClick={() => {
              if (cards.length === 0 && tiers.length === defaultTiers().length && !title) {
                // Nothing meaningful to wipe yet; skip the confirm so
                // we don't bait users into a yes/no on an empty board.
                return
              }
              const ok = window.confirm(
                'Reset the board? This clears every card, restores the default S/A/B/C tier rows, and wipes the chart title. Your queued tier-list pool on the gallery side is left untouched.',
              )
              if (!ok) return
              // Revoke any upload blob URLs we created before we let
              // the store drop them on the floor -- the store doesn't
              // know about blob: semantics, so the UI handles cleanup.
              for (const c of cards) {
                if (c.src.startsWith('blob:')) URL.revokeObjectURL(c.src)
              }
              resetBoard()
            }}
            className="underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Reset board
          </button>
        </p>
      </div>
    </div>
  )
}
