'use client'

// ProfileShelf - the shared frame for the profile "shelves" (badges, prizes).
// Every profile renders each shelf in the same structure so the modal is always
// the same size:
//   - loading -> a horizontal row of skeleton chips (reserves the space)
//   - empty   -> a single discreet "nothing here yet" line
//   - ready   -> the content in a single horizontal, swipeable row
//
// Overflow is always horizontal (never vertical), matching the rest of the
// profile so the modal never needs to scroll down.

import type { LucideIcon } from 'lucide-react'

export type ShelfState = 'loading' | 'empty' | 'ready'

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
      <div className="mb-2.5 flex items-center gap-1.5">
        <Icon size={14} style={{ color: iconColor, flexShrink: 0 }} />
        <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
          {title}
        </span>
      </div>

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
        <div className="profile-hscroll profile-section-in">
          <div className="profile-hrow gap-2.5">{children}</div>
        </div>
      )}
    </div>
  )
}
