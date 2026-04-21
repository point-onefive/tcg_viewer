'use client'

import { useEffect, useRef, useState } from 'react'
import { ThemeToggle } from './theme-toggle'
import { Bookmark, Menu, X, Check, ChevronDown } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
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
    pinned, setBoardOpen,
  } = useStore()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collectionOpen, setCollectionOpen] = useState(false)
  const collectionRef = useRef<HTMLDivElement>(null)

  // Close collection dropdown on outside click / Escape
  useEffect(() => {
    if (!collectionOpen) return
    const onDown = (e: MouseEvent) => {
      if (collectionRef.current && !collectionRef.current.contains(e.target as Node)) {
        setCollectionOpen(false)
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCollectionOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [collectionOpen])

  const activeCollectionName = COLLECTIONS.find((c) => c.id === activeCollection)?.name ?? 'Collection'

  // Pin count is per-collection (matches board panel behaviour).
  const pinnedCount = pinned.filter((p) => p.collection === activeCollection).length

  // Shared style token · matches logo's rounded-rect language
  const ctrl: React.CSSProperties = {
    background: 'var(--bg-surface)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-subtle)',
    borderRadius: 6,
  }

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
            borderRadius: 6,
            height: 30,
            transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
          }}
        >
          {/* Mascot chip - lighter panel that anchors him inside the mark */}
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
                transition: 'transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
              className="group-hover:scale-110 group-hover:-rotate-3"
            />
          </span>
          {/* Wordmark */}
          <span
            className="inline-flex items-center whitespace-nowrap"
            style={{
              padding: '0 11px',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 13,
              lineHeight: 1,
              letterSpacing: '-0.01em',
              textTransform: 'uppercase',
            }}
          >
            Card Wall
          </span>
        </a>

        {/* ── Desktop controls ── */}
        <div className="hidden md:flex items-center gap-2">
          {/* Collection Filter (custom popover so menu stays inside the site) */}
          <div ref={collectionRef} className="relative">
            <button
              type="button"
              onClick={() => setCollectionOpen((o) => !o)}
              className="inline-flex items-center gap-1.5 px-3 text-xs font-medium"
              style={{ ...ctrl, height: 30 }}
              aria-haspopup="listbox"
              aria-expanded={collectionOpen}
              aria-label="Collection"
            >
              <span>{activeCollectionName}</span>
              <ChevronDown
                size={12}
                strokeWidth={2.25}
                style={{
                  transition: 'transform 180ms ease',
                  transform: collectionOpen ? 'rotate(180deg)' : 'rotate(0)',
                  color: 'var(--text-muted)',
                }}
              />
            </button>

            <AnimatePresence>
              {collectionOpen && (
                <motion.div
                  role="listbox"
                  aria-label="Collection"
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ duration: 0.14, ease: [0.22, 1, 0.36, 1] }}
                  className="absolute left-0 top-full mt-1.5 min-w-[180px] overflow-hidden"
                  style={{
                    transformOrigin: 'top left',
                    background: 'var(--bg-surface)',
                    border: '1px solid var(--border-subtle)',
                    borderRadius: 8,
                    boxShadow: 'var(--shadow-card)',
                    zIndex: 60,
                    padding: 4,
                  }}
                >
                  {COLLECTIONS.map((c) => {
                    const selected = c.id === activeCollection
                    const disabled = !c.available
                    return (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        disabled={disabled}
                        onClick={() => {
                          if (disabled) return
                          setActiveCollection(c.id)
                          setCollectionOpen(false)
                        }}
                        className="w-full flex items-center gap-2 px-2.5 text-xs font-medium text-left transition-colors"
                        style={{
                          height: 30,
                          borderRadius: 5,
                          background: selected ? 'var(--text-primary)' : 'transparent',
                          color: selected
                            ? 'var(--bg)'
                            : disabled
                            ? 'var(--text-muted)'
                            : 'var(--text-primary)',
                          cursor: disabled ? 'not-allowed' : 'pointer',
                          opacity: disabled ? 0.55 : 1,
                        }}
                        onMouseEnter={(e) => {
                          if (!selected && !disabled) {
                            e.currentTarget.style.background = 'color-mix(in srgb, var(--text-primary) 8%, transparent)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!selected) e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <Check
                          size={12}
                          strokeWidth={2.5}
                          style={{ opacity: selected ? 1 : 0, flexShrink: 0 }}
                        />
                        <span className="flex-1">{c.name}</span>
                        {disabled && (
                          <span style={{ fontSize: 10, color: 'var(--text-muted)', letterSpacing: '0.04em' }}>
                            soon
                          </span>
                        )}
                      </button>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Set Filter */}
          <select
            value={activeSet || ''}
            onChange={(e) => setActiveSet(e.target.value || null)}
            className="px-3 py-1.5 text-xs outline-none cursor-pointer appearance-none max-w-[150px]"
            style={{ ...ctrl, height: 30 }}
          >
            <option value="">All Sets</option>
            {sets.map((s) => (
              <option key={s.setCode} value={s.setCode}>
                {s.setCode} · {s.setName}
              </option>
            ))}
          </select>

          {/* Search */}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards…"
            className="w-40 px-3 py-1.5 text-xs outline-none transition-[width] duration-300 focus:w-56"
            style={{ ...ctrl, height: 30 }}
          />

          {/* Divider - prominent vertical rule separating filter group from zoom */}
          <div
            aria-hidden
            style={{
              width: 1,
              height: 24,
              background: 'var(--text-muted)',
              opacity: 0.45,
              margin: '0 6px',
            }}
          />

          {/* Zoom slider */}
          <div
            className="flex items-center gap-2 px-3"
            style={{ ...ctrl, height: 30 }}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
            <input
              type="range" min={1} max={12} step={1} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="zoom-slider" aria-label="Zoom level" style={{ width: 72 }}
            />
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
          </div>

          <ThemeToggle />

          {/* Board trigger */}
          <button
            className="inline-flex items-center gap-1.5 px-3 text-xs font-medium"
            style={{
              ...ctrl,
              height: 30,
              background: pinnedCount > 0 ? 'var(--text-primary)' : 'var(--bg-surface)',
              color: pinnedCount > 0 ? 'var(--bg)' : 'var(--text-primary)',
              transition: 'background 0.2s ease, color 0.2s ease',
            }}
            onClick={() => setBoardOpen(true)}
            aria-label={`Open board (${pinnedCount} pinned)`}
          >
            <Bookmark size={12} strokeWidth={2} fill={pinnedCount > 0 ? 'currentColor' : 'none'} />
            Board
            {pinnedCount > 0 && (
              <span
                className="inline-flex items-center justify-center text-[10px] font-bold leading-none"
                style={{ minWidth: 16, height: 16, padding: '0 4px', borderRadius: 4, background: 'var(--bg)', color: 'var(--text-primary)' }}
              >
                {pinnedCount}
              </span>
            )}
          </button>
        </div>

        {/* ── Mobile right cluster ── */}
        <div className="flex md:hidden items-center gap-2">
          {/* Board icon - only if pins exist */}
          {pinnedCount > 0 && (
            <button
              className="relative inline-flex items-center justify-center"
              style={{ ...ctrl, width: 32, height: 32 }}
              onClick={() => setBoardOpen(true)}
              aria-label={`Board (${pinnedCount} pinned)`}
            >
              <Bookmark size={14} strokeWidth={2} fill="currentColor" />
              <span
                className="absolute -top-1 -right-1 inline-flex items-center justify-center text-[9px] font-bold"
                style={{ minWidth: 14, height: 14, padding: '0 3px', borderRadius: 999, background: 'var(--text-primary)', color: 'var(--bg)' }}
              >
                {pinnedCount}
              </span>
            </button>
          )}

          <ThemeToggle />

          {/* Hamburger */}
          <button
            className="inline-flex items-center justify-center"
            style={{ ...ctrl, width: 32, height: 32 }}
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X size={15} /> : <Menu size={15} />}
          </button>
        </div>
      </div>

      {/* ── Mobile filter sheet ── */}
      {mobileOpen && (
        <div
          className="md:hidden px-4 pb-4 pt-2 flex flex-col gap-3"
          style={{ borderTop: '1px solid var(--border-subtle)', background: 'color-mix(in srgb, var(--bg) 96%, transparent)' }}
        >
          <select
            value={activeCollection}
            onChange={(e) => { setActiveCollection(e.target.value as typeof activeCollection); setMobileOpen(false) }}
            className="w-full px-3 py-2 text-sm outline-none cursor-pointer appearance-none font-medium"
            style={{ ...ctrl }}
            aria-label="Collection"
          >
            {COLLECTIONS.map((c) => (
              <option key={c.id} value={c.id} disabled={!c.available}>
                {c.name}{!c.available ? ' (soon)' : ''}
              </option>
            ))}
          </select>

          <select
            value={activeSet || ''}
            onChange={(e) => { setActiveSet(e.target.value || null); setMobileOpen(false) }}
            className="w-full px-3 py-2 text-sm outline-none cursor-pointer appearance-none"
            style={{ ...ctrl }}
          >
            <option value="">All Sets</option>
            {sets.map((s) => (
              <option key={s.setCode} value={s.setCode}>
                {s.setCode} · {s.setName}
              </option>
            ))}
          </select>

          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards…"
            className="w-full px-3 py-2 text-sm outline-none"
            style={{ ...ctrl }}
          />

          {/* Zoom row · matches desktop icon language */}
          <div className="flex items-center gap-2 px-3 py-2" style={{ ...ctrl }}>
            <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="1" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="7" y="7" width="4" height="4" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
            <input
              type="range" min={1} max={12} step={1} value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
              className="zoom-slider flex-1" aria-label="Zoom level"
            />
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
              <rect x="1" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="1" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="1" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
              <rect x="9" y="9" width="6" height="6" rx="0.5" fill="currentColor" opacity="0.6"/>
            </svg>
          </div>
        </div>
      )}
    </header>
  )
}
