'use client'

import Link from 'next/link'
import { ChevronRight, Trophy } from 'lucide-react'

// Reusable breadcrumb trail for the tournament surfaces. Renders a single muted
// row of ancestor links plus the current (non-link) page label, so a user deep
// inside a paid game or admin console can hop back up the hierarchy in one tap.
// The chooser at /tournaments is the root and intentionally renders no crumb.
//
// Mobile-first: the ancestor links stay intact while a long current label (e.g.
// a full tournament name) truncates with an ellipsis, so the row never overflows.

export type BreadcrumbItem = { label: string; href?: string }

export function TournamentBreadcrumb({ items }: { items: BreadcrumbItem[] }) {
  if (items.length === 0) return null

  return (
    <nav
      aria-label="Breadcrumb"
      className="mb-4 flex min-w-0 items-center gap-1.5 text-[12.5px] font-semibold sm:text-[13px]"
      style={{ color: 'var(--text-muted)' }}
    >
      <Trophy size={13} aria-hidden style={{ color: 'var(--tcw-accent)', flexShrink: 0 }} />
      <ol className="flex min-w-0 items-center gap-1.5">
        {items.map((item, i) => {
          const isLast = i === items.length - 1
          const isCurrent = isLast || !item.href
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {i > 0 && (
                <ChevronRight
                  size={13}
                  aria-hidden
                  style={{ color: 'var(--text-muted)', opacity: 0.6, flexShrink: 0 }}
                />
              )}
              {isCurrent ? (
                <span
                  aria-current="page"
                  className="min-w-0 truncate"
                  style={{ color: 'var(--text-secondary)' }}
                >
                  {item.label}
                </span>
              ) : (
                <Link
                  href={item.href as string}
                  className="shrink-0 whitespace-nowrap transition-colors hover:text-[var(--text-secondary)]"
                >
                  {item.label}
                </Link>
              )}
            </li>
          )
        })}
      </ol>
    </nav>
  )
}
