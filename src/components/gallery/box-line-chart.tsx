// Larger line chart for the booster box detail modal. Same data shape
// as the sparkline (`[unix_ms, market_price][]`) but with visible axes
// and a richer tooltip so users can read exact dates/prices.

'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { formatUsd } from '@/lib/pricing'

interface Props {
  data: [number, number][]
}

export function BoxLineChart({ data }: Props) {
  if (data.length < 2) return null

  const points = data.map(([t, v]) => ({ t, v }))

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={points} margin={{ top: 10, right: 24, left: 0, bottom: 6 }}>
        <defs>
          <linearGradient id="sb-line-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#E85D2A" stopOpacity={0.5} />
            <stop offset="100%" stopColor="#E85D2A" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--lb-border)" strokeDasharray="2 4" vertical={false} />
        <XAxis
          dataKey="t"
          tick={{ fill: 'var(--lb-fg-faint)', fontSize: 10 }}
          tickFormatter={(t) =>
            new Date(Number(t)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
          }
          stroke="var(--lb-border)"
        />
        <YAxis
          tick={{ fill: 'var(--lb-fg-faint)', fontSize: 10 }}
          tickFormatter={(v) => {
            const n = Number(v)
            return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
          }}
          stroke="var(--lb-border)"
          width={50}
        />
        <Tooltip
          contentStyle={{
            background: 'var(--lb-surface)',
            border: '1px solid var(--lb-border)',
            borderRadius: 6,
            fontSize: 12,
          }}
          labelFormatter={(t) =>
            new Date(Number(t)).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })
          }
          formatter={(v) => [formatUsd(Number(v)), 'Market']}
        />
        <Area
          type="monotone"
          dataKey="v"
          stroke="#E85D2A"
          strokeWidth={2}
          fill="url(#sb-line-fill)"
          isAnimationActive={false}
          dot={{ r: 2, stroke: '#E85D2A', fill: '#E85D2A', strokeWidth: 0 }}
          activeDot={{ r: 4 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  )
}
