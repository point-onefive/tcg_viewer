// Player availability - a lean, self-declared "when I'm usually around to play"
// schedule. NOT a precise calendar: players pick whole-hour blocks for weekdays
// and weekends in their own local timezone, and we convert to the viewer's
// timezone on the fly so cross-timezone opponents can eyeball overlap.
//
// This module is intentionally framework-free (no 'server-only', no React) so
// both the server (db.ts, route) and client components can share it.

export interface Availability {
  /** IANA timezone the hour blocks are expressed in, e.g. "America/New_York". */
  tz: string
  /** Hours (0-23, local to `tz`) the player is usually around, Mon-Fri. */
  weekday: number[]
  /** Hours (0-23, local to `tz`) the player is usually around, Sat-Sun. */
  weekend: number[]
}

/** Best-effort detection of the current browser/runtime timezone. */
export function detectTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

/** All IANA zones if the runtime supports it, else a small sensible fallback. */
export function supportedTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    if (typeof fn === 'function') {
      const zones = fn('timeZone')
      if (Array.isArray(zones) && zones.length) return zones
    }
  } catch {
    /* fall through */
  }
  return [
    'UTC',
    'America/Los_Angeles',
    'America/Denver',
    'America/Chicago',
    'America/New_York',
    'America/Sao_Paulo',
    'Europe/London',
    'Europe/Paris',
    'Europe/Berlin',
    'Africa/Johannesburg',
    'Asia/Dubai',
    'Asia/Kolkata',
    'Asia/Singapore',
    'Asia/Shanghai',
    'Asia/Tokyo',
    'Australia/Sydney',
  ]
}

/** "1 PM", "12 AM", "11 PM" - human, for display. */
export function hourLabel(h: number): string {
  const period = h < 12 ? 'AM' : 'PM'
  const base = h % 12 === 0 ? 12 : h % 12
  return `${base} ${period}`
}

/** "1p", "12a", "11p" - compact, for the toggle grid. */
export function shortHourLabel(h: number): string {
  const period = h < 12 ? 'a' : 'p'
  const base = h % 12 === 0 ? 12 : h % 12
  return `${base}${period}`
}

/**
 * UTC offset in minutes (+ = ahead of UTC) for an IANA zone at a given instant.
 * Library-free: formats the instant in the target zone, reads it back as if it
 * were UTC, and diffs. DST-correct for the instant supplied.
 */
export function tzOffsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const dtf = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    const m: Record<string, string> = {}
    for (const p of dtf.formatToParts(at)) if (p.type !== 'literal') m[p.type] = p.value
    let hh = Number(m.hour)
    if (hh === 24) hh = 0
    const asUTC = Date.UTC(Number(m.year), Number(m.month) - 1, Number(m.day), hh, Number(m.minute), Number(m.second))
    return Math.round((asUTC - at.getTime()) / 60000)
  } catch {
    return 0
  }
}

/**
 * Convert a recurring hour block from one zone to another using current
 * offsets. Returns the converted hour (0-23) and a day shift (-1, 0, +1) for
 * blocks that cross midnight.
 */
export function convertHour(
  hour: number,
  fromTz: string,
  toTz: string,
  at: Date = new Date(),
): { hour: number; dayShift: number } {
  const diffMin = tzOffsetMinutes(toTz, at) - tzOffsetMinutes(fromTz, at)
  const totalMin = hour * 60 + diffMin
  const dayMin = 24 * 60
  const dayShift = Math.floor(totalMin / dayMin)
  const normMin = ((totalMin % dayMin) + dayMin) % dayMin
  return { hour: Math.round(normMin / 60) % 24, dayShift }
}

/** Convert a list of hour blocks to the viewer's zone, with day-shift tags. */
export function convertedHourLabels(hours: number[], fromTz: string, toTz: string): string[] {
  return hours.map((h) => {
    const { hour, dayShift } = convertHour(h, fromTz, toTz)
    const base = hourLabel(hour)
    if (dayShift > 0) return `${base} +${dayShift}d`
    if (dayShift < 0) return `${base} ${dayShift}d`
    return base
  })
}

/** Current wall-clock time in a zone, e.g. "5:14 PM". */
export function nowInTz(tz: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit' }).format(new Date())
  } catch {
    return ''
  }
}

/** Short zone abbreviation for the instant, e.g. "EDT", "JST". */
export function tzAbbrev(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')
    return part?.value ?? tz
  } catch {
    return tz
  }
}

/** Friendly city portion of an IANA name, e.g. "America/New_York" -> "New York". */
export function tzCity(tz: string): string {
  const last = tz.split('/').pop() ?? tz
  return last.replace(/_/g, ' ')
}

/**
 * Plain-language offset of the viewer relative to the player, e.g.
 * "You're 5h behind them" / "Same time as you". Returns null if unknown.
 */
export function offsetLabel(theirTz: string, yourTz: string): string | null {
  if (!theirTz || !yourTz) return null
  const diffMin = tzOffsetMinutes(yourTz) - tzOffsetMinutes(theirTz)
  if (diffMin === 0) return 'Same timezone as you'
  const h = Math.abs(diffMin) / 60
  const label = `${Number.isInteger(h) ? h : h.toFixed(1)}h`
  return diffMin > 0 ? `You're ${label} ahead of them` : `You're ${label} behind them`
}

/** True when the player has actually declared any hours. */
export function hasAvailability(a: Availability | null | undefined): boolean {
  return !!a && ((a.weekday?.length ?? 0) > 0 || (a.weekend?.length ?? 0) > 0)
}

/**
 * Normalize untrusted input into a clean Availability (or null). Used on both
 * the write path (server) and when reading rows back. Hours are clamped to
 * 0-23, de-duped, and sorted; the tz is length-bounded.
 */
export function sanitizeAvailability(input: unknown): Availability | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  const tz = typeof obj.tz === 'string' ? obj.tz.trim().slice(0, 64) : ''
  const cleanHours = (v: unknown): number[] => {
    if (!Array.isArray(v)) return []
    const set = new Set<number>()
    for (const x of v) {
      const n = Math.trunc(Number(x))
      if (Number.isFinite(n) && n >= 0 && n <= 23) set.add(n)
    }
    return [...set].sort((a, b) => a - b)
  }
  const weekday = cleanHours(obj.weekday)
  const weekend = cleanHours(obj.weekend)
  if (!tz && weekday.length === 0 && weekend.length === 0) return null
  return { tz, weekday, weekend }
}
