'use client'

// ModalPortal - the canonical way to render any centered overlay in this app.
//
// Why this exists: `position: fixed` is captured by the nearest ancestor that
// has a `transform`, `filter`, or `backdrop-filter` (our sticky blurred
// headers do exactly this), so an inline-rendered modal anchors to that
// element instead of the viewport and ends up off-center / clipped. Rendering
// through a portal on document.body escapes that containing block.
//
// It also handles the things every modal needs: a dimmed backdrop, body
// scroll-lock, Escape-to-close, and viewport-safe sizing. Use this for all
// future modals/dialogs rather than hand-rolling fixed positioning.

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

interface ModalPortalProps {
  onClose: () => void
  children: React.ReactNode
  /** Accessible label for the dialog. */
  label?: string
  /** Max width of the modal card in px. Default 420. */
  maxWidth?: number
  /** If false, clicking the backdrop will not close. Default true. */
  closeOnBackdrop?: boolean
  /**
   * Optional class on the modal card. The modal renders through a portal on
   * document.body, outside any themed wrapper, so pass e.g. `bonk-theme` here
   * to make the card inherit a page-specific palette/section tokens.
   */
  className?: string
}

export function ModalPortal({
  onClose,
  children,
  label,
  maxWidth = 420,
  closeOnBackdrop = true,
  className,
}: ModalPortalProps) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <>
      {/* Backdrop */}
      <div
        style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 200 }}
        onClick={closeOnBackdrop ? onClose : undefined}
      />

      {/* Centering layer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={label}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 201,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'clamp(0px, 4vw, 16px)',
          pointerEvents: 'none',
        }}
      >
        <div
          className={className}
          style={{
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg-surface)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 16,
            boxShadow: 'var(--shadow-card)',
            width: '100%',
            maxWidth,
            maxHeight: 'min(680px, calc(100dvh - 24px))',
            pointerEvents: 'auto',
            overflow: 'hidden',
          }}
        >
          {children}
        </div>
      </div>
    </>,
    document.body,
  )
}
