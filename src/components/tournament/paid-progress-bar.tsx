'use client'

import { Coins, Users } from 'lucide-react'

const GREEN = '#22c55e'

/** Bare segmented bar: one little cell per slot, filling green with progress.
 *  Reused by the hero strip and the lobby tiles. `size` tunes the cell height
 *  so it reads well both as a compact tile strip and inline in the hero. */
export function SegmentBar({
  filled,
  total,
  size = 'md',
}: {
  filled: number
  total: number
  size?: 'sm' | 'md'
}) {
  const segTotal = Math.max(Math.floor(total) || 0, 1)
  const clamped = Math.min(Math.max(Math.floor(filled) || 0, 0), segTotal)
  const h = size === 'sm' ? 6 : 10
  const gap = size === 'sm' ? 2 : 3
  return (
    <div
      className="flex items-center"
      style={{ gap }}
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={segTotal}
    >
      {Array.from({ length: segTotal }).map((_, i) => {
        const on = i < clamped
        return (
          <span
            key={i}
            style={{
              flex: '1 1 0',
              minWidth: size === 'sm' ? 3 : 4,
              height: h,
              borderRadius: size === 'sm' ? 2 : 3,
              background: on ? GREEN : 'color-mix(in srgb, var(--bg) 55%, transparent)',
              border: on ? `1px solid ${GREEN}` : '1px solid var(--border-subtle)',
              boxShadow: on ? `0 0 8px color-mix(in srgb, ${GREEN} 45%, transparent)` : 'none',
              transition: 'background 220ms ease, box-shadow 220ms ease, border-color 220ms ease',
            }}
          />
        )
      })}
    </div>
  )
}

// Two-phase field tracker for paid tournaments:
//   - `applied`: total = the field size we're recruiting for (the cap). Fills
//     as people join with their wallet.
//   - `funded`: total = the approved roster. Fills as approved entrants pay
//     their entry into the escrow.
// `inline` drops the card chrome + helper copy so it can be tucked into the
// event hero next to the meta chips; the default renders a standalone card.
export function PaidProgressBar({
  phase,
  filled,
  total,
  inline = false,
}: {
  phase: 'applied' | 'funded'
  filled: number
  total: number
  inline?: boolean
}) {
  const isApplied = phase === 'applied'
  const safeTotal = Math.max(Math.floor(total) || 0, 0)
  const clamped = Math.min(Math.max(Math.floor(filled) || 0, 0), Math.max(safeTotal, 1))
  const Icon = isApplied ? Users : Coins
  const label = isApplied ? 'Applications' : 'Entries funded'
  const unit = isApplied ? 'applied' : 'funded'

  const header = (
    <div className="mb-2 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <Icon size={15} style={{ color: isApplied ? 'var(--tcw-accent)' : GREEN }} aria-hidden />
        <span
          className="text-[11px] font-bold uppercase tracking-widest"
          style={{ color: 'var(--text-muted)' }}
        >
          {label}
        </span>
      </div>
      <span
        className="bonk-mono shrink-0 text-sm font-bold tabular-nums"
        style={{ color: 'var(--text-secondary)' }}
      >
        {clamped} / {safeTotal}{' '}
        <span className="font-medium" style={{ color: 'var(--text-muted)' }}>
          {unit}
        </span>
      </span>
    </div>
  )

  if (inline) {
    return (
      <div
        className="mt-4 rounded-lg p-3"
        style={{
          background: 'color-mix(in srgb, var(--bg) 82%, transparent)',
          border: '1px solid var(--border-subtle)',
        }}
      >
        {header}
        <SegmentBar filled={clamped} total={safeTotal} />
      </div>
    )
  }

  return (
    <div
      className="mb-6 overflow-hidden"
      style={{
        background: 'var(--bg-surface)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 14,
        boxShadow: 'var(--shadow-card)',
      }}
    >
      <div className="p-5">
        {header}
        <SegmentBar filled={clamped} total={safeTotal} />
        <p className="mt-3 text-xs" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
          {isApplied
            ? 'Join with your wallet to claim a spot. Once the field is set and approved, entrants fund the prize pool.'
            : 'Approved entrants are funding the prize pool. The bracket starts once everyone has paid.'}
        </p>
      </div>
    </div>
  )
}
