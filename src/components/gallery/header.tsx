'use client'

import { ThemeToggle } from './theme-toggle'
import { useStore } from '@/lib/store'
import { CardSet } from '@/lib/types'
import { COLLECTIONS } from '@/lib/store'

interface HeaderProps {
  sets: CardSet[]
}

export function Header({ sets }: HeaderProps) {
  const {
    searchQuery, setSearchQuery,
    activeSet, setActiveSet,
    activeCollection, setActiveCollection,
    zoom, setZoom,
  } = useStore()

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50"
      style={{
        background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
        borderBottom: '1px solid var(--border-subtle)',
      }}
    >
      <div
        className="mx-auto flex items-center justify-between gap-6 px-4 md:px-4"
        style={{ maxWidth: 1800, height: 48 }}
      >
        {/* Brand - unified lockup: mascot chip + wordmark inside one block */}
        <a
          href="/"
          className="group inline-flex items-stretch overflow-hidden"
          aria-label="CARD WALL - home"
          style={{
            background: 'var(--text-primary)',
            color: 'var(--bg)',
            borderRadius: 3,
            height: 32,
            transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {/* Mascot chip - lighter panel that anchors him inside the mark */}
          <span
            className="inline-flex items-center justify-center"
            style={{
              background: 'var(--bg)',
              padding: '0 6px',
              border: '1px solid var(--text-primary)',
              borderRight: 'none',
              borderTopLeftRadius: 3,
              borderBottomLeftRadius: 3,
            }}
          >
            <img
              src="/images/site-logo.png"
              alt=""
              aria-hidden
              width={24}
              height={24}
              style={{
                height: 24,
                width: 'auto',
                imageRendering: 'pixelated',
                display: 'block',
                transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
              className="group-hover:scale-110 group-hover:-rotate-3"
            />
          </span>
          {/* Wordmark */}
          <span
            className="inline-flex items-center whitespace-nowrap"
            style={{
              padding: '0 12px',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 14,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
            }}
          >
            Card Wall
          </span>
        </a>

        {/* Controls cluster */}
        <div className="flex items-center gap-2">
          {/* Collection Filter */}
          <select
            value={activeCollection}
            onChange={(e) => setActiveCollection(e.target.value as typeof activeCollection)}
            className="hidden md:block px-3 py-1.5 text-xs rounded-full outline-none cursor-pointer appearance-none font-medium"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
            aria-label="Collection"
          >
            {COLLECTIONS.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.available}>
                {c.name}{!c.available ? ' (coming soon)' : ''}
              </option>
            ))}
          </select>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search..."
            className="hidden md:block w-48 px-3 py-1.5 text-xs rounded-full outline-none transition-[width,border-color] duration-300 focus:w-64"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          />

          {/* Set Filter */}
          <select
            value={activeSet || ''}
            onChange={(e) => setActiveSet(e.target.value || null)}
            className="hidden md:block px-3 py-1.5 text-xs rounded-full outline-none cursor-pointer appearance-none max-w-[160px]"
            style={{
              background: 'var(--bg-surface)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <option value="">All Sets</option>
            {sets.map((s) => (
              <option key={s.setCode} value={s.setCode}>
                {s.setCode} - {s.setName}
              </option>
            ))}
          </select>

          {/* Divider */}
          <div
            className="hidden md:block mx-1"
            style={{ width: 1, height: 20, background: 'var(--border-subtle)' }}
            aria-hidden
          />

          {/* Zoom slider */}
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full"
            style={{
              background: 'var(--bg-surface)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="zoom-slider"
              aria-label="Zoom level"
              style={{ width: 72 }}
            />
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
          </div>

          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
