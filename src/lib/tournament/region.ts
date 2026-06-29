// Coarse geographic regions for scheduling. Players pick one explicitly at
// waitlist / sign-up (and on their profile, which pre-fills sign-up). We keep
// it to three buckets on purpose - enough to plan around time-zone overlap
// without over-segmenting a field that is still Americas-heavy. Region is
// always nullable end to end: existing rows (and anyone who joined before this
// existed) are `null` / "Unspecified" and never blocked.
//
// Framework-free so it can be imported on both server and client.

export type Region = 'amer' | 'emea' | 'apac'

export interface RegionInfo {
  id: Region
  /** Full label for menus and profile display. */
  label: string
  /** Compact tag for tight spots (admin counts, chips). */
  short: string
  /** One-line "who fits here" helper. */
  blurb: string
}

// Order = display order. Americas first (the current majority).
export const REGIONS: RegionInfo[] = [
  { id: 'amer', label: 'Americas', short: 'AMER', blurb: 'North & South America' },
  { id: 'emea', label: 'Europe & Africa', short: 'EMEA', blurb: 'Europe, Middle East & Africa' },
  { id: 'apac', label: 'Asia-Pacific', short: 'APAC', blurb: 'Asia, Australia & Oceania' },
]

const BY_ID = new Map<Region, RegionInfo>(REGIONS.map((r) => [r.id, r]))

export function isRegion(value: unknown): value is Region {
  return typeof value === 'string' && BY_ID.has(value as Region)
}

/** Coerce arbitrary input to a valid Region or null (for DB reads + API bodies). */
export function sanitizeRegion(value: unknown): Region | null {
  return isRegion(value) ? value : null
}

/** Full label, or "Unspecified" for a null/legacy region. */
export function regionLabel(value: Region | null | undefined): string {
  return value && BY_ID.has(value) ? BY_ID.get(value)!.label : 'Unspecified'
}

/** Compact tag, or "-" for a null/legacy region. */
export function regionShort(value: Region | null | undefined): string {
  return value && BY_ID.has(value) ? BY_ID.get(value)!.short : '-'
}
