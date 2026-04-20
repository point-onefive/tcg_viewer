'use client'

import { ThemeToggle } from './theme-toggle'
import { useStore } from '@/lib/store'
import { CardSet } from '@/lib/types'

interface HeaderProps {
  sets: CardSet[]
}

export function Header({ sets }: HeaderProps) {
  const { searchQuery, setSearchQuery, activeSet, setActiveSet, zoom, setZoom } = useStore()

  return (
    <header
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-6 md:px-10 py-4"
      style={{
        background:
          'linear-gradient(to bottom, var(--bg) 60%, transparent)',
      }}
    >
      {/* Brand */}
      <div className="flex items-center gap-3">
        <h1
          className="text-lg md:text-xl font-bold tracking-tight uppercase"
          style={{
            fontFamily: 'var(--font-display)',
            color: 'var(--text-primary)',
            letterSpacing: '-0.02em',
          }}
        >
          ONE PIECE TCG
        </h1>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3">
        {/* Search */}
        <input
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search..."
          className="hidden md:block w-44 px-3 py-1.5 text-xs rounded-full outline-none transition-all duration-300 focus:w-56"
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
          className="hidden md:block px-3 py-1.5 text-xs rounded-full outline-none cursor-pointer appearance-none"
          style={{
            background: 'var(--bg-surface)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <option value="">All Sets</option>
          {sets.map((s) => (
            <option key={s.setCode} value={s.setCode}>
              {s.setCode} — {s.setName}
            </option>
          ))}
        </select>

        {/* Zoom slider */}
        <div className="hidden md:flex items-center gap-2">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5"/>
            <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5"/>
            <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5"/>
            <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.5"/>
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
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
            <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.5"/>
            <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.5"/>
            <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.5"/>
            <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.5"/>
          </svg>
        </div>

        <ThemeToggle />
      </div>
    </header>
  )
}
