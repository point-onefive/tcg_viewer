'use client'

// ProfileAvailability - shows a player's self-declared "when I'm around to play"
// hours. The player picks whole-hour blocks in THEIR timezone; the viewer picks
// the timezone they want to READ those hours in (defaults to their detected
// zone, but selectable so a VPN/emulator mismatch can be corrected). Chips show
// the times already converted into the selected zone. Renders nothing if no
// hours are set.

import { useMemo, useState } from 'react'
import { Clock, ChevronDown } from 'lucide-react'
import {
  type Availability,
  hasAvailability,
  hourLabel,
  convertHour,
  detectTimeZone,
  commonTimeZones,
  tzAbbrev,
  tzCity,
} from '@/lib/wallet/availability'

function Chips({ hours, fromTz, toTz }: { hours: number[]; fromTz: string; toTz: string }) {
  if (hours.length === 0) {
    return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
  }
  // Convert each declared hour into the viewer's timezone, then show plain times
  // sorted by time-of-day. No day-shift labels - just the hours. When the viewer
  // is in the setter's own timezone the offset is 0, so the times match exactly.
  const viewerHours = [...new Set(hours.map((h) => convertHour(h, fromTz, toTz).hour))].sort(
    (a, b) => a - b,
  )
  // Wrap onto as many rows as needed so every time is visible at a glance - no
  // hidden horizontal scroll (which read as "there might be more" on desktop).
  return (
    <div className="flex flex-wrap gap-1.5">
      {viewerHours.map((hour) => (
        <span
          key={hour}
          className="inline-flex items-baseline px-2 py-1 text-xs font-semibold tabular-nums"
          style={{
            borderRadius: 6,
            background: 'var(--bg)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-secondary)',
          }}
        >
          {hourLabel(hour)}
        </span>
      ))}
    </div>
  )
}

export function ProfileAvailability({ availability }: { availability: Availability | null }) {
  const detected = useMemo(() => detectTimeZone(), [])
  const [viewTz, setViewTz] = useState(detected)

  const tzOptions = useMemo(() => {
    const zones = commonTimeZones()
    const extras = [viewTz, availability?.tz].filter((z): z is string => !!z && !zones.includes(z))
    return [...extras, ...zones]
  }, [viewTz, availability?.tz])

  if (!hasAvailability(availability)) return null
  const a = availability as Availability
  const theirTz = a.tz
  const allHours = [...new Set([...(a.weekday ?? []), ...(a.weekend ?? [])])].sort((x, y) => x - y)

  return (
    <div className="mt-5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Clock size={14} style={{ color: '#7933bc', flexShrink: 0 }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          View their availability in your timezone.
        </span>
      </div>

      {/* Viewer timezone picker - chips render in this zone. Full width so it
          sits balanced in the card rather than floating narrow. */}
      <div style={{ position: 'relative', width: '100%' }}>
        <select
          value={viewTz}
          onChange={(e) => setViewTz(e.target.value)}
          aria-label="View times in timezone"
          style={{
            appearance: 'none',
            WebkitAppearance: 'none',
            MozAppearance: 'none',
            width: '100%',
            background: 'var(--bg)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 6,
            padding: '7px 34px 7px 11px',
            fontSize: 13,
            cursor: 'pointer',
            outline: 'none',
          }}
        >
          {tzOptions.map((tz) => (
            <option key={tz} value={tz}>
              {tzCity(tz)} ({tzAbbrev(tz)})
            </option>
          ))}
        </select>
        <ChevronDown
          size={15}
          aria-hidden
          style={{
            position: 'absolute',
            right: 11,
            top: '50%',
            transform: 'translateY(-50%)',
            color: 'var(--text-muted)',
            pointerEvents: 'none',
          }}
        />
      </div>
      <div className="mt-3">
        <Chips hours={allHours} fromTz={theirTz} toTz={viewTz} />
      </div>
    </div>
  )
}
