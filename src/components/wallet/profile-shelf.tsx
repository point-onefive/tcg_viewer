'use client'

// ProfileShelf - the shared frame for the profile "shelves" (badges, prizes).
// Every profile renders each shelf in the same structure so the modal is always
// the same size:
//   - loading -> a horizontal row of skeleton chips (reserves the space)
//   - empty   -> a single discreet "nothing here yet" line
//   - ready   -> the content in a single horizontal, swipeable row
//
// Overflow is horizontal, but the scroll affordance only appears WHEN the row
// actually overflows: an edge fade plus a chevron button that scrolls. A short
// row (a couple of items) shows neither, so it never looks faded/cut off.

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

export type ShelfState = 'loading' | 'empty' | 'ready'

/**
 * A horizontally scrollable row that only reveals a scroll affordance when its
 * content overflows. Shows an edge fade on the overflowing side(s) and a round
 * chevron button to scroll - so on desktop it's obvious there's more, and on a
 * non-overflowing row nothing is drawn.
 */
export function ShelfRow({ children, gapClass = 'gap-2.5' }: { children: React.ReactNode; gapClass?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [ov, setOv] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setOv((p) => (p.left === left && p.right === right ? p : { left, right }))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    measure()
    // ResizeObserver catches late reflow (badge/prize images finish loading and
    // grow the row) as well as viewport resizes.
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    if (el.firstElementChild) ro.observe(el.firstElementChild)
    el.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
    }
  }, [measure])

  const scrollByPage = (dir: number) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.7, behavior: 'smooth' })
  }

  const maskClass = ov.left && ov.right ? 'hscroll-mask-both' : ov.right ? 'hscroll-mask-right' : ov.left ? 'hscroll-mask-left' : ''

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} className={`hscroll ${maskClass}`}>
        <div className={`profile-hrow ${gapClass}`}>{children}</div>
      </div>
      {ov.left && <ScrollChevron side="left" onClick={() => scrollByPage(-1)} />}
      {ov.right && <ScrollChevron side="right" onClick={() => scrollByPage(1)} />}
    </div>
  )
}

function ScrollChevron({ side, onClick }: { side: 'left' | 'right'; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      className="flex items-center justify-center"
      style={{
        position: 'absolute',
        top: '50%',
        transform: 'translateY(-50%)',
        [side]: -6,
        width: 28,
        height: 28,
        borderRadius: '50%',
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        boxShadow: 'var(--shadow-card)',
        color: 'var(--text-secondary)',
        cursor: 'pointer',
        zIndex: 5,
      } as React.CSSProperties}
    >
      <Icon size={16} />
    </button>
  )
}

/**
 * The one section header used across the whole profile (badges, prizes,
 * availability) so every section reads identically: a small colored icon and an
 * uppercase micro-label, with optional trailing note. Keeps the modal cohesive.
 */
export function ProfileSectionLabel({
  icon: Icon,
  iconColor = 'var(--tcw-accent)',
  title,
  note,
}: {
  icon: LucideIcon
  iconColor?: string
  title: string
  note?: string
}) {
  return (
    <div className="mb-2.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
      <span className="inline-flex items-center gap-1.5">
        <Icon size={14} style={{ color: iconColor, flexShrink: 0 }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {title}
        </span>
      </span>
      {note && (
        <span className="text-[11px]" style={{ color: 'var(--text-muted)', opacity: 0.8 }}>
          {note}
        </span>
      )}
    </div>
  )
}

export function ProfileShelf({
  icon: Icon,
  iconColor = 'var(--tcw-accent)',
  title,
  state,
  emptyText,
  skeletonCount = 3,
  skeletonWidth,
  skeletonHeight,
  skeletonRadius = 8,
  children,
}: {
  icon: LucideIcon
  iconColor?: string
  title: string
  state: ShelfState
  emptyText: string
  skeletonCount?: number
  skeletonWidth: number
  skeletonHeight: number
  skeletonRadius?: number
  children?: React.ReactNode
}) {
  return (
    <div className="mt-5">
      <ProfileSectionLabel icon={Icon} iconColor={iconColor} title={title} />

      {state === 'loading' ? (
        <div className="profile-hscroll">
          <div className="profile-hrow gap-2.5">
            {Array.from({ length: skeletonCount }).map((_, i) => (
              <div
                key={i}
                className="profile-skel"
                style={{ width: skeletonWidth, height: skeletonHeight, borderRadius: skeletonRadius }}
                aria-hidden
              />
            ))}
          </div>
        </div>
      ) : state === 'empty' ? (
        <div
          className="flex items-center px-3"
          style={{
            minHeight: skeletonHeight,
            borderRadius: 8,
            border: '1px dashed var(--border-subtle)',
            background: 'color-mix(in srgb, var(--bg) 60%, transparent)',
          }}
        >
          <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.75 }}>
            {emptyText}
          </span>
        </div>
      ) : (
        <div className="profile-section-in">
          <ShelfRow>{children}</ShelfRow>
        </div>
      )}
    </div>
  )
}
