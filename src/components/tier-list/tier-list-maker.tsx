'use client'

import Link from 'next/link'
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  rectIntersection,
  useSensor,
  useSensors,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { toBlob } from 'html-to-image'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useStore } from '@/lib/store'
import {
  ArrowDown,
  ArrowUp,
  Clipboard,
  Layers,
  Loader2,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { ThemeToggle } from '@/components/gallery/theme-toggle'

export type TierDef = {
  id: string
  label: string
  color: string
}

/**
 * Where a tier card image came from. Drives the rendered aspect ratio:
 *
 * - `gallery` — added via the "Add to tier list pool" button on a card
 *   in the main wall. Rendered portrait at the natural TCG card aspect
 *   (5:7) with `object-contain` so the full card art + frame is always
 *   visible (no cropping of the card title, cost, etc.).
 *
 * - `upload` — uploaded from disk or pasted from the clipboard. We have
 *   no idea what shape these are (screenshots, memes, square portraits)
 *   so we render them square with `object-cover` for a clean grid.
 */
export type TierCardKind = 'gallery' | 'upload'

export type TierCard = {
  id: string
  src: string
  tierId: string | null
  kind: TierCardKind
}

/**
 * Thumb width is shared between square (upload) and portrait (gallery)
 * thumbs so they flow consistently in tier rows. Portrait height is
 * derived from the standard TCG card ratio (5:7) — a ~78×109 box that
 * matches whole cards from the gallery without cropping.
 */
const THUMB_W = 78
const THUMB_H_SQUARE = 78
const THUMB_H_PORTRAIT = Math.round(THUMB_W * (7 / 5)) // 109

function thumbDimensions(kind: TierCardKind) {
  return kind === 'gallery'
    ? { width: THUMB_W, height: THUMB_H_PORTRAIT, fit: 'contain' as const }
    : { width: THUMB_W, height: THUMB_H_SQUARE, fit: 'cover' as const }
}

const DEFAULT_TIERS: TierDef[] = [
  { id: 't-s', label: 'S', color: '#ff5a5f' },
  { id: 't-a', label: 'A', color: '#f6b352' },
  { id: 't-b', label: 'B', color: '#f6e58d' },
  { id: 't-c', label: 'C', color: '#9adf7f' },
]

const ctrlBase: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
}

const accentRing = '2px solid color-mix(in srgb, #E85D2A 50%, transparent)'

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

function DraggableImage({
  id,
  src,
  kind,
}: {
  id: string
  src: string
  kind: TierCardKind
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id,
    data: { kind: 'card', id },
  })
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: `card-${id}`,
    data: { kind: 'card-target', id },
  })

  const setRefs = useCallback(
    (node: HTMLButtonElement | null) => {
      setNodeRef(node)
      setDropRef(node)
    },
    [setDropRef, setNodeRef],
  )

  const style = transform
    ? { transform: CSS.Translate.toString(transform), zIndex: isDragging ? 50 : undefined }
    : undefined

  const { width, height, fit } = thumbDimensions(kind)

  return (
    <button
      type="button"
      ref={setRefs}
      // draggable={false} + onDragStart preventDefault eliminate the
      // browser's native HTML5 drag preview (a translucent screenshot
      // that some macOS browsers attach to focused buttons containing
      // images, on top of @dnd-kit's DragOverlay — produces a visible
      // "ghost" layered above our drag preview).
      draggable={false}
      onDragStart={(e) => e.preventDefault()}
      style={{
        ...style,
        touchAction: 'none',
        // Source thumb is hidden during drag — the DragOverlay below
        // is the only thing the user should see following the cursor.
        // visibility (not opacity) avoids any partial paint of the
        // source while the overlay is in flight.
        visibility: isDragging ? 'hidden' : undefined,
        padding: 0,
        cursor: 'grab',
        flexShrink: 0,
        width,
        height,
        outline: isOver ? accentRing : undefined,
        outlineOffset: isOver ? 2 : undefined,
        userSelect: 'none',
        WebkitUserSelect: 'none',
      }}
      className="tier-list-thumb"
      {...listeners}
      {...attributes}
      aria-label="Drag to rank image"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        draggable={false}
        // pointer-events:none forwards every press / drag motion
        // straight to the parent <button>, so the browser never has a
        // chance to initiate native image-drag against the <img>.
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

  const cardId = overId.startsWith('card-') ? overId.slice('card-'.length) : overId
  const hit = cards.find((c) => c.id === cardId)
  if (!hit) return null
  return { tierId: hit.tierId, overCardId: cardId }
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

async function copyNodeAsImage(node: HTMLElement): Promise<'copied' | 'downloaded'> {
  const blob = await toBlob(node, {
    pixelRatio: 2,
    cacheBust: true,
    backgroundColor: getComputedStyle(document.documentElement).getPropertyValue('--bg') || '#111',
  })
  if (!blob) throw new Error('Could not render image')

  if (
    navigator.clipboard &&
    typeof navigator.clipboard.write === 'function' &&
    typeof ClipboardItem !== 'undefined'
  ) {
    await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
    return 'copied'
  }

  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'cardwall-tier-list.png'
  a.click()
  URL.revokeObjectURL(url)
  return 'downloaded'
}

export function TierListMaker() {
  const formId = useId()
  const boardRef = useRef<HTMLDivElement>(null)

  const tierPool = useStore((s) => s.tierPool)
  const removeFromTierPool = useStore((s) => s.removeFromTierPool)

  const [tiers, setTiers] = useState<TierDef[]>(() => DEFAULT_TIERS.map((t) => ({ ...t })))
  const [cards, setCards] = useState<TierCard[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [editorOpen, setEditorOpen] = useState(true)
  const [pasteHint, setPasteHint] = useState('Paste images anywhere on this page')
  const [exporting, setExporting] = useState<'copy' | null>(null)
  const [exportHint, setExportHint] = useState<string | null>(null)

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
      })
    }
    if (!next.length) return
    setCards((c) => [...c, ...next])
    setPasteHint(`${next.length} image${next.length === 1 ? '' : 's'} added`)
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

  // Revoke locally-created blob: URLs on unmount. We must not revoke
  // every card on each render (that breaks live previews) and we must
  // never call revoke on a normal http(s) URL pulled in from the store.
  const cardsRef = useRef<TierCard[]>([])
  useEffect(() => {
    cardsRef.current = cards
  }, [cards])
  useEffect(() => {
    return () => {
      for (const c of cardsRef.current) {
        if (c.src.startsWith('blob:')) URL.revokeObjectURL(c.src)
      }
    }
  }, [])

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
          additions.push({ id: item.id, src: item.src, tierId: null, kind: 'gallery' })
        }
      }
      if (additions.length === 0) return current
      return [...current, ...additions]
    })
  }, [tierPool])

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

  const moveTier = useCallback((idx: number, dir: -1 | 1) => {
    setTiers((prev) => {
      const j = idx + dir
      if (j < 0 || j >= prev.length) return prev
      const copy = [...prev]
      ;[copy[idx], copy[j]] = [copy[j], copy[idx]]
      return copy
    })
  }, [])

  const exportCopy = useCallback(async () => {
    if (!boardRef.current) return
    try {
      setExporting('copy')
      const result = await copyNodeAsImage(boardRef.current)
      setExportHint(result === 'copied' ? 'Copied to clipboard' : 'Clipboard unavailable: downloaded PNG')
    } catch {
      setExportHint('Export failed; try again')
    } finally {
      setExporting(null)
    }
  }, [])

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
      <header
        className="sticky top-0 z-20 px-4 py-3"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3">
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
              className="inline-flex items-center px-3 text-xs font-medium"
              style={{ ...ctrlBase, height: 30 }}
            >
              {editorOpen ? 'Hide tier editor' : 'Edit tiers'}
            </button>
            <label htmlFor={`${formId}-file`} style={uploadChip}>
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
            <button
              type="button"
              onClick={exportCopy}
              className="inline-flex items-center gap-1 px-3 text-xs font-medium"
              style={{ ...ctrlBase, height: 30 }}
              disabled={exporting !== null}
            >
              {exporting === 'copy' ? <Loader2 size={14} className="animate-spin" /> : <Clipboard size={14} />}
              Copy chart
            </button>
          </div>
        </div>
      </header>

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
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>
                Tier rows
              </p>
              <button
                type="button"
                onClick={addTier}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
                style={{ ...ctrlBase, height: 28 }}
              >
                <Plus size={14} aria-hidden />
                Add tier
              </button>
            </div>
            <ul className="flex flex-col gap-2">
              {tiers.map((tier, idx) => (
                <li
                  key={tier.id}
                  className="flex flex-wrap items-center gap-2 p-2"
                  style={{
                    borderRadius: 6,
                    border: '1px solid var(--border-subtle)',
                    background: 'color-mix(in srgb, var(--bg-surface) 88%, var(--bg))',
                  }}
                >
                  <input
                    aria-label={`Tier ${idx + 1} color`}
                    type="color"
                    value={tier.color}
                    onChange={(e) =>
                      setTiers((prev) => prev.map((t) => (t.id === tier.id ? { ...t, color: e.target.value } : t)))
                    }
                    className="h-9 w-12 cursor-pointer rounded border bg-transparent"
                    style={{ borderColor: 'var(--border-subtle)' }}
                  />
                  <input
                    aria-label={`Tier ${idx + 1} label`}
                    type="text"
                    value={tier.label}
                    onChange={(e) =>
                      setTiers((prev) => prev.map((t) => (t.id === tier.id ? { ...t, label: e.target.value } : t)))
                    }
                    className="min-w-[6rem] flex-1 px-2 py-1.5 text-sm font-bold outline-none"
                    style={{ ...ctrlBase, borderRadius: 6 }}
                  />
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="inline-flex items-center justify-center"
                      style={{ ...ctrlBase, width: 30, height: 30, padding: 0 }}
                      onClick={() => moveTier(idx, -1)}
                      disabled={idx === 0}
                      aria-label="Move tier up"
                    >
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center"
                      style={{ ...ctrlBase, width: 30, height: 30, padding: 0 }}
                      onClick={() => moveTier(idx, 1)}
                      disabled={idx === tiers.length - 1}
                      aria-label="Move tier down"
                    >
                      <ArrowDown size={16} />
                    </button>
                    <button
                      type="button"
                      className="inline-flex items-center justify-center"
                      style={tierRemoveBtnStyle(tiers.length <= 1)}
                      disabled={tiers.length <= 1}
                      onClick={() => removeTier(tier.id)}
                      aria-label="Remove tier"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)' }}>
              Rename tiers (S+, S-, etc.), reorder rows, and drag items between rows.
            </p>
          </section>
        )}

        {exportHint && (
          <p className="mb-4 text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
            {exportHint}
          </p>
        )}

        <DndContext
          sensors={sensors}
          collisionDetection={collisionDetection}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={onDragCancel}
        >
          <section aria-label="Image pool" className="mb-8">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                Pool
              </h2>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {pasteHint}
              </p>
              {cards.some((c) => c.tierId === null) && (
                <button
                  type="button"
                  onClick={clearBankOnly}
                  className="text-xs underline-offset-2 hover:underline"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Clear pool
                </button>
              )}
            </div>
            <DropZone
              id="bank"
              className="flex min-h-[128px] flex-wrap content-center items-center gap-2 p-3"
              style={{
                borderRadius: 8,
                border: '1px solid var(--border-subtle)',
                boxShadow: 'var(--shadow-card)',
                background: 'var(--bg-surface)',
              }}
            >
              {cards.filter((c) => c.tierId === null).length === 0 ? (
                <p className="w-full py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  Upload or paste images, then drag them into a tier.
                </p>
              ) : (
                cards
                  .filter((c) => c.tierId === null)
                  .map((c) => (
                    <div key={c.id} className="group relative">
                      <DraggableImage id={c.id} src={c.src} kind={c.kind} />
                      <button
                        type="button"
                        onClick={() => removeCard(c.id)}
                        className="absolute -right-1 -top-1 flex items-center justify-center rounded-full opacity-0 shadow-md transition group-hover:opacity-100"
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
                  ))
              )}
            </DropZone>
          </section>

          <div
            ref={boardRef}
            className="relative overflow-hidden rounded-[12px] p-4 sm:p-5"
            style={{
              border: '1px solid var(--border-subtle)',
              boxShadow: 'var(--shadow-card)',
              background:
                'linear-gradient(180deg, color-mix(in srgb, var(--bg-surface) 97%, var(--bg)) 0%, color-mix(in srgb, var(--bg-surface) 92%, var(--bg)) 100%)',
            }}
          >
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
                    {cards
                      .filter((c) => c.tierId === tier.id)
                      .map((c) => (
                        <div key={c.id} className="group relative">
                          <DraggableImage id={c.id} src={c.src} kind={c.kind} />
                          <button
                            type="button"
                            onClick={() => removeCard(c.id)}
                            className="absolute -right-1 -top-1 flex items-center justify-center rounded-full opacity-0 shadow-md transition group-hover:opacity-100"
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
                      ))}
                  </DropZone>
                </div>
              ))}
            </section>
            <BoardWatermark />
          </div>

          <DragOverlay adjustScale={false} dropAnimation={null}>
            {activeCard ? (() => {
              const { width, height, fit } = thumbDimensions(activeCard.kind)
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
                    src={activeCard.src}
                    alt=""
                    draggable={false}
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

        <p className="mt-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Runs in your browser only. Images are not uploaded to any server.
        </p>
      </div>
    </div>
  )
}
