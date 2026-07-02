'use client'

// ProfileAvailability - shows a player's self-declared "when I'm around to play"
// hours. The player picks whole-hour blocks in THEIR timezone; the viewer picks
// the timezone they want to READ those hours in (defaults to their detected
// zone, but selectable so a VPN/emulator mismatch can be corrected). Chips show
// the times already converted into the selected zone.
//
// The section ALWAYS renders (with a placeholder when empty) and the times sit
// in a single horizontal scroll row, so the profile modal is one fixed size no
// matter how many hours a player sets.

import { useMemo, useState } from 'react'
import { Clock, ChevronDown } from 'lucide-react'
import { ShelfRow } from './profile-shelf'
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

export function ProfileAvailability({ availability }: { availability: Availability | null }) {
  const detected = useMemo(() => detectTimeZone(), [])
  const [viewTz, setViewTz] = useState(detected)

  const tzOptions = useMemo(() => {
    const zones = commonTimeZones()
    const extras = [viewTz, availability?.tz].filter((z): z is string => !!z && !zones.includes(z))
    return [...extras, ...zones]
  }, [viewTz, availability?.tz])

  const available = hasAvailability(availability)
  const a = availability as Availability | null
  const allHours = available
    ? [...new Set([...(a?.weekday ?? []), ...(a?.weekend ?? [])])].sort((x, y) => x - y)
    : []
  const viewerHours = available
    ? [...new Set(allHours.map((h) => convertHour(h, a!.tz, viewTz).hour))].sort((x, y) => x - y)
    : []

  return (
    <div className="mt-5">
      <div className="mb-2.5 flex items-center gap-1.5">
        <Clock size={14} style={{ color: '#7933bc', flexShrink: 0 }} />
        <span className="text-[13px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
          {available ? 'View their availability in your timezone.' : 'Availability'}
        </span>
      </div>

      {available ? (
        <>
          {/* Viewer timezone picker - chips render in this zone. Full width. */}
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
              style={{ position: 'absolute', right: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}
            />
          </div>
          <div className="mt-3">
            <ShelfRow gapClass="gap-1.5">
              {viewerHours.map((hour) => (
                <span
                  key={hour}
                  className="inline-flex items-baseline px-2 py-1 text-xs font-semibold tabular-nums"
                  style={{ borderRadius: 6, background: 'var(--bg)', border: '1px solid var(--border-subtle)', color: 'var(--text-secondary)' }}
                >
                  {hourLabel(hour)}
                </span>
              ))}
            </ShelfRow>
          </div>
        </>
      ) : (
        <div
          className="flex items-center px-3"
          style={{ minHeight: 76, borderRadius: 8, border: '1px dashed var(--border-subtle)', background: 'color-mix(in srgb, var(--bg) 60%, transparent)' }}
        >
          <span className="text-xs" style={{ color: 'var(--text-muted)', opacity: 0.75 }}>
            No availability shared yet.
          </span>
        </div>
      )}
    </div>
  )
}
