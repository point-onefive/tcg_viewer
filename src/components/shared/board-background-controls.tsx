'use client'

import { useRef, useState } from 'react'
import { Ban, ClipboardPaste, ImagePlus, Loader2, Palette, Upload } from 'lucide-react'
import {
  backgroundIsActive,
  fileToBackgroundDataUrl,
  readClipboardImage,
  type BoardBackground,
  type BoardBackgroundType,
} from '@/lib/board-background'

/**
 * The painted background layer. Absolutely positioned so it fills its
 * (relatively-positioned) parent frame behind the content. Rendered
 * inside the exact node the PNG export snapshots, so it rides along
 * into downloads/clipboard copies.
 */
export function BoardBackgroundLayer({ bg }: { bg: BoardBackground }) {
  if (!backgroundIsActive(bg)) return null
  const base: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
    pointerEvents: 'none',
    opacity: bg.opacity,
  }
  const paint: React.CSSProperties =
    bg.type === 'color'
      ? { background: bg.color }
      : {
          backgroundImage: `url(${bg.image ?? ''})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        }
  return <div aria-hidden style={{ ...base, ...paint }} />
}

const MODES: { id: BoardBackgroundType; label: string; icon: typeof Ban }[] = [
  { id: 'none', label: 'None', icon: Ban },
  { id: 'color', label: 'Color', icon: Palette },
  { id: 'image', label: 'Image', icon: ImagePlus },
]

/**
 * The reusable background editor: a None / Color / Image segmented
 * control, plus the picker/upload/paste affordances and an opacity
 * slider. Presentation-agnostic - callers pass their page's `ctrlBase`
 * chrome tokens and brand `accent` so it blends into either maker tool.
 */
export function BackgroundControls({
  bg,
  onChange,
  ctrlBase,
  accent = '#E85D2A',
}: {
  bg: BoardBackground
  onChange: (next: BoardBackground) => void
  ctrlBase: React.CSSProperties
  accent?: string
}) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const patch = (p: Partial<BoardBackground>) => onChange({ ...bg, ...p })

  const setMode = (type: BoardBackgroundType) => {
    setNote(null)
    // Default a first-time color pick to a pleasant dark so the picker
    // doesn't open on pure black, and keep any previously chosen values.
    patch({ type })
  }

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return
    setBusy(true)
    setNote(null)
    const url = await fileToBackgroundDataUrl(file)
    setBusy(false)
    if (url) patch({ type: 'image', image: url })
    else setNote('That file could not be read as an image.')
  }

  const handlePaste = async () => {
    setBusy(true)
    setNote(null)
    const url = await readClipboardImage()
    setBusy(false)
    if (url) patch({ type: 'image', image: url })
    else setNote('No image on the clipboard (or the browser blocked it). Try Upload.')
  }

  const segBtn = (active: boolean): React.CSSProperties => ({
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    height: 28,
    padding: '0 12px',
    borderRadius: 6,
    border: 'none',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 700,
    background: active ? 'var(--text-primary)' : 'transparent',
    color: active ? 'var(--bg)' : 'var(--text-secondary)',
    transition: 'background 140ms ease, color 140ms ease',
  })

  const pill: React.CSSProperties = {
    ...ctrlBase,
    height: 30,
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '0 12px',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer',
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {/* Mode segmented control */}
        <div
          role="group"
          aria-label="Background type"
          className="inline-flex items-center"
          style={{ ...ctrlBase, height: 30, padding: 2, gap: 2 }}
        >
          {MODES.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setMode(id)}
              aria-pressed={bg.type === id}
              style={segBtn(bg.type === id)}
            >
              <Icon size={13} aria-hidden />
              {label}
            </button>
          ))}
        </div>

        {bg.type === 'color' && (
          <label className="inline-flex items-center gap-2" style={{ ...pill, cursor: 'default' }}>
            <input
              type="color"
              value={bg.color}
              onChange={(e) => patch({ color: e.target.value })}
              aria-label="Background color"
              style={{ width: 26, height: 20, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            />
            <span className="font-mono uppercase" style={{ color: 'var(--text-muted)' }}>
              {bg.color}
            </span>
          </label>
        )}

        {bg.type === 'image' && (
          <>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              style={{ ...pill, borderColor: `color-mix(in srgb, ${accent} 40%, var(--border-subtle))` }}
            >
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Upload size={13} aria-hidden />}
              Upload
            </button>
            <button type="button" onClick={handlePaste} disabled={busy} style={pill}>
              <ClipboardPaste size={13} aria-hidden />
              Paste
            </button>
            {bg.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={bg.image}
                alt=""
                aria-hidden
                style={{ width: 40, height: 26, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-subtle)' }}
              />
            )}
            {bg.image && (
              <button
                type="button"
                onClick={() => patch({ image: null })}
                style={{ ...pill, color: '#dc2626' }}
              >
                Remove
              </button>
            )}
          </>
        )}
      </div>

      {/* Opacity slider - only meaningful once a background is set. */}
      {bg.type !== 'none' && (
        <div className="flex items-center gap-2">
          <span
            className="shrink-0 text-[11px] font-bold uppercase tracking-wider"
            style={{ color: 'var(--text-muted)' }}
          >
            Opacity
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(bg.opacity * 100)}
            onChange={(e) => patch({ opacity: Number(e.target.value) / 100 })}
            className="zoom-slider w-full max-w-[220px]"
            aria-label="Background opacity"
          />
          <span
            className="shrink-0 font-mono text-xs tabular-nums"
            style={{ color: 'var(--text-secondary)', minWidth: 34, textAlign: 'right' }}
          >
            {Math.round(bg.opacity * 100)}%
          </span>
        </div>
      )}

      {note && (
        <p className="text-xs" style={{ color: accent }}>
          {note}
        </p>
      )}
    </div>
  )
}
