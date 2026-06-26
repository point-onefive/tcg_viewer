'use client'

// ProfileAvailability - shows a player's self-declared "when I'm around to play"
// hours. The player picks whole-hour blocks in their own timezone; we render
// their local times AND convert to the viewer's timezone so cross-timezone
// opponents can spot overlap at a glance. Renders nothing if no hours are set.

import { useMemo } from 'react'
import { Clock } from 'lucide-react'
import {
  type Availability,
  hasAvailability,
  hourLabel,
  convertedHourLabels,
  detectTimeZone,
  nowInTz,
  tzAbbrev,
  tzCity,
  offsetLabel,
} from '@/lib/wallet/availability'

function Chips({ items }: { items: string[] }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((s, i) => (
        <span
          key={i}
          className="inline-flex items-center px-2 py-1 text-xs font-semibold"
          style={{
            borderRadius: 6,
            background: 'color-mix(in srgb, #E85D2A 12%, var(--bg))',
            border: '1px solid color-mix(in srgb, #E85D2A 30%, transparent)',
            color: '#E85D2A',
          }}
        >
          {s}
        </span>
      ))}
    </div>
  )
}

function Row({
  label,
  hours,
  theirTz,
  yourTz,
}: {
  label: string
  hours: number[]
  theirTz: string
  yourTz: string
}) {
  if (hours.length === 0) return null
  const showConverted = !!theirTz && !!yourTz && theirTz !== yourTz
  const yours = showConverted ? convertedHourLabels(hours, theirTz, yourTz) : []
  return (
    <div>
      <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
        {label}
      </div>
      <Chips items={hours.map(hourLabel)} />
      {showConverted && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          = {yours.join(', ')} your time
        </p>
      )}
    </div>
  )
}

export function ProfileAvailability({ availability }: { availability: Availability | null }) {
  const yourTz = useMemo(() => detectTimeZone(), [])
  if (!hasAvailability(availability)) return null
  const a = availability as Availability
  const theirTz = a.tz
  const off = theirTz && theirTz !== yourTz ? offsetLabel(theirTz, yourTz) : null

  return (
    <div className="mt-6">
      <div className="flex items-center gap-2 mb-1">
        <Clock size={15} style={{ color: '#E85D2A' }} />
        <h3 className="font-display text-sm font-bold uppercase tracking-wider">Availability</h3>
      </div>
      <p className="text-xs mb-3" style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>
        Usually checking chat &amp; ready to play.
        {theirTz && (
          <>
            {' '}
            {tzCity(theirTz)} time
            {nowInTz(theirTz) ? ` · now ${nowInTz(theirTz)} (${tzAbbrev(theirTz)})` : ''}.
          </>
        )}
      </p>

      <div className="flex flex-col gap-3">
        <Row label="Weekdays (Mon-Fri)" hours={a.weekday} theirTz={theirTz} yourTz={yourTz} />
        <Row label="Weekends (Sat-Sun)" hours={a.weekend} theirTz={theirTz} yourTz={yourTz} />
      </div>

      {off && (
        <p className="mt-2.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {off}. Highlighted chips are their local time.
        </p>
      )}
    </div>
  )
}
