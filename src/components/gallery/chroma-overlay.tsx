'use client'

import { useRef, useEffect } from 'react'
import gsap from 'gsap'

interface ChromaOverlayProps {
  radius?: number
  damping?: number
}

type QuickSetter = (value: number) => void

export function ChromaOverlay({ radius = 320, damping = 0.4 }: ChromaOverlayProps) {
  const rootRef = useRef<HTMLDivElement>(null)
  const spotRef = useRef<HTMLDivElement>(null)
  const pos = useRef({ x: -9999, y: -9999 })
  const setX = useRef<QuickSetter | null>(null)
  const setY = useRef<QuickSetter | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasEntered = useRef(false)

  useEffect(() => {
    const root = rootRef.current
    const spot = spotRef.current
    if (!root || !spot) return

    setX.current = gsap.quickSetter(root, '--x', 'px') as QuickSetter
    setY.current = gsap.quickSetter(root, '--y', 'px') as QuickSetter

    const goIdle = () => {
      spot.classList.add('is-idle')
    }

    const handleMove = (e: PointerEvent) => {
      if (!hasEntered.current) {
        // Snap instantly on first entry, no tween
        pos.current.x = e.clientX
        pos.current.y = e.clientY
        setX.current!(e.clientX)
        setY.current!(e.clientY)
        hasEntered.current = true
      } else {
        gsap.to(pos.current, {
          x: e.clientX,
          y: e.clientY,
          duration: damping,
          ease: 'power3.out',
          onUpdate: () => {
            setX.current!(pos.current.x)
            setY.current!(pos.current.y)
          },
          overwrite: true,
        })
      }

      spot.classList.remove('is-idle')
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(goIdle, 3000)
    }

    const handleLeave = () => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      goIdle()
    }

    // Start idle
    goIdle()

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerleave', handleLeave)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerleave', handleLeave)
      if (idleTimer.current) clearTimeout(idleTimer.current)
    }
  }, [damping])

  return (
    <div
      ref={rootRef}
      className="chroma-root"
      style={{ '--r': `${radius}px` } as React.CSSProperties}
    >
      <div ref={spotRef} className="chroma-spotlight" />
    </div>
  )
}
