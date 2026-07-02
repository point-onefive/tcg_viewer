'use client'

// AwardLightbox - tap a badge or prize to enlarge it in place. It covers the
// profile card (NOT a second modal on top of the first) so the enlarged art is
// the star, with a single, optional secondary action to open the event it came
// from. The profile stays mounted underneath and returns instantly on close.
//
// Rendered as `position: absolute; inset: 0` inside a positioned ancestor (the
// modal card / the profile card), so the same component works in both the popup
// and the full-page profile without nesting portals.

import { useEffect } from 'react'
import Link from 'next/link'
import { ArrowLeft, ExternalLink } from 'lucide-react'

/** A single enlargeable award (a badge or a prize), source-agnostic. */
export interface AwardItem {
  key: string
  image: string | null
  /** Headline, e.g. the badge name or prize title. */
  title: string
  /** One-liner under the title, e.g. "BONK Championship - finished 1st". */
  subtitle?: string
  /** Longer context shown below (prize details, badge blurb). */
  description?: string
  /** Where "View event" goes; omit to hide the action. */
  link?: string
  /** Frame / accent color (tier or medal); defaults to the app accent. */
  accent?: string
}

export function AwardLightbox({ item, onClose }: { item: AwardItem; onClose: () => void }) {
  const accent = item.accent ?? 'var(--tcw-accent)'

  // Escape closes the lightbox FIRST (not the whole profile modal). Capture
  // phase + stopImmediatePropagation beats the ModalPortal's document listener.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [onClose])

  return (
    <div
      className="award-lightbox"
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 30,
        display: 'flex',
        flexDirection: 'column',
        background: 'color-mix(in srgb, var(--bg-surface) 90%, transparent)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
      }}
    >
      {/* Back row - 44px tap target, top-left per mobile convention. */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '12px 12px 2px', flexShrink: 0 }}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="inline-flex items-center gap-1.5 text-sm font-semibold"
          style={{
            minHeight: 40,
            padding: '8px 12px 8px 8px',
            borderRadius: 10,
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
          }}
          aria-label="Back to profile"
        >
          <ArrowLeft size={17} /> Back
        </button>
      </div>

      {/* Enlarged art + meta. The image frame flexes to consume the remaining
          height so the whole thing ALWAYS fits the fixed modal - no scroll, no
          clipped top. Stops click-through so taps here don't dismiss. */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="award-lightbox__panel"
        style={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 16,
          padding: '2px 24px 24px',
          textAlign: 'center',
        }}
      >
        {/* Image area: grows/shrinks to fill leftover space; image scales in. */}
        <div style={{ flex: '1 1 auto', minHeight: 0, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              maxWidth: 'min(280px, 80%)',
              maxHeight: '100%',
              padding: 16,
              borderRadius: 18,
              boxSizing: 'border-box',
              background: `radial-gradient(circle at 50% 30%, color-mix(in srgb, ${accent} 18%, var(--bg)) 0%, var(--bg) 80%)`,
              border: `1px solid color-mix(in srgb, ${accent} 40%, transparent)`,
              boxShadow: `0 24px 60px -22px color-mix(in srgb, ${accent} 55%, transparent)`,
            }}
          >
            {item.image ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={item.image}
                alt={item.title}
                style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
              />
            ) : (
              <div style={{ width: 120, height: 120 }} />
            )}
          </div>
        </div>

        <div style={{ flexShrink: 0, maxWidth: 320 }}>
          <h2 className="font-display" style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.01em', color: 'var(--text-primary)', lineHeight: 1.2 }}>
            {item.title}
          </h2>
          {item.subtitle && (
            <div className="mt-1 text-sm font-semibold" style={{ color: accent }}>
              {item.subtitle}
            </div>
          )}
          {item.description && (
            <p className="mt-1.5 text-[13px] whitespace-pre-wrap" style={{ color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              {item.description}
            </p>
          )}
        </div>

        {item.link && (
          <Link
            href={item.link}
            className="inline-flex items-center justify-center gap-2 font-display font-bold"
            style={{
              flexShrink: 0,
              minHeight: 44,
              padding: '0 20px',
              borderRadius: 11,
              background: accent,
              color: '#fff',
              fontSize: 14,
              boxShadow: `0 10px 24px -10px color-mix(in srgb, ${accent} 70%, transparent)`,
            }}
          >
            View event <ExternalLink size={15} />
          </Link>
        )}
      </div>
    </div>
  )
}
