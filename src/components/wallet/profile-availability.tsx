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
  supportedTimeZones,
  tzAbbrev,
  tzCity,
  offsetLabel,
} from '@/lib/wallet/availability'

function Chips({ hours, fromTz, toTz }: { hours: number[]; fromTz: string; toTz: string }) {
  if (hours.length === 0) {
    return <span className="text-xs" style={{ color: 'var(--text-muted)' }}>—</span>
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {hours.map((h, i) => {
        const { hour, dayShift } = convertHour(h, fromTz, toTz)
        return (
          <span
            key={i}
            className="inline-flex items-baseline gap-1 px-2 py-1 text-xs font-semibold tabular-nums"
            style={{
              borderRadius: 6,
              background: 'var(--bg)',
              border: '1px solid var(--border-subtle)',
              color: 'var(--text-secondary)',
            }}
          >
            {hourLabel(hour)}
            {dayShift !== 0 && (
              <span className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>
                {dayShift > 0 ? `+${dayShift}d` : `${dayShift}d`}
              </span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export function ProfileAvailability({ availability }: { availability: Availability | null }) {
  const detected = useMemo(() => detectTimeZone(), [])
  const [viewTz, setViewTz] = useState(detected)

  const tzOptions = useMemo(() => {
    const zones = supportedTimeZones()
    const extras = [viewTz, availability?.tz].filter((z): z is string => !!z && !zones.includes(z))
    return [...extras, ...zones]
  }, [viewTz, availability?.tz])

  if (!hasAvailability(availability)) return null
  const a = availability as Availability
  const theirTz = a.tz
  const off = theirTz ? offsetLabel(theirTz, viewTz) : null

  return (
    <div className="mt-6">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-2.5">
        <Clock size={15} style={{ color: '#7933bc' }} />
        <h3 className="font-display text-sm font-bold uppercase tracking-wider">Availability</h3>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          (checking chat &amp; ready to play)
        </span>
      </div>

      {/* Viewer timezone picker - chips render in this zone. */}
      <div style={{ position: 'relative', maxWidth: 280 }}>
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
      {off && (
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {off}
        </p>
      )}

      <div className="flex flex-col gap-3 mt-3">
        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Weekdays <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(Mon-Fri)</span>
          </div>
          <Chips hours={a.weekday} fromTz={theirTz} toTz={viewTz} />
        </div>
        <div>
          <div className="text-xs font-semibold mb-1.5" style={{ color: 'var(--text-secondary)' }}>
            Weekends <span style={{ color: 'var(--text-muted)', fontWeight: 500 }}>(Sat-Sun)</span>
          </div>
          <Chips hours={a.weekend} fromTz={theirTz} toTz={viewTz} />
        </div>
      </div>
    </div>
  )
}
