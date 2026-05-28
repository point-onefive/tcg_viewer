// Tiny recharts wrapper for the lightbox price-history sparkline. Kept
// in its own file so the lightbox can `next/dynamic`-load it; recharts
// pulls in a non-trivial amount of code we don't want on first paint
// of the wall.

'use client'

import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatUsdCompact } from '@/lib/pricing'

interface SparklineProps {
  /** `[unix_ms, market_price]` tuples, oldest first. */
  data: [number, number][]
}

export function Sparkline({ data }: SparklineProps) {
  if (data.length < 2) return null

  const points = data.map(([t, v]) => ({ t, v }))
  const min = Math.min(...points.map((p) => p.v))
  const max = Math.max(...points.map((p) => p.v))
  const padding = Math.max((max - min) * 0.15, max * 0.04)
  const yDomain: [number, number] = [
    Math.max(0, min - padding),
    max + padding,
  ]

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={48}>
      <AreaChart data={points} margin={{ top: 4, right: 4, left: 4, bottom: 2 }}>
        <defs>
          <linearGradient id="pp-spark-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E85D2A" stopOpacity={0.65} />
            <stop offset="100%" stopColor="#E85D2A" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis domain={yDomain} hide />
        <Tooltip
          cursor={{ stroke: 'var(--lb-fg-muted)', strokeWidth: 1, strokeDasharray: '2 2' }}
          contentStyle={{
            background: 'var(--lb-surface)',
            border: '1px solid var(--lb-border)',
            borderRadius: 6,
            fontSize: 11,
            padding: '4px 8px',
          }}
          labelFormatter={(t) =>
            new Date(Number(t)).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: '2-digit',
            })
          }
          formatter={(v) => [formatUsdCompact(Number(v)), 'Market']}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke="#E85D2A"
          strokeWidth={1.6}
          fill="url(#pp-spark-fill)"
          isAnimationActive={false}
          dot={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
