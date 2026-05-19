'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import { AnimatePresence, motion } from 'motion/react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  useSortable,
  rectSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { X, Bookmark } from 'lucide-react'
import { useStore, pinKeyFor, type Pin } from '@/lib/store'
import { type Card } from '@/lib/types'

interface BoardPanelProps {
  cards: Card[]
}

interface PinnedItemProps {
  pin: Pin
  card: Card | undefined
  imgSrc: string | undefined
  label: string | undefined
  onRemove: () => void
}

function SortablePinnedItem({ pin, card, imgSrc, label, onRemove }: PinnedItemProps) {
  const key = pinKeyFor(pin)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: key,
  })

  // Plain div, not motion.div. Previously this used `<motion.div layout>`,
  // which made framer-motion run its FLIP layout animation *on top of*
  // dnd-kit/sortable's transform+transition for the same node — two
  // independent animation systems competing to move the same element
  // every time a neighbour shifted, producing the visible jitter the
  // user noticed during reorders. dnd-kit alone handles the bump
  // animation cleanly; framer's outer panel slide-in still uses motion.
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.4 : 1,
        zIndex: isDragging ? 10 : 1,
      }}
      className={`board-tile${isDragging ? ' board-tile--dragging' : ''}`}
      {...attributes}
      {...listeners}
    >
      {/* Card image fills the tile - focus is the art */}
      <div className="board-tile__img">
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={label ?? card?.name ?? key}
            fill
            sizes="160px"
            style={{ objectFit: 'cover' }}
          />
        ) : (
          <div className="board-tile__placeholder" />
        )}

        {/* Variant badge - subtle tag */}
        {pin.variantId && (
          <span className="board-tile__variant">{(label ?? pin.variantId).toUpperCase()}</span>
        )}

        {/* Remove X - hover only (desktop), always-on for touch.
            onPointerDown stops dnd-kit from treating click as a drag start. */}
        <button
          className="board-tile__remove"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          aria-label="Remove from board"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  )
}

export function BoardPanel({ cards }: BoardPanelProps) {
  const { boardOpen, setBoardOpen, pinned, removePin, reorderPins, activeCollection, clearActivePins } = useStore()
  const panelRef = useRef<HTMLDivElement>(null)

  // Only show pins from the active collection - the board is per-collection.
  const visiblePins = pinned.filter((p) => p.collection === activeCollection)

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } })
  )

  // While a drag is in flight we add `is-dragging` to the grid so CSS
  // can suppress the per-tile hover translateY(-2px). Without this,
  // every neighbour the cursor passes over while reordering bobs up
  // (hover transform) on top of the sortable transform shifting it
  // sideways — visible double-motion / jitter.
  const [isDragging, setIsDragging] = useState(false)

  // Two-click confirm for the "Clear all" header button. Clearing
  // pins is destructive with no in-app undo, so we surface a
  // tap-to-arm / tap-again-to-fire pattern instead of a modal: less
  // intrusive than confirm(), but still hard to trigger by accident.
  const [confirmingClear, setConfirmingClear] = useState(false)

  // Close on Escape
  useEffect(() => {
    if (!boardOpen) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setBoardOpen(false)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [boardOpen, setBoardOpen])

  // Focus trap - move focus into panel when it opens
  useEffect(() => {
    if (boardOpen) {
      setTimeout(() => panelRef.current?.focus(), 50)
    }
  }, [boardOpen])

  // Reset the armed Clear button when the panel closes — otherwise
  // it'd still be primed the next time the user opens the board.
  useEffect(() => {
    if (!boardOpen) setConfirmingClear(false)
  }, [boardOpen])

  // Auto-disarm after 5s of inactivity so the user can't accidentally
  // confirm minutes later by clicking the close button area. 5s gives
  // a relaxed window to read the "Confirm?" label and decide, while
  // still being short enough to feel like a deliberate two-step.
  useEffect(() => {
    if (!confirmingClear) return
    const t = setTimeout(() => setConfirmingClear(false), 5000)
    return () => clearTimeout(t)
  }, [confirmingClear])

  function handleClearClick() {
    if (confirmingClear) {
      clearActivePins()
      setConfirmingClear(false)
    } else {
      setConfirmingClear(true)
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setIsDragging(false)
    const { active, over } = event
    if (over && active.id !== over.id) {
      reorderPins(String(active.id), String(over.id))
    }
  }

  function resolvePin(pin: Pin): { card: Card | undefined; imgSrc: string | undefined; label: string | undefined } {
    const card = cards.find((c) => c.id === pin.cardId)
    if (!pin.variantId) {
      return { card, imgSrc: card?.imageLarge ?? card?.imageSmall, label: undefined }
    }
    const variant = card?.variants?.find((v) => v.id === pin.variantId)
    return { card, imgSrc: variant?.imageUrl, label: variant?.label }
  }

  const pinnedKeys = visiblePins.map(pinKeyFor)

  return (
    <AnimatePresence>
      {boardOpen && (
        <>
          {/* Scrim */}
          <motion.div
            key="board-scrim"
            className="board-scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setBoardOpen(false)}
            aria-hidden
          />

          {/* Panel */}
          <motion.aside
            key="board-panel"
            ref={panelRef}
            tabIndex={-1}
            role="dialog"
            aria-label="Pinned board"
            aria-modal="true"
            className="board-panel"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 340, damping: 38, mass: 0.9 }}
          >
            {/* Header */}
            <div className="board-panel__header">
              <div className="board-panel__title">
                <Bookmark size={14} strokeWidth={2} fill="currentColor" />
                <span>Board</span>
                {visiblePins.length > 0 && (
                  <span className="board-panel__count">{visiblePins.length}</span>
                )}
              </div>
              <div className="board-panel__actions">
                {visiblePins.length > 0 && (
                  <button
                    className={`board-panel__clear${confirmingClear ? ' board-panel__clear--armed' : ''}`}
                    onClick={handleClearClick}
                    aria-label={
                      confirmingClear
                        ? 'Confirm clear all pinned cards'
                        : 'Clear all pinned cards'
                    }
                  >
                    {confirmingClear ? 'Confirm?' : 'Clear all'}
                  </button>
                )}
                <button
                  className="board-panel__close"
                  onClick={() => setBoardOpen(false)}
                  aria-label="Close board"
                >
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="board-panel__body">
              {visiblePins.length === 0 ? (
                <div className="board-panel__empty">
                  <Bookmark size={28} strokeWidth={1.5} />
                  <p>Pin cards to build your board.</p>
                  <p className="board-panel__empty-hint">
                    Use the bookmark icon on any card or open a card for variant art.
                  </p>
                </div>
              ) : (
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragStart={() => setIsDragging(true)}
                  onDragEnd={handleDragEnd}
                  onDragCancel={() => setIsDragging(false)}
                >
                  <SortableContext items={pinnedKeys} strategy={rectSortingStrategy}>
                    <div className={`board-grid${isDragging ? ' is-dragging' : ''}`}>
                      {visiblePins.map((pin) => {
                        const key = pinKeyFor(pin)
                        const { card, imgSrc, label } = resolvePin(pin)
                        return (
                          <SortablePinnedItem
                            key={key}
                            pin={pin}
                            card={card}
                            imgSrc={imgSrc}
                            label={label}
                            onRemove={() => removePin(key)}
                          />
                        )
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              )}
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}
