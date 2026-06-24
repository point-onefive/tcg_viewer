'use client'

import Link from 'next/link'
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import {
  Check,
  ClipboardPaste,
  Download,
  FileUp,
  Gauge,
  Image as ImageIcon,
  LineChart,
  Pause,
  Play,
  Plus,
  SkipBack,
  Sparkles,
  Table,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { BrandLockup } from '@/components/gallery/brand-lockup'
import { SiteNavMenu } from '@/components/gallery/site-nav-menu'
import { useChartRace } from '@/lib/chart-race-store'
import {
  normalizeRows,
  parseCsv,
  pickColor,
  type ChartRaceSettings,
  type ChartRow,
  type ChartSeries,
} from '@/lib/chart-race-types'
import {
  buildExportFilename,
  captureChartPng,
  copyBlobToClipboard,
  downloadBlob,
} from '@/lib/chart-export'

/* ──────────────────────────────────────────────────────────────
   Shared control surface tokens, copied verbatim from the
   tier-list maker so the two tools are visually indistinguishable.
   `ctrlBase` is the pill/button/input chrome; `BRAND` is the site
   orange used for accents, section icons, and the default line.
   ────────────────────────────────────────────────────────────── */
const BRAND = '#E85D2A'

const ctrlBase: React.CSSProperties = {
  background: 'var(--bg-surface)',
  color: 'var(--text-primary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: 6,
}

const uploadChip: React.CSSProperties = {
  ...ctrlBase,
  borderColor: 'color-mix(in srgb, #E85D2A 40%, var(--border-subtle))',
  boxShadow: '0 0 0 1px color-mix(in srgb, #E85D2A 18%, transparent) inset',
  fontWeight: 600,
  fontSize: 12,
  cursor: 'pointer',
  alignItems: 'center',
  gap: 6,
  padding: '6px 12px',
  height: 30,
  display: 'inline-flex',
}

/* ── Head-of-line avatar helper ──────────────────────────────────
   Turns a pasted/uploaded image file into a small, square, centre-
   cropped data URL. Square keeps the circular badge clip clean; the
   96px cap keeps the persisted store tiny (a few KB per line) while
   staying crisp at the ~32px the badge renders at on a retina canvas.
   Returns null for non-images or decode failures so callers can
   no-op rather than crash. ──────────────────────────────────────── */
async function fileToHeadImage(file: File, size = 96): Promise<string | null> {
  if (!file.type.startsWith('image/')) return null
  try {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new window.Image()
      im.onload = () => resolve(im)
      im.onerror = reject
      im.src = dataUrl
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    // Cover-fit: crop the longer axis so a portrait/landscape source
    // fills the square badge without distortion.
    const side = Math.min(w, h)
    const sx = (w - side) / 2
    const sy = (h - side) / 2
    ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size)
    return canvas.toDataURL('image/webp', 0.85)
  } catch {
    return null
  }
}

/* ── Section header (orange icon + tracked wordmark + tapering
      gradient rule), copied from the tier-list maker. ───────────── */
function SectionLabel({
  icon: Icon,
  label,
  right,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; style?: React.CSSProperties; 'aria-hidden'?: boolean }>
  label: string
  right?: React.ReactNode
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <div className="flex items-center gap-2">
        <Icon size={14} strokeWidth={2.25} style={{ color: BRAND }} aria-hidden />
        <h2
          className="font-display"
          style={{
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--text-primary)',
          }}
        >
          {label}
        </h2>
      </div>
      <div
        aria-hidden
        className="hidden flex-1 sm:block"
        style={{
          height: 1,
          minWidth: 24,
          background: 'linear-gradient(90deg, color-mix(in srgb, #E85D2A 45%, transparent), transparent)',
        }}
      />
      {right && (
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
          {right}
        </div>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   Geometry helpers. All pure, all in viewBox units so the chart
   scales identically on screen and in the PNG export.
   ────────────────────────────────────────────────────────────── */

interface Pt {
  x: number
  y: number
  v: number
}

/** Straight polyline. */
function polylinePath(pts: Pt[]): string {
  if (pts.length === 0) return ''
  let d = `M ${pts[0].x} ${pts[0].y}`
  for (let i = 1; i < pts.length; i++) d += ` L ${pts[i].x} ${pts[i].y}`
  return d
}

/**
 * Monotone cubic interpolation (Fritsch-Carlson), the same curve
 * d3 calls `curveMonotoneX`. Chosen over Catmull-Rom because it
 * never overshoots the data - critical for finance-style charts
 * where a phantom dip below the real low would misread the trend.
 */
function monotonePath(pts: Pt[]): string {
  const n = pts.length
  if (n < 3) return polylinePath(pts)
  const xs = pts.map((p) => p.x)
  const ys = pts.map((p) => p.y)
  const dx: number[] = []
  const slope: number[] = []
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i]
    slope[i] = dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i]
  }
  const t: number[] = new Array(n)
  t[0] = slope[0]
  t[n - 1] = slope[n - 2]
  for (let i = 1; i < n - 1; i++) {
    if (slope[i - 1] * slope[i] <= 0) t[i] = 0
    else t[i] = (slope[i - 1] + slope[i]) / 2
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0
      t[i + 1] = 0
    } else {
      const a = t[i] / slope[i]
      const b = t[i + 1] / slope[i]
      const s = a * a + b * b
      if (s > 9) {
        const tau = 3 / Math.sqrt(s)
        t[i] = tau * a * slope[i]
        t[i + 1] = tau * b * slope[i]
      }
    }
  }
  let d = `M ${xs[0]} ${ys[0]}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i]
    const c1x = xs[i] + h / 3
    const c1y = ys[i] + (t[i] * h) / 3
    const c2x = xs[i + 1] - h / 3
    const c2y = ys[i + 1] - (t[i + 1] * h) / 3
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${xs[i + 1]} ${ys[i + 1]}`
  }
  return d
}

function linePath(pts: Pt[], smooth: boolean): string {
  return smooth ? monotonePath(pts) : polylinePath(pts)
}

/** Human-friendly value: thousands separators, ~3 significant digits. */
function formatValue(v: number, prefix: string, suffix: string, signed = false): string {
  // Collapse tiny magnitudes (and -0) to a clean 0 so axis ticks
  // don't render as "-0%".
  if (Math.abs(v) < 0.0005) v = 0
  const abs = Math.abs(v)
  const digits = abs >= 1000 ? 0 : abs >= 100 ? 0 : abs >= 1 ? 1 : 2
  const s = v.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits,
  })
  // In % mode, prepend a + on gains so growth reads at a glance
  // (losses already carry a - from toLocaleString).
  const sign = signed && v > 0 ? '+' : ''
  return `${prefix}${sign}${s}${suffix}`
}

/** Round a domain bound to a "nice" gridline value. */
function niceNum(range: number, round: boolean): number {
  if (range === 0) return 1
  const exp = Math.floor(Math.log10(range))
  const frac = range / Math.pow(10, exp)
  let nice: number
  if (round) {
    if (frac < 1.5) nice = 1
    else if (frac < 3) nice = 2
    else if (frac < 7) nice = 5
    else nice = 10
  } else {
    if (frac <= 1) nice = 1
    else if (frac <= 2) nice = 2
    else if (frac <= 5) nice = 5
    else nice = 10
  }
  return nice * Math.pow(10, exp)
}

/* ──────────────────────────────────────────────────────────────
   The chart figure. This is the node captured for PNG export, so
   everything that should appear in a downloaded image (title,
   subtitle, chart, watermark) lives inside `frameRef`.
   ────────────────────────────────────────────────────────────── */

const VB_W = 1000
const VB_H = 400
const PAD_L = 58
const PAD_R = 132
const PAD_T = 22
const PAD_B = 42

interface FigureProps {
  title: string
  subtitle: string
  xAxisLabel: string
  valuePrefix: string
  valueSuffix: string
  series: ChartSeries[]
  rows: ChartRow[]
  settings: ChartRaceSettings
  progress: number
  frameRef: React.RefObject<HTMLDivElement | null>
}

function ChartFigure({
  title,
  subtitle,
  xAxisLabel,
  valuePrefix,
  valueSuffix,
  series,
  rows,
  settings,
  progress,
  frameRef,
}: FigureProps) {
  const n = rows.length
  const maxIndex = Math.max(0, n - 1)
  // In "% growth" mode the lines are already rebased to start at 0,
  // so the axis + tip labels drop any currency prefix and read as
  // signed percentages instead.
  const fmtPrefix = settings.normalize ? '' : valuePrefix
  const fmtSuffix = settings.normalize ? '%' : valueSuffix
  const fmtSigned = settings.normalize
  const clamped = Math.max(0, Math.min(progress, maxIndex))
  const k = Math.floor(clamped)
  const frac = clamped - k

  const xAt = useCallback(
    (i: number) => {
      if (maxIndex === 0) return PAD_L
      return PAD_L + (i / maxIndex) * (VB_W - PAD_L - PAD_R)
    },
    [maxIndex],
  )

  // Y domain. When `dynamicAxis` is on, the axis grows with the
  // climb - but instead of snapping at each integer step (which
  // reads as a stutter) we feed the *interpolated* current values
  // into the range so the domain expands continuously, frame by
  // frame. The scale is raw + padded (not nice-number snapped) so
  // it moves smoothly; only the gridline tick values are snapped
  // to nice numbers, and they slide along with the scale. When the
  // option is off we lock to the full dataset so nothing shifts.
  const { domMin, domMax, ticks } = useMemo(() => {
    const considered: number[] = []
    const upTo = settings.dynamicAxis ? k : maxIndex
    for (let i = 0; i <= upTo; i++) {
      for (let s = 0; s < series.length; s++) {
        const v = rows[i]?.values[s]
        if (v != null) considered.push(v)
      }
    }
    // Blend in the interpolated tip values so the domain tracks the
    // moving leading edge between steps rather than jumping when k
    // ticks over.
    if (settings.dynamicAxis && frac > 0 && k + 1 <= maxIndex) {
      for (let s = 0; s < series.length; s++) {
        const a = rows[k]?.values[s]
        const b = rows[k + 1]?.values[s]
        if (a != null && b != null) considered.push(a + (b - a) * frac)
      }
    }
    if (considered.length === 0) {
      return { domMin: 0, domMax: 1, ticks: [0, 1] }
    }
    let lo = Math.min(...considered)
    let hi = Math.max(...considered)
    if (lo === hi) {
      lo -= 1
      hi += 1
    }
    const pad = (hi - lo) * 0.08
    const dMin = lo - pad
    const dMax = hi + pad
    const step = niceNum((dMax - dMin) / 4, true)
    const t: number[] = []
    const start = Math.ceil(dMin / step) * step
    for (let v = start; v <= dMax + step * 0.001; v += step) t.push(v)
    return { domMin: dMin, domMax: dMax, ticks: t }
  }, [rows, series, settings.dynamicAxis, k, frac, maxIndex])

  const yAt = useCallback(
    (v: number) => {
      const span = domMax - domMin || 1
      return PAD_T + (1 - (v - domMin) / span) * (VB_H - PAD_T - PAD_B)
    },
    [domMin, domMax],
  )

  // Per-series visible geometry + current tip.
  const geo = useMemo(() => {
    return series.map((s, si) => {
      const pts: Pt[] = []
      let lastX = -Infinity
      for (let i = 0; i <= k; i++) {
        const v = rows[i]?.values[si]
        if (v == null) continue
        const x = xAt(i)
        if (x - lastX < 0.01) continue
        lastX = x
        pts.push({ x, y: yAt(v), v })
      }
      const vk = rows[k]?.values[si]
      const vk1 = rows[k + 1]?.values[si]
      let tip: Pt | null = null
      if (frac > 0 && k + 1 <= maxIndex && vk != null && vk1 != null) {
        const ix = xAt(k) + (xAt(k + 1) - xAt(k)) * frac
        const iv = vk + (vk1 - vk) * frac
        tip = { x: ix, y: yAt(iv), v: iv }
        if (ix - lastX > 0.01) pts.push(tip)
      } else if (pts.length > 0) {
        tip = pts[pts.length - 1]
      }
      return { series: s, pts, tip }
    })
  }, [series, rows, k, frac, maxIndex, xAt, yAt])

  // Baseline Y for area fills (clamped to plot floor).
  const baseY = yAt(domMin)

  // X-axis tick labels: subsample to at most ~7 so they never
  // crowd on a phone-width export.
  const xTicks = useMemo(() => {
    if (n === 0) return [] as number[]
    const maxTicks = 7
    if (n <= maxTicks) return rows.map((_, i) => i)
    const stepEvery = Math.ceil((n - 1) / (maxTicks - 1))
    const out: number[] = []
    for (let i = 0; i < n; i += stepEvery) out.push(i)
    if (out[out.length - 1] !== n - 1) out.push(n - 1)
    return out
  }, [n, rows])

  const currentLabel = rows[Math.round(clamped)]?.label ?? ''

  const hasData = series.length > 0 && n > 0

  return (
    <div
      ref={frameRef}
      className="overflow-hidden"
      style={{
        ...ctrlBase,
        borderRadius: 10,
        boxShadow: 'var(--shadow-card)',
        padding: 18,
        background: 'var(--bg-surface)',
      }}
    >
      {/* Title block, baked into the export. */}
      {(title || subtitle) && (
        <div className="mb-1 text-center">
          {title && (
            <h3
              className="font-display"
              style={{
                fontSize: 'clamp(18px, 3.4vw, 26px)',
                fontWeight: 800,
                letterSpacing: '-0.01em',
                color: 'var(--text-primary)',
              }}
            >
              {title}
            </h3>
          )}
          {subtitle && (
            <p
              className="mt-0.5"
              style={{ fontSize: 'clamp(11px, 2vw, 13px)', color: 'var(--text-secondary)' }}
            >
              {subtitle}
            </p>
          )}
        </div>
      )}

      {/* Legend. */}
      {hasData && (
        <div className="mb-1 mt-2 flex flex-wrap items-center justify-center gap-x-4 gap-y-1">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-1.5" style={{ fontSize: 12 }}>
              <span
                aria-hidden
                style={{ width: 12, height: 12, borderRadius: 3, background: s.color, display: 'inline-block' }}
              />
              <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>{s.name}</span>
            </span>
          ))}
        </div>
      )}

      {hasData ? (
        <svg
          viewBox={`0 0 ${VB_W} ${VB_H}`}
          width="100%"
          style={{ display: 'block', height: 'auto', fontFamily: 'var(--font-body), system-ui, sans-serif' }}
          role="img"
          aria-label={title || 'Chart race'}
        >
          {/* Faint centered brand watermark, stamped behind the
              gridlines + lines so it reads as a subtle background
              mark (and rides along into the exported PNG). */}
          <g
            aria-hidden
            opacity={0.05}
            transform={`translate(${(PAD_L + VB_W - PAD_R) / 2}, ${(PAD_T + VB_H - PAD_B) / 2})`}
            style={{ pointerEvents: 'none' }}
          >
            <image
              href="/images/site-logo.png"
              x={-266}
              y={-44}
              width={84}
              height={84}
              style={{ imageRendering: 'pixelated' }}
              preserveAspectRatio="xMidYMid meet"
            />
            <text
              x={-170}
              y={0}
              dominantBaseline="central"
              textAnchor="start"
              style={{
                fontFamily: 'var(--font-display), system-ui, sans-serif',
                fontWeight: 800,
                fontSize: 72,
                letterSpacing: '-0.02em',
                textTransform: 'uppercase',
                fill: 'var(--text-primary)',
              }}
            >
              <tspan
                style={{
                  fontSize: 30,
                  fontWeight: 500,
                  fontStyle: 'italic',
                  textTransform: 'lowercase',
                }}
              >
                the
              </tspan>
              <tspan dx={14}>Card Wall</tspan>
            </text>
          </g>

          {/* Horizontal gridlines + y tick labels. */}
          {ticks.map((tv) => {
            const y = yAt(tv)
            if (y < PAD_T - 1 || y > VB_H - PAD_B + 1) return null
            return (
              <g key={`grid-${tv}`}>
                <line
                  x1={PAD_L}
                  x2={VB_W - PAD_R}
                  y1={y}
                  y2={y}
                  stroke="var(--text-muted)"
                  strokeOpacity={0.18}
                  strokeWidth={1}
                />
                <text
                  x={PAD_L - 8}
                  y={y}
                  textAnchor="end"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill="var(--text-muted)"
                >
                  {formatValue(tv, fmtPrefix, fmtSuffix, fmtSigned)}
                </text>
              </g>
            )
          })}

          {/* X axis baseline + tick labels. */}
          <line
            x1={PAD_L}
            x2={VB_W - PAD_R}
            y1={VB_H - PAD_B}
            y2={VB_H - PAD_B}
            stroke="var(--text-muted)"
            strokeOpacity={0.35}
            strokeWidth={1}
          />
          {xTicks.map((i) => (
            <text
              key={`xt-${i}`}
              x={xAt(i)}
              y={VB_H - PAD_B + 18}
              textAnchor="middle"
              fontSize={12}
              fill="var(--text-muted)"
            >
              {rows[i]?.label ?? ''}
            </text>
          ))}

          {/* Big current-step label, the iconic chart-race date stamp. */}
          {currentLabel && (
            <text
              x={VB_W - PAD_R - 6}
              y={PAD_T + 30}
              textAnchor="end"
              fontFamily="var(--font-display), system-ui, sans-serif"
              fontSize={40}
              fontWeight={800}
              fill="var(--text-primary)"
              opacity={0.1}
            >
              {currentLabel}
            </text>
          )}

          {/* Area fills (under each line), drawn first so lines sit on top. */}
          {settings.area &&
            geo.map(({ series: s, pts }) =>
              pts.length >= 2 ? (
                <path
                  key={`area-${s.id}`}
                  d={`${linePath(pts, settings.smooth)} L ${pts[pts.length - 1].x} ${baseY} L ${pts[0].x} ${baseY} Z`}
                  fill={s.color}
                  fillOpacity={0.1}
                  stroke="none"
                />
              ) : null,
            )}

          {/* The lines. */}
          {geo.map(({ series: s, pts }) =>
            pts.length >= 1 ? (
              <path
                key={`line-${s.id}`}
                d={linePath(pts, settings.smooth)}
                fill="none"
                stroke={s.color}
                strokeWidth={3}
                strokeLinejoin="round"
                strokeLinecap="round"
              />
            ) : null,
          )}

          {/* Tips: dot + value/name label riding the leading edge.
              Label Y positions are de-overlapped so two lines that
              finish close together (e.g. S&P 500 + Bitcoin both near
              the baseline) don't print on top of each other. */}
          {(() => {
            const HEAD_R = 16
            // Leader-line de-overlap, ramped by playback progress.
            //
            // Early in the run every line is bunched near the start
            // value, so forcing badges apart builds an ugly vertical
            // tower of leaders. Instead we let them OVERLAP on their
            // true points at the start, then smoothly ease into full
            // leader-line separation across the middle of the timeline.
            // `strength` 0 = pure overlap, 1 = full de-overlap; the
            // smoothstep avoids any hard "pop" at the switchover.
            const playFrac = maxIndex > 0 ? clamped / maxIndex : 1
            const RAMP_START = 0.35
            const RAMP_END = 0.65
            const t = Math.max(0, Math.min(1, (playFrac - RAMP_START) / (RAMP_END - RAMP_START)))
            const strength = t * t * (3 - 2 * t) // smoothstep
            const hasImages = geo.some(({ series: s, tip }) => tip && s.image)
            const FULL_GAP = hasImages ? 2 * HEAD_R + 3 : 15
            const MIN_GAP = FULL_GAP * strength
            const pad = hasImages ? HEAD_R + 2 : 6
            const lo = PAD_T + pad
            const hi = VB_H - PAD_B - pad
            const items = geo
              .map(({ series: s, tip }) =>
                tip ? { s, tip, trueY: tip.y, y: Math.max(lo, Math.min(tip.y, hi)) } : null,
              )
              .filter(
                (x): x is { s: ChartSeries; tip: Pt; trueY: number; y: number } => x != null,
              )
              .sort((a, b) => a.y - b.y)
            // First pass: push each crowded badge below its neighbour.
            // With MIN_GAP near 0 (early run) this is a no-op and badges
            // stay on their true points, overlapping freely.
            for (let i = 1; i < items.length; i++) {
              if (items[i].y - items[i - 1].y < MIN_GAP) {
                items[i].y = items[i - 1].y + MIN_GAP
              }
            }
            // If the stack overflowed the bottom, slide it all up, then
            // clamp the top back inside the plot box.
            const overflow = items.length ? items[items.length - 1].y - hi : 0
            if (overflow > 0) for (const it of items) it.y -= overflow
            for (const it of items) it.y = Math.max(lo, it.y)
            return items.map(({ s, tip, trueY, y }) => {
              const labelX = tip.x + (s.image ? 2 * HEAD_R + 12 : 10)
              // A badge counts as "moved" once it's a few px off its
              // true point; only then do we draw the connector stub.
              const moved = s.image && Math.abs(y - trueY) > 2
              return (
                <g key={`tip-${s.id}`}>
                  {s.image ? (
                    <>
                      {/* Leader: true point on the line -> badge centre.
                          Drawn first so the badge sits on top of it. */}
                      {moved && (
                        <line
                          x1={tip.x}
                          y1={trueY}
                          x2={tip.x + HEAD_R}
                          y2={y}
                          stroke={s.color}
                          strokeWidth={1.5}
                          strokeLinecap="round"
                          opacity={0.55}
                        />
                      )}
                      {/* Small dot pinning the series' real value. */}
                      <circle cx={tip.x} cy={trueY} r={3} fill={s.color} />
                      <clipPath id={`headclip-${s.id}`}>
                        <circle cx={tip.x + HEAD_R} cy={y} r={HEAD_R} />
                      </clipPath>
                      <image
                        href={s.image}
                        x={tip.x}
                        y={y - HEAD_R}
                        width={HEAD_R * 2}
                        height={HEAD_R * 2}
                        preserveAspectRatio="xMidYMid slice"
                        clipPath={`url(#headclip-${s.id})`}
                      />
                      {/* Background-coloured outer ring first so stacked
                          badges visually cut out from each other, then
                          the series-coloured ring on top. */}
                      <circle cx={tip.x + HEAD_R} cy={y} r={HEAD_R + 1} fill="none" stroke="var(--bg-surface)" strokeWidth={2} />
                      <circle cx={tip.x + HEAD_R} cy={y} r={HEAD_R} fill="none" stroke={s.color} strokeWidth={1.5} />
                    </>
                  ) : (
                    <circle cx={tip.x} cy={trueY} r={4.5} fill={s.color} stroke="var(--bg-surface)" strokeWidth={2} />
                  )}
                  {settings.showValues && (
                    <text
                      x={labelX}
                      y={y}
                      dominantBaseline="middle"
                      fontSize={13}
                      fontWeight={700}
                      fill={s.color}
                    >
                      {formatValue(tip.v, fmtPrefix, fmtSuffix, fmtSigned)}
                    </text>
                  )}
                </g>
              )
            })
          })()}
        </svg>
      ) : (
        <div
          className="flex flex-col items-center justify-center gap-2 text-center"
          style={{ aspectRatio: '16 / 9', color: 'var(--text-muted)' }}
        >
          <LineChart size={32} strokeWidth={1.5} aria-hidden />
          <p style={{ fontSize: 13 }}>Add some data below to see your chart.</p>
        </div>
      )}

      {/* X-axis caption. */}
      {hasData && xAxisLabel && (
        <p
          className="mt-1 text-center"
          style={{ fontSize: 11, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)', fontWeight: 700 }}
        >
          {xAxisLabel}
        </p>
      )}
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   Main page component.
   ────────────────────────────────────────────────────────────── */

export function ChartRaceMaker() {
  const formId = useId()
  const {
    title,
    subtitle,
    xAxisLabel,
    valuePrefix,
    valueSuffix,
    series,
    rows,
    settings,
    updateSettings,
    loadSample,
    clearAll,
  } = useChartRace()

  const maxIndex = Math.max(0, rows.length - 1)
  const canPlay = maxIndex > 0 && series.length > 0

  const [progress, setProgress] = useState(0)
  const [playing, setPlaying] = useState(false)
  const progressRef = useRef(0)
  const rafRef = useRef<number | null>(null)
  const lastTsRef = useRef<number | null>(null)

  const frameRef = useRef<HTMLDivElement>(null)

  // Keep the ref in lockstep so the rAF loop reads fresh progress
  // without re-subscribing on every frame.
  useEffect(() => {
    progressRef.current = progress
  }, [progress])

  // Clamp the playhead back into range if the data shrank (rows
  // removed, CSV re-imported) so we never scrub past the end.
  useEffect(() => {
    if (progress > maxIndex) {
      setProgress(maxIndex)
      progressRef.current = maxIndex
    }
  }, [maxIndex, progress])

  const durationSec = settings.durationSec

  // The animation loop. Deliberately does NOT reset progress on
  // start - that lived here before and double-fired under React's
  // dev StrictMode (mount/unmount/remount), which is what made the
  // playhead visibly jump back to zero twice at the very start of a
  // run. Restart-from-end is now handled in `handlePlayPause` so
  // this effect only ever drives the clock forward.
  useEffect(() => {
    if (!playing || !canPlay) return
    lastTsRef.current = null
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts
      const dt = ts - lastTsRef.current
      lastTsRef.current = ts
      const perMs = maxIndex / (durationSec * 1000)
      let next = progressRef.current + dt * perMs
      if (next >= maxIndex) {
        next = maxIndex
        progressRef.current = next
        setProgress(next)
        setPlaying(false)
        return
      }
      progressRef.current = next
      setProgress(next)
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [playing, canPlay, durationSec, maxIndex])

  const handlePlayPause = useCallback(() => {
    if (!canPlay) return
    setPlaying((p) => {
      // Pressing play while parked at the end replays from the top.
      if (!p && progressRef.current >= maxIndex) {
        progressRef.current = 0
        setProgress(0)
      }
      return !p
    })
  }, [canPlay, maxIndex])

  const handleRestart = useCallback(() => {
    setPlaying(false)
    progressRef.current = 0
    setProgress(0)
    // Defer the replay one tick so the pause flushes first.
    requestAnimationFrame(() => setPlaying(true))
  }, [])

  const handleScrub = useCallback((v: number) => {
    setPlaying(false)
    progressRef.current = v
    setProgress(v)
  }, [])

  // Stable callback handed to the import panel so loading data
  // snaps the playhead back to the start without re-rendering the
  // panel on every animation frame.
  const resetPlayhead = useCallback(() => {
    setPlaying(false)
    progressRef.current = 0
    setProgress(0)
  }, [])

  // Normalize for display only; the stored grid keeps raw numbers
  // so toggling the option back off is lossless.
  const displayRows = useMemo(
    () => (settings.normalize ? normalizeRows(rows, series.length) : rows),
    [settings.normalize, rows, series.length],
  )

  /* ── CSV import panel open/close. Opens itself when the board is
        empty so a first-time visitor lands on the upload box. ──── */
  const [importOpen, setImportOpen] = useState(series.length === 0)
  const closeImport = useCallback(() => setImportOpen(false), [])

  /* ── PNG export ─────────────────────────────────────────────── */
  const [exporting, setExporting] = useState(false)

  const handleExportPng = useCallback(async () => {
    if (!frameRef.current) return
    setExporting(true)
    try {
      const blob = await captureChartPng(frameRef.current)
      downloadBlob(blob, buildExportFilename(title || 'chart-race', 'png'))
    } catch {
      // Swallow: a failed capture shouldn't crash the page. The
      // button simply re-enables so the user can retry.
    } finally {
      setExporting(false)
    }
  }, [title])

  return (
    <div
      className="relative min-h-screen pb-28"
      style={{
        background: 'var(--bg)',
        color: 'var(--text-primary)',
        fontFamily: 'var(--font-body), ui-sans-serif, system-ui, sans-serif',
      }}
    >
      {/* ── Uniform site top bar (brand · theme · hamburger). ──── */}
      <header
        className="sticky top-0 z-30"
        style={{
          background: 'color-mix(in srgb, var(--bg) 78%, transparent)',
          backdropFilter: 'blur(18px) saturate(140%)',
          WebkitBackdropFilter: 'blur(18px) saturate(140%)',
          borderBottom: '1px solid var(--border-subtle)',
        }}
      >
        <div className="mx-auto flex items-center justify-between gap-3 px-4" style={{ maxWidth: 1800, height: 56 }}>
          <BrandLockup />
          <SiteNavMenu topOffset={56} />
        </div>
      </header>

      {/* Centered page title, directly under the nav. */}
      <div className="mx-auto flex items-center justify-center gap-2 px-4 pt-5" style={{ maxWidth: 1800 }}>
        <LineChart size={20} strokeWidth={2.25} style={{ color: BRAND, flexShrink: 0 }} aria-hidden />
        <h1 className="font-display text-lg font-bold tracking-tight sm:text-xl">Chart Race</h1>
      </div>

      {/* ── Snarky lede, mirroring the tier-list page voice. ───── */}
      <section aria-label="About this page" className="mx-auto max-w-3xl px-4 pt-3 pb-2 text-center">
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(10px, 3vw, 26px)',
            fontStyle: 'italic',
            fontWeight: 700,
            lineHeight: 1.3,
            letterSpacing: '-0.01em',
            color: 'var(--text-secondary)',
            whiteSpace: 'nowrap',
          }}
        >
          <span style={{ color: BRAND, fontWeight: 800, marginRight: 3 }}>“</span>
          Drop in some numbers, watch the lines race
          <span style={{ color: BRAND, fontWeight: 800, marginLeft: 3 }}>”</span>
        </p>
        <p
          className="mt-3 flex flex-nowrap items-center justify-center"
          style={{
            fontSize: 'clamp(8.5px, 2.4vw, 11px)',
            letterSpacing: 'clamp(0.06em, 0.5vw, 0.18em)',
            textTransform: 'uppercase',
            fontWeight: 700,
            color: 'var(--text-muted)',
            whiteSpace: 'nowrap',
            gap: 'clamp(4px, 1.4vw, 12px)',
          }}
        >
          <span>Always free</span>
          <span aria-hidden style={{ opacity: 0.5 }}>·</span>
          <span>No signup</span>
          <span aria-hidden style={{ opacity: 0.5 }}>·</span>
          <span>Runs in your browser</span>
        </p>
      </section>

      {/* Page-specific actions, below the lede - two equal-width buttons,
          centered and capped so they don't sprawl on desktop. */}
      <div className="mx-auto flex items-center justify-center gap-2 px-4 pt-4" style={{ maxWidth: 460 }}>
        <button
          type="button"
          onClick={handleExportPng}
          disabled={!canPlay || exporting}
          className="footer-btn inline-flex flex-1 items-center justify-center gap-1.5 px-3 text-xs font-medium"
          style={{ ...ctrlBase, height: 34, opacity: !canPlay || exporting ? 0.5 : 1 }}
        >
          <Download size={14} aria-hidden />
          {exporting ? 'Saving…' : 'PNG'}
        </button>
        <button
          type="button"
          onClick={() => setImportOpen((v) => !v)}
          className="footer-btn flex-1 justify-center"
          style={{ ...uploadChip, height: 34, justifyContent: 'center' }}
        >
          <FileUp size={14} aria-hidden />
          Import data
        </button>
      </div>

      <div className="mx-auto px-4 pt-6" style={{ maxWidth: 1800 }}>
        {/* ── Import panel (collapsible) ───────────────────────── */}
        {importOpen && (
          <ImportPanel formId={formId} onClose={closeImport} onAfterLoad={resetPlayhead} />
        )}

        {/* ── Chart + playback ─────────────────────────────────── */}
        <section aria-label="Chart" className="mb-6">
          <SectionLabel
            icon={LineChart}
            label="Chart"
            right={
              <div
                role="group"
                aria-label="Value mode"
                className="inline-flex items-center"
                style={{ ...ctrlBase, height: 30, padding: 2, gap: 2 }}
              >
                {([
                  { mode: false, label: '$', title: 'Show actual values' },
                  { mode: true, label: '%', title: 'Show % growth from start' },
                ] as const).map(({ mode, label, title: t }) => {
                  const active = settings.normalize === mode
                  return (
                    <button
                      key={label}
                      type="button"
                      onClick={() => updateSettings({ normalize: mode })}
                      title={t}
                      aria-pressed={active}
                      className="inline-flex items-center justify-center text-sm font-bold"
                      style={{
                        height: 26,
                        minWidth: 34,
                        borderRadius: 6,
                        border: 'none',
                        cursor: 'pointer',
                        background: active ? 'var(--text-primary)' : 'transparent',
                        color: active ? 'var(--bg)' : 'var(--text-secondary)',
                        transition: 'background 140ms ease, color 140ms ease',
                      }}
                    >
                      {label}
                    </button>
                  )
                })}
              </div>
            }
          />

          <ChartFigure
            title={title}
            subtitle={subtitle}
            xAxisLabel={xAxisLabel}
            valuePrefix={valuePrefix}
            valueSuffix={valueSuffix}
            series={series}
            rows={displayRows}
            settings={settings}
            progress={progress}
            frameRef={frameRef}
          />

          {/* Transport controls. Single compact row on desktop so
              the chart + controls fit above the fold; wraps on
              narrow screens. */}
          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
            <button
              type="button"
              onClick={handlePlayPause}
              disabled={!canPlay}
              className="footer-btn inline-flex items-center justify-center gap-1.5 px-3.5 text-sm font-semibold"
              style={{
                ...ctrlBase,
                height: 34,
                minWidth: 104,
                background: canPlay ? 'var(--text-primary)' : 'var(--bg-surface)',
                color: canPlay ? 'var(--bg)' : 'var(--text-muted)',
              }}
            >
              {playing ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
              {playing ? 'Pause' : progress >= maxIndex && maxIndex > 0 ? 'Replay' : 'Play'}
            </button>
            <button
              type="button"
              onClick={handleRestart}
              disabled={!canPlay}
              className="footer-btn inline-flex items-center justify-center"
              style={{ ...ctrlBase, height: 34, width: 34, opacity: canPlay ? 1 : 0.5 }}
              aria-label="Restart"
              title="Restart"
            >
              <SkipBack size={15} aria-hidden />
            </button>

            {/* Scrubber. */}
            <input
              type="range"
              min={0}
              max={maxIndex || 1}
              step={0.001}
              value={progress}
              disabled={!canPlay}
              onChange={(e) => handleScrub(Number(e.target.value))}
              className="chart-race-range min-w-[140px] flex-1"
              aria-label="Scrub timeline"
            />

            {/* Speed control. */}
            <span
              className="inline-flex items-center gap-1.5"
              style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-muted)' }}
            >
              <Gauge size={13} aria-hidden />
              Speed
            </span>
            <input
              type="range"
              min={2}
              max={30}
              step={0.5}
              // Invert so dragging right = faster (shorter duration).
              value={32 - durationSec}
              onChange={(e) => updateSettings({ durationSec: 32 - Number(e.target.value) })}
              className="chart-race-range min-w-[110px] flex-1"
              aria-label="Animation speed"
            />
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', minWidth: 56, textAlign: 'right' }}>
              {durationSec.toFixed(1)}s run
            </span>
          </div>
        </section>

        {/* ── Data grid editor (memoized: isolated from per-frame
              playhead re-renders so the animation stays smooth). ── */}
        <DataGrid />

        {/* ── Style + labels (memoized for the same reason). ───── */}
        <StyleSection />

        {/* ── Footer note + reset, mirroring the tier-list page. ── */}
        <p className="mt-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Your data stays on your device. Nothing is uploaded to any server.
        </p>
        <p className="mt-2 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          <span>Saved on this device - it&rsquo;ll be here when you come back.</span>
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm('Load the sample dataset (OP vs SP500 vs BTC)? This replaces your current data.')
              if (ok) {
                loadSample()
                handleScrub(0)
              }
            }}
            className="underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Load sample
          </button>
          <span aria-hidden>·</span>
          <button
            type="button"
            onClick={() => {
              const ok = window.confirm('Clear all data, lines, and labels? This cannot be undone.')
              if (ok) {
                clearAll()
                handleScrub(0)
                setImportOpen(true)
              }
            }}
            className="underline underline-offset-2"
            style={{ color: 'var(--text-muted)' }}
          >
            Clear everything
          </button>
        </p>
      </div>
    </div>
  )
}

/* ──────────────────────────────────────────────────────────────
   Data import panel. Memoized + reads the store directly so it
   never re-renders during chart playback (the parent's per-frame
   `progress` updates can't reach it). Prominent drag-and-drop
   target plus a paste box, because "drop a file and go" is the
   whole point of this tool for social content.
   ────────────────────────────────────────────────────────────── */
const ImportPanel = memo(function ImportPanel({
  formId,
  onClose,
  onAfterLoad,
}: {
  formId: string
  onClose: () => void
  onAfterLoad: () => void
}) {
  const series = useChartRace((s) => s.series)
  const replaceGrid = useChartRace((s) => s.replaceGrid)
  const [csvText, setCsvText] = useState('')
  const [csvError, setCsvError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const applyCsv = useCallback(
    (text: string) => {
      // Guard against binary / spreadsheet files that slipped past the
      // picker filter (e.g. dragged-and-dropped). A NUL byte or a ZIP
      // signature (xlsx/numbers are zipped) means it isn't text CSV.
      if (text.includes('\u0000') || text.startsWith('PK\u0003\u0004')) {
        setCsvError('That looks like a binary or spreadsheet file. Export it as CSV (File - Save As - CSV) and try again.')
        return
      }
      const res = parseCsv(text, series)
      if (!res.ok || !res.series || !res.rows) {
        setCsvError(res.error ?? 'Could not parse that CSV.')
        return
      }
      replaceGrid({ xAxisLabel: res.xAxisLabel ?? 'Date', series: res.series, rows: res.rows })
      setCsvError(null)
      setCsvText('')
      onAfterLoad()
      onClose()
    },
    [series, replaceGrid, onAfterLoad, onClose],
  )

  const onFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0]
      if (!file) return
      // Reject obviously-wrong file types up front (drag-drop bypasses
      // the picker's accept filter).
      const name = file.name.toLowerCase()
      if (/\.(xlsx|xls|numbers|pdf|docx?|pages|key|zip|png|jpe?g|gif|webp|heic)$/.test(name)) {
        const ext = name.slice(name.lastIndexOf('.') + 1)
        setCsvError(`.${ext} files aren't supported. Save or export your data as a .csv (or .tsv) first.`)
        return
      }
      // Cap at 8 MB - a CSV for this tool is kilobytes; anything huge is
      // a mistake and would jank the grid.
      if (file.size > 8 * 1024 * 1024) {
        setCsvError('That file is too large (over 8 MB). This tool expects a small CSV of a few hundred rows.')
        return
      }
      if (file.size === 0) {
        setCsvError('That file is empty.')
        return
      }
      const reader = new FileReader()
      reader.onerror = () => setCsvError('Could not read that file. Try copying the data into the paste box instead.')
      reader.onload = () => applyCsv(String(reader.result ?? ''))
      reader.readAsText(file)
    },
    [applyCsv],
  )

  return (
    <section
      aria-label="Import data"
      className="mb-6 flex flex-col p-4"
      style={{ ...ctrlBase, borderRadius: 8, boxShadow: 'var(--shadow-card)' }}
    >
      <SectionLabel icon={FileUp} label="Add your data" />

      {/* Big drop target. The whole tile is a <label> tied to the
          hidden file input, so a click anywhere opens the file
          picker and a drag-drop loads the file directly. */}
      <label
        htmlFor={`${formId}-csv-file`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          onFiles(e.dataTransfer.files)
        }}
        className="flex cursor-pointer flex-col items-center justify-center gap-2 text-center"
        style={{
          ...ctrlBase,
          borderStyle: 'dashed',
          borderWidth: 2,
          borderColor: dragOver ? BRAND : 'color-mix(in srgb, #E85D2A 35%, var(--border-subtle))',
          background: dragOver
            ? 'color-mix(in srgb, #E85D2A 10%, var(--bg-surface))'
            : 'var(--bg-surface)',
          padding: '28px 16px',
          transition: 'border-color 150ms ease, background 150ms ease',
        }}
      >
        <Upload size={26} strokeWidth={2} style={{ color: BRAND }} aria-hidden />
        <span style={{ fontWeight: 700, fontSize: 14, color: 'var(--text-primary)' }}>
          Drop a CSV here, or click to choose a file
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          .csv or .tsv · first column is the x-axis, every other column is a line
        </span>
        <input
          id={`${formId}-csv-file`}
          type="file"
          accept=".csv,text/csv,.tsv,text/tab-separated-values"
          className="sr-only"
          onChange={(e) => {
            onFiles(e.target.files)
            e.target.value = ''
          }}
        />
      </label>

      {/* Divider: or paste. */}
      <div className="my-3 flex items-center gap-3" aria-hidden>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
          or paste
        </span>
        <div style={{ flex: 1, height: 1, background: 'var(--border-subtle)' }} />
      </div>

      <textarea
        value={csvText}
        onChange={(e) => {
          setCsvText(e.target.value)
          setCsvError(null)
        }}
        spellCheck={false}
        placeholder={'Date,Coffee,Tea\n2021,100,100\n2022,112,106\n2023,121,109'}
        rows={6}
        className="w-full resize-y p-3 text-sm"
        style={{
          ...ctrlBase,
          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
          fontSize: 12.5,
          lineHeight: 1.5,
        }}
      />
      {csvError && (
        <p className="mt-2 text-xs" style={{ color: BRAND }}>
          {csvError}
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => applyCsv(csvText)}
          disabled={!csvText.trim()}
          className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-semibold"
          style={{ ...uploadChip, opacity: csvText.trim() ? 1 : 0.5 }}
        >
          <Check size={14} aria-hidden />
          Load pasted data
        </button>
        <button
          type="button"
          onClick={async () => {
            try {
              const text = await navigator.clipboard.readText()
              setCsvText(text)
              setCsvError(null)
            } catch {
              setCsvError('Clipboard read was blocked. Paste into the box manually.')
            }
          }}
          className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-medium"
          style={{ ...ctrlBase, height: 30 }}
        >
          <ClipboardPaste size={14} aria-hidden />
          Paste from clipboard
        </button>
      </div>
    </section>
  )
})

/* ──────────────────────────────────────────────────────────────
   Data grid editor. Memoized + store-connected so it sits out the
   animation's per-frame re-renders entirely - the single biggest
   win for playback smoothness, since this table can hold dozens of
   live inputs.
   ────────────────────────────────────────────────────────────── */
const DataGrid = memo(function DataGrid() {
  const {
    series,
    rows,
    xAxisLabel,
    setXAxisLabel,
    renameSeries,
    recolorSeries,
    setSeriesImage,
    addSeries,
    removeSeries,
    setRowLabel,
    setCellValue,
    addRow,
    removeRow,
    clearData,
  } = useChartRace()

  // Which line a pasted image lands on. Armed by clicking anywhere in
  // a line's header column (or its image slot). With a single line we
  // don't need an explicit pick, so paste just works.
  const [armedSeriesId, setArmedSeriesId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const targetForPaste = armedSeriesId ?? (series.length === 1 ? series[0]?.id ?? null : null)

  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const file = Array.from(event.clipboardData?.items ?? [])
        .filter((it) => it.kind === 'file' && it.type.startsWith('image/'))
        .map((it) => it.getAsFile())
        .find((f): f is File => Boolean(f))
      if (!file) return
      if (!targetForPaste) return
      event.preventDefault()
      void fileToHeadImage(file).then((url) => {
        if (url) setSeriesImage(targetForPaste, url)
      })
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [targetForPaste, setSeriesImage])

  return (
    <section
      aria-label="Data"
      className="mb-6 p-4"
      style={{ ...ctrlBase, borderRadius: 8, boxShadow: 'var(--shadow-card)' }}
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (!file || !armedSeriesId) return
          void fileToHeadImage(file).then((url) => {
            if (url) setSeriesImage(armedSeriesId, url)
          })
        }}
      />
      <SectionLabel
        icon={Table}
        label="Data"
        right={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => addSeries(`Series ${series.length + 1}`, pickColor(series.length))}
              className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
              style={{ ...ctrlBase, height: 28 }}
            >
              <Plus size={14} aria-hidden />
              Add line
            </button>
            <button
              type="button"
              onClick={addRow}
              disabled={series.length === 0}
              className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
              style={{ ...ctrlBase, height: 28, opacity: series.length === 0 ? 0.5 : 1 }}
            >
              <Plus size={14} aria-hidden />
              Add row
            </button>
            <button
              type="button"
              onClick={() => {
                if (series.length === 0 && rows.length === 0) return
                const ok = window.confirm('Clear all lines and rows? Titles and labels are kept.')
                if (ok) clearData()
              }}
              disabled={series.length === 0 && rows.length === 0}
              className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
              style={{ ...ctrlBase, height: 28, opacity: series.length === 0 && rows.length === 0 ? 0.5 : 1 }}
              title="Clear all lines and rows"
            >
              <Trash2 size={14} aria-hidden />
              Clear data
            </button>
          </div>
        }
      />

      {series.length === 0 ? (
        <p className="py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
          No lines yet. Add a line, or import a CSV above.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <p className="mb-2 flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
            <ImageIcon size={13} aria-hidden style={{ color: BRAND }} />
            {targetForPaste ? (
              <span>
                Paste an image (Cmd/Ctrl+V) to set the head of{' '}
                <strong style={{ color: 'var(--text-primary)' }}>
                  {series.find((s) => s.id === targetForPaste)?.name || 'this line'}
                </strong>
                , or click a line&rsquo;s image box to upload.
              </span>
            ) : (
              <span>Click a line to select it, then paste an image (Cmd/Ctrl+V) or click its image box to set the head.</span>
            )}
          </p>
          <table className="w-full border-collapse" style={{ fontSize: 13 }}>
            <thead>
              <tr>
                <th className="p-1 text-left" style={{ minWidth: 120 }}>
                  <input
                    value={xAxisLabel}
                    onChange={(e) => setXAxisLabel(e.target.value)}
                    placeholder="Date"
                    className="w-full px-2 py-1.5 text-xs font-semibold"
                    style={{ ...ctrlBase }}
                    aria-label="X axis label"
                  />
                </th>
                {series.map((s) => (
                  <th
                    key={s.id}
                    className="p-1"
                    style={{
                      minWidth: 130,
                      borderRadius: 8,
                      // Inset ring so it draws inside the cell bounds and
                      // can't be clipped by the horizontal scroll container
                      // on the leading/trailing columns.
                      boxShadow:
                        armedSeriesId === s.id
                          ? `inset 0 0 0 1.5px ${BRAND}`
                          : 'none',
                    }}
                    onClickCapture={() => setArmedSeriesId(s.id)}
                    onFocusCapture={() => setArmedSeriesId(s.id)}
                  >
                    <div className="flex items-center gap-1">
                      <input
                        type="color"
                        value={s.color}
                        onChange={(e) => recolorSeries(s.id, e.target.value)}
                        className="shrink-0 cursor-pointer"
                        style={{ width: 26, height: 30, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'transparent' }}
                        aria-label={`${s.name} colour`}
                      />
                      <div className="relative shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setArmedSeriesId(s.id)
                            fileInputRef.current?.click()
                          }}
                          className="inline-flex items-center justify-center overflow-hidden"
                          style={{ width: 30, height: 30, padding: 0, border: '1px solid var(--border-subtle)', borderRadius: 6, background: 'var(--bg-surface)', cursor: 'pointer' }}
                          aria-label={s.image ? `Replace ${s.name} head image` : `Add head image to ${s.name}`}
                          title={s.image ? 'Replace head image (click to upload, or paste)' : 'Add a head image: click to upload, or copy an image and paste'}
                        >
                          {s.image ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <ImageIcon size={14} aria-hidden style={{ color: 'var(--text-muted)' }} />
                          )}
                        </button>
                        {s.image && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSeriesImage(s.id, null)
                            }}
                            aria-label={`Remove ${s.name} head image`}
                            title="Remove head image"
                            style={{ position: 'absolute', top: -6, right: -6, width: 16, height: 16, borderRadius: 999, background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', lineHeight: 0, padding: 0 }}
                          >
                            <X size={10} aria-hidden />
                          </button>
                        )}
                      </div>
                      <input
                        value={s.name}
                        onChange={(e) => renameSeries(s.id, e.target.value)}
                        className="chart-race-series-name w-full px-2 py-1.5 text-xs font-semibold"
                        style={{ ...ctrlBase }}
                        aria-label="Series name"
                      />
                      <button
                        type="button"
                        onClick={() => removeSeries(s.id)}
                        className="footer-btn inline-flex shrink-0 items-center justify-center"
                        style={{ ...ctrlBase, width: 28, height: 30 }}
                        aria-label={`Remove ${s.name}`}
                        title={`Remove ${s.name}`}
                      >
                        <Trash2 size={13} aria-hidden />
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, ri) => (
                <tr key={ri}>
                  <td className="p-1">
                    <input
                      value={row.label}
                      onChange={(e) => setRowLabel(ri, e.target.value)}
                      placeholder="Label"
                      className="w-full px-2 py-1.5 text-xs"
                      style={{ ...ctrlBase }}
                      aria-label={`Row ${ri + 1} label`}
                    />
                  </td>
                  {series.map((s, si) => (
                    <td key={s.id} className="p-1">
                      <div className="flex items-center gap-1">
                        <input
                          inputMode="decimal"
                          value={row.values[si] == null ? '' : String(row.values[si])}
                          onChange={(e) => {
                            const raw = e.target.value.trim()
                            if (raw === '') {
                              setCellValue(ri, si, null)
                              return
                            }
                            const num = Number(raw.replace(/,/g, ''))
                            setCellValue(ri, si, Number.isFinite(num) ? num : null)
                          }}
                          placeholder="-"
                          className="w-full px-2 py-1.5 text-xs"
                          style={{ ...ctrlBase, textAlign: 'right' }}
                          aria-label={`${s.name} at ${row.label || `row ${ri + 1}`}`}
                        />
                        {si === series.length - 1 && (
                          <button
                            type="button"
                            onClick={() => removeRow(ri)}
                            className="footer-btn inline-flex shrink-0 items-center justify-center"
                            style={{ ...ctrlBase, width: 28, height: 30 }}
                            aria-label={`Remove row ${ri + 1}`}
                            title="Remove row"
                          >
                            <Trash2 size={13} aria-hidden />
                          </button>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
})

/* ──────────────────────────────────────────────────────────────
   Title / labels / style toggles. Memoized + store-connected for
   the same per-frame isolation as the data grid.
   ────────────────────────────────────────────────────────────── */
const StyleSection = memo(function StyleSection() {
  const {
    title,
    subtitle,
    xAxisLabel,
    valuePrefix,
    valueSuffix,
    settings,
    setTitle,
    setSubtitle,
    setXAxisLabel,
    setValuePrefix,
    setValueSuffix,
    updateSettings,
    clearLabels,
  } = useChartRace()

  const hasLabels =
    title !== '' ||
    subtitle !== '' ||
    valuePrefix !== '' ||
    valueSuffix !== '' ||
    (xAxisLabel !== '' && xAxisLabel !== 'Date')

  return (
    <section
      aria-label="Style"
      className="mb-6 p-4"
      style={{ ...ctrlBase, borderRadius: 8, boxShadow: 'var(--shadow-card)' }}
    >
      <SectionLabel
        icon={Sparkles}
        label="Title & style"
        right={
          <button
            type="button"
            onClick={() => {
              if (!hasLabels) return
              const ok = window.confirm('Reset the title, subtitle, and axis/value labels? Your data is kept.')
              if (ok) clearLabels()
            }}
            disabled={!hasLabels}
            className="footer-btn inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold"
            style={{ ...ctrlBase, height: 28, opacity: hasLabels ? 1 : 0.5 }}
            title="Reset title and labels"
          >
            <Trash2 size={14} aria-hidden />
            Reset labels
          </button>
        }
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Coffee vs Tea"
            className="px-3 py-2 text-sm"
            style={{ ...ctrlBase }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Subtitle</span>
          <input
            value={subtitle}
            onChange={(e) => setSubtitle(e.target.value)}
            placeholder="Price index, rebased to 100"
            className="px-3 py-2 text-sm"
            style={{ ...ctrlBase }}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>X-axis label</span>
          <input
            value={xAxisLabel}
            onChange={(e) => setXAxisLabel(e.target.value)}
            placeholder="Date"
            className="px-3 py-2 text-sm"
            style={{ ...ctrlBase }}
          />
        </label>
        <div className="flex gap-3">
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Value prefix</span>
            <input
              value={valuePrefix}
              onChange={(e) => setValuePrefix(e.target.value)}
              placeholder="$"
              className="px-3 py-2 text-sm"
              style={{ ...ctrlBase }}
            />
          </label>
          <label className="flex flex-1 flex-col gap-1">
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>Value suffix</span>
            <input
              value={valueSuffix}
              onChange={(e) => setValueSuffix(e.target.value)}
              placeholder="%"
              className="px-3 py-2 text-sm"
              style={{ ...ctrlBase }}
            />
          </label>
        </div>
      </div>

      {/* Toggles. The $/% value mode lives on the chart header, so
          it's intentionally not repeated here. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <ToggleChip label="Growing axis" active={settings.dynamicAxis} onClick={() => updateSettings({ dynamicAxis: !settings.dynamicAxis })} />
        <ToggleChip label="Smooth curves" active={settings.smooth} onClick={() => updateSettings({ smooth: !settings.smooth })} />
        <ToggleChip label="Area fill" active={settings.area} onClick={() => updateSettings({ area: !settings.area })} />
        <ToggleChip label="Value labels" active={settings.showValues} onClick={() => updateSettings({ showValues: !settings.showValues })} />
      </div>
    </section>
  )
})

/* ── Small pill toggle used in the style section. ──────────────── */
function ToggleChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="footer-btn inline-flex items-center gap-1.5 px-3 text-xs font-semibold"
      style={{
        ...ctrlBase,
        height: 32,
        background: active ? 'var(--text-primary)' : 'var(--bg-surface)',
        color: active ? 'var(--bg)' : 'var(--text-secondary)',
        borderColor: active ? 'var(--text-primary)' : 'var(--border-subtle)',
      }}
      aria-pressed={active}
    >
      {active ? <Check size={13} aria-hidden /> : null}
      {label}
    </button>
  )
}
