// Shared BONK container chrome for the tournaments page.
//
// Every styled container on /tournaments reuses these so the page reads as one
// cohesive co-branded surface instead of a spotty mix. The signature pieces:
//
//  - BonkModuleHeader: the dark "night" section band (white title + optional
//    icon/subtitle, warm orange glow, optional right slot) capped by a thin
//    sun-gradient hairline. Drop it in at the top of any card.
//  - BonkSceneBody: a content wrapper that lays a faded brand scene behind the
//    children with a theme-aware wash so copy stays legible in light + dark.
//
// All colors come from the BONK palette tokens defined under `.bonk-theme`
// (see globals.css), so these only render correctly inside the themed shell.

import type React from 'react'
import { X } from 'lucide-react'

type IconType = React.ComponentType<{ size?: number; style?: React.CSSProperties }>

/** Fixed height for every section band, so all module headers line up. */
const BONK_HEADER_HEIGHT = 60

/**
 * Dark BONK section band + sun hairline. The sponsor identity lives in the
 * module chrome, not as stickers in the body.
 *
 * Every header is a single fixed-height row so all modules line up. The title
 * sits left next to the icon; any context piece (a yellow `eyebrow` kicker or a
 * muted `subtitle`) is laid out to the SIDE of the title (never stacked above
 * it), and is hidden on mobile so the band stays one clean line. `right` is an
 * optional slot for a count badge, lockup, or static mascot.
 */
export function BonkModuleHeader({
  icon: Icon,
  title,
  subtitle,
  right,
  eyebrow,
}: {
  icon?: IconType
  title: React.ReactNode
  subtitle?: React.ReactNode
  right?: React.ReactNode
  /** Short yellow uppercase context label, shown beside the title. */
  eyebrow?: React.ReactNode
}) {
  return (
    <>
      <div
        className="bonk-section-band relative flex items-center justify-between gap-3 px-4 sm:px-5"
        style={{ minHeight: BONK_HEADER_HEIGHT }}
      >
        {/* Warm BONK glow so the dark band reads orange-cosmic, not muddy blue. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'radial-gradient(90% 220% at 100% 50%, color-mix(in srgb, var(--bonk-ui-orange) 30%, transparent) 0%, transparent 58%)',
          }}
        />
        <div className="relative flex min-w-0 items-center gap-2.5">
          {Icon && <Icon size={20} style={{ color: 'var(--bonk-band-icon)', flexShrink: 0 }} />}
          <h3
            className="bonk-display min-w-0 truncate"
            style={{ fontSize: 'clamp(17px, 3vw, 23px)', fontWeight: 900, color: 'var(--bonk-band-fg)', lineHeight: 1.1 }}
          >
            {title}
          </h3>
          {(eyebrow || subtitle) && (
            <span className="hidden min-w-0 items-center gap-2.5 sm:flex">
              <span aria-hidden style={{ width: 1, height: 16, background: 'var(--bonk-band-divider)', flexShrink: 0 }} />
              {/* Context label reads as the BONK kicker beside the title:
                  yellow on the night band, dark on the bright daytime band. */}
              <span
                className="bonk-mono truncate text-[11px] font-bold uppercase tracking-[0.14em]"
                style={{ color: 'var(--bonk-band-kicker)' }}
              >
                {eyebrow ?? subtitle}
              </span>
            </span>
          )}
        </div>
        {right && <div className="relative flex shrink-0 items-center gap-2.5" style={{ alignSelf: 'stretch' }}>{right}</div>}
      </div>
      {/* Sun-gradient hairline ties the dark header to the bright body. */}
      <div style={{ height: 2, background: 'var(--bonk-grad-sun)' }} />
    </>
  )
}

/**
 * Close button sized to sit in a `BonkModuleHeader` `right` slot. A translucent
 * dark disc with a white glyph reads cleanly on both the daytime orange band
 * and the dark night band, so themed modals get a native-feeling close affordance.
 */
export function BonkModalClose({ onClose }: { onClose: () => void }) {
  return (
    <button
      onClick={onClose}
      aria-label="Close"
      className="relative self-center"
      style={{
        background: 'rgba(0, 0, 0, 0.26)',
        border: '1px solid rgba(255, 255, 255, 0.28)',
        borderRadius: '50%',
        width: 30,
        height: 30,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: '#fff',
        flexShrink: 0,
      }}
    >
      <X size={16} />
    </button>
  )
}

/**
 * Static mascot for a module header's `right` slot. Sits fully inside the band
 * (bottom-aligned, no bleed above or below the header), with no animation -
 * motion is reserved for the hero + footer. Hidden on mobile to keep the band a
 * clean single line.
 */
export function BonkHeaderMascot({ src, height = BONK_HEADER_HEIGHT - 8 }: { src: string; height?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      aria-hidden
      className="hidden shrink-0 select-none sm:block"
      style={{
        height,
        width: 'auto',
        alignSelf: 'flex-end',
        filter: 'drop-shadow(0 6px 10px rgba(23,0,28,0.35))',
      }}
    />
  )
}

/**
 * Body wrapper that fades a brand scene behind its children. A theme-aware wash
 * keeps the content readable: lighter in light mode, darker in dark mode (the
 * scene reads as a faint texture, never a busy photo).
 */
export function BonkSceneBody({
  scene,
  sceneLight,
  position = 'center',
  className,
  style,
  children,
}: {
  /** Dark-theme scene path under /bonk/scenes (cosmic / night imagery). */
  scene: string
  /** Light-theme scene (warmer daytime imagery). Defaults to `scene`. */
  sceneLight?: string
  /** background-position for the scene image. */
  position?: string
  className?: string
  style?: React.CSSProperties
  children: React.ReactNode
}) {
  const light = sceneLight ?? scene
  return (
    <div className={`relative ${className ?? ''}`} style={style}>
      <div
        aria-hidden
        className="bonk-scene-layer bonk-scene-layer--dark pointer-events-none absolute inset-0"
        style={{ backgroundImage: `url(${scene})`, backgroundSize: 'cover', backgroundPosition: position }}
      />
      <div
        aria-hidden
        className="bonk-scene-layer bonk-scene-layer--light pointer-events-none absolute inset-0"
        style={{ backgroundImage: `url(${light})`, backgroundSize: 'cover', backgroundPosition: position }}
      />
      <div className="relative">{children}</div>
    </div>
  )
}
