'use client'

import { useEffect, useLayoutEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { X } from 'lucide-react'

/**
 * First-visit guided tour. Per-device — writes a flag to localStorage when
 * completed or skipped so it only ever shows once.
 *
 * Steps point at elements carrying `data-tour="<id>"`. If a target isn't in
 * the DOM for the current viewport, the step falls back to a centered card.
 */

const STORAGE_KEY = 'tcg-viewer-tour-seen-v2'

type Step = {
  id: string
  // Ordered list of selectors — first match wins. Useful so the same step
  // can target the desktop control OR the mobile hamburger icon.
  targets: string[]
  title: string
  body: string
}

const STEPS: Step[] = [
  {
    id: 'welcome',
    targets: [], // centered
    title: 'Welcome to The Card Wall',
    body: 'A quick 20-second tour so you can find your way around. You can skip any time.',
  },
  {
    id: 'collection',
    targets: ['[data-tour="collection"]', '[data-tour="menu"]'],
    title: 'Pick a collection',
    body: 'Switch between One Piece, Gundam, Dragon Ball Super, and Digimon.',
  },
  {
    id: 'set',
    targets: ['[data-tour="set"]', '[data-tour="menu"]'],
    title: 'Filter by set',
    body: 'Narrow the gallery down to a single set, or search by card name or code.',
  },
  {
    id: 'stack',
    targets: ['[data-tour="stack"]'],
    title: 'Cards with stacks',
    body: 'Cards that have alternate prints appear stacked. Tap one to browse every variant.',
  },
  {
    id: 'board',
    targets: ['[data-tour="board"]'],
    title: 'Pin favorites to your Board',
    body: 'Hit the bookmark on any card to pin it. Open the Board to arrange and review your picks.',
  },
  {
    id: 'feedback',
    targets: ['[data-tour="feedback"]', '[data-tour="menu"]'],
    title: 'Say hi · send feedback',
    body: 'Built by one person. DMs and feature ideas on X welcome — every follow helps keep this alive.',
  },
  {
    id: 'done',
    targets: [],
    title: 'You\u2019re all set',
    body: 'Have fun exploring. This tour won\u2019t show again on this device.',
  },
]

function findTarget(selectors: string[]): HTMLElement | null {
  for (const sel of selectors) {
    const el = document.querySelector<HTMLElement>(sel)
    if (el && el.offsetParent !== null) return el
  }
  return null
}

export function OnboardingTour() {
  const [open, setOpen] = useState(false)
  const [stepIdx, setStepIdx] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const [ready, setReady] = useState(false)

  // Decide whether to show on mount.
  useEffect(() => {
    try {
      if (localStorage.getItem(STORAGE_KEY)) return
    } catch {
      return
    }
    // Small delay so the gallery finishes its initial paint before overlay.
    const t = window.setTimeout(() => {
      setOpen(true)
      setReady(true)
    }, 700)
    return () => window.clearTimeout(t)
  }, [])

  const step = STEPS[stepIdx]

  // Measure target on step change + on scroll/resize.
  useLayoutEffect(() => {
    if (!open) return
    const measure = () => {
      if (step.targets.length === 0) {
        setRect(null)
        return
      }
      const el = findTarget(step.targets)
      if (!el) { setRect(null); return }
      // Scroll stack targets into view (card tiles may be below fold).
      if (step.id === 'stack') {
        const r = el.getBoundingClientRect()
        if (r.top < 80 || r.bottom > window.innerHeight - 80) {
          el.scrollIntoView({ block: 'center', behavior: 'smooth' })
          // Re-measure after scroll animation.
          window.setTimeout(() => {
            const el2 = findTarget(step.targets)
            if (el2) setRect(el2.getBoundingClientRect())
          }, 350)
          return
        }
      }
      setRect(el.getBoundingClientRect())
    }
    measure()
    window.addEventListener('resize', measure)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.removeEventListener('resize', measure)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, stepIdx, step])

  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, '1') } catch {}
    setOpen(false)
  }

  if (!ready) return null

  const isFirst = stepIdx === 0
  const isLast = stepIdx === STEPS.length - 1
  const next = () => (isLast ? finish() : setStepIdx((i) => i + 1))
  const prev = () => setStepIdx((i) => Math.max(0, i - 1))

  // Callout position: below the highlighted rect if there's room, otherwise
  // above. Centered if there's no target.
  const PAD = 12
  const CARD_W = 320
  let calloutStyle: React.CSSProperties
  if (rect) {
    const below = rect.bottom + PAD + 180 < window.innerHeight
    const top = below ? rect.bottom + PAD : Math.max(PAD, rect.top - PAD - 180)
    let left = rect.left + rect.width / 2 - CARD_W / 2
    left = Math.max(PAD, Math.min(left, window.innerWidth - CARD_W - PAD))
    calloutStyle = { position: 'fixed', top, left, width: CARD_W, zIndex: 10001 }
  } else {
    calloutStyle = {
      position: 'fixed', left: '50%', top: '50%',
      transform: 'translate(-50%, -50%)', width: Math.min(CARD_W, window.innerWidth - 2 * PAD),
      zIndex: 10001,
    }
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop with a cut-out around the target */}
          <motion.div
            key="tour-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="fixed inset-0"
            style={{ zIndex: 10000, pointerEvents: 'auto' }}
            onClick={finish}
          >
            {/* SVG mask: full overlay with a rounded hole around target */}
            <svg
              width="100%" height="100%"
              style={{ display: 'block' }}
              aria-hidden
            >
              <defs>
                <mask id="tour-mask">
                  <rect width="100%" height="100%" fill="white" />
                  {rect && (
                    <rect
                      x={rect.left - 6}
                      y={rect.top - 6}
                      width={rect.width + 12}
                      height={rect.height + 12}
                      rx={10}
                      fill="black"
                    />
                  )}
                </mask>
              </defs>
              <rect
                width="100%" height="100%"
                fill="rgba(0,0,0,0.62)"
                mask="url(#tour-mask)"
              />
              {rect && (
                <rect
                  x={rect.left - 6}
                  y={rect.top - 6}
                  width={rect.width + 12}
                  height={rect.height + 12}
                  rx={10}
                  fill="none"
                  stroke="#E85D2A"
                  strokeWidth={2}
                />
              )}
            </svg>
          </motion.div>

          {/* Callout */}
          <motion.div
            key={`tour-callout-${step.id}`}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 6 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            style={calloutStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              style={{
                background: 'var(--bg-surface)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: 10,
                boxShadow: 'var(--shadow-card), 0 10px 40px rgba(0,0,0,0.35)',
                padding: '14px 14px 12px',
              }}
            >
              <div className="flex items-start justify-between gap-3 mb-1.5">
                <div
                  className="text-[10px] tracking-[0.2em] uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {isFirst || isLast ? 'The Card Wall' : `Step ${stepIdx} of ${STEPS.length - 2}`}
                </div>
                <button
                  type="button"
                  onClick={finish}
                  aria-label="Skip tour"
                  className="inline-flex items-center justify-center -mr-1 -mt-1"
                  style={{ width: 22, height: 22, color: 'var(--text-muted)', borderRadius: 4 }}
                >
                  <X size={14} strokeWidth={2.25} />
                </button>
              </div>

              <div
                className="mb-1"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 16,
                  fontWeight: 700,
                  letterSpacing: '-0.01em',
                  lineHeight: 1.2,
                }}
              >
                {step.title}
              </div>
              <p
                className="mb-3"
                style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--text-secondary)' }}
              >
                {step.body}
              </p>

              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={finish}
                  className="text-[11px] tracking-[0.12em] uppercase"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {isLast ? 'Close' : 'Skip'}
                </button>
                <div className="flex items-center gap-1.5">
                  {!isFirst && !isLast && (
                    <button
                      type="button"
                      onClick={prev}
                      className="px-3 py-1.5 text-xs font-medium"
                      style={{
                        background: 'transparent',
                        color: 'var(--text-primary)',
                        border: '1px solid var(--border-subtle)',
                        borderRadius: 6,
                      }}
                    >
                      Back
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={next}
                    className="px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background: '#E85D2A',
                      color: '#fff',
                      border: '1px solid #E85D2A',
                      borderRadius: 6,
                    }}
                  >
                    {isLast ? 'Done' : isFirst ? 'Start' : 'Next'}
                  </button>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
