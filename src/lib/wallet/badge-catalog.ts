// Badge catalog - the definitions for the "Badges" shelf on a player profile.
//
// Badges are awarded rows in the `profile_badges` table (wallet_address +
// badge_id); this catalog turns a stored `badge_id` into its art, name, and
// blurb. Add new badges here as they're created, drop the PNG in
// `public/badges/<id>.png`, then grant them (script or admin).
//
// Framework-free so it can be imported on both server and client.

export type BadgeTier = 'gold' | 'silver' | 'bronze' | 'special'

export interface BadgeDef {
  /** Stable id; matches the stored `badge_id` and the PNG filename. */
  id: string
  /** Short display name. */
  name: string
  /** One-line context shown on hover / tap. */
  description: string
  /** Accent tier for the frame glow. */
  tier: BadgeTier
  /** Served image path (transparent PNG). */
  image: string
  /**
   * Where clicking the badge takes you: the past-event page for the tournament
   * it commemorates (`/tournaments/<code>`), or the history list for badges that
   * span multiple events (e.g. OG). Omit for badges tied to no event.
   */
  link?: string
}

const FIRST_EVENT = '/tournaments/OP-UUZY4' // "The first one"
const BONK_EVENT = '/tournaments/OP-8BESQ' // "BONK Championship Series Vol. 1"

// Order here = display order in the shelf (championship badges lead).
export const BADGES: BadgeDef[] = [
  {
    id: 'bonk_king',
    name: 'BONK Champion',
    description: '1st place at the BONK Championship Series Vol. 1.',
    tier: 'gold',
    image: '/badges/bonk_king.png',
    link: BONK_EVENT,
  },
  {
    id: 'bonk_silver',
    name: 'BONK Finalist',
    description: '2nd place at the BONK Championship Series Vol. 1.',
    tier: 'silver',
    image: '/badges/bonk_silver.png',
    link: BONK_EVENT,
  },
  {
    id: 'bonk_bronze',
    name: 'BONK Bronze',
    description: '3rd place at the BONK Championship Series Vol. 1.',
    tier: 'bronze',
    image: '/badges/bonk_bronze.png',
    link: BONK_EVENT,
  },
  {
    id: 'beta_king',
    name: 'Beta Champion',
    description: "1st place at 'The first one', the first-ever Card Wall event.",
    tier: 'gold',
    image: '/badges/beta_king.png',
    link: FIRST_EVENT,
  },
  {
    id: 'beta_silver',
    name: 'Beta Finalist',
    description: "2nd place at 'The first one'.",
    tier: 'silver',
    image: '/badges/beta_silver.png',
    link: FIRST_EVENT,
  },
  {
    id: 'beta_bronze',
    name: 'Beta Bronze',
    description: "3rd place at 'The first one'.",
    tier: 'bronze',
    image: '/badges/beta_bronze.png',
    link: FIRST_EVENT,
  },
  {
    id: 'og',
    name: 'OG',
    description: 'Was there early - played in one of the first two Card Wall events.',
    tier: 'special',
    image: '/badges/og.png',
    link: '/tournaments/history',
  },
  {
    id: 'beta_tester',
    name: 'Beta Tester',
    description: "Competed in The Card Wall's very first tournament, 'The first one'.",
    tier: 'special',
    image: '/badges/beta_tester.png',
    link: FIRST_EVENT,
  },
]

/**
 * A badge ready to render on the profile shelf, from EITHER source: the static
 * catalog (participation / historical placements) or a per-tournament dynamic
 * award (admin-made, placement-assigned). The shelf treats them identically.
 */
export interface DisplayBadge {
  /** Stable react key. */
  key: string
  /** Image path or data URL. */
  image: string
  name: string
  description: string
  /** Where clicking navigates (usually the event's past-event page). */
  link?: string
  tier: BadgeTier
}

/** Placement -> tier (for the frame glow on dynamic per-tournament badges). */
export function tierByRank(rank: number | null | undefined): BadgeTier {
  if (rank === 1) return 'gold'
  if (rank === 2) return 'silver'
  if (rank === 3) return 'bronze'
  return 'special'
}

const BY_ID = new Map<string, BadgeDef>(BADGES.map((b) => [b.id, b]))
const ORDER = new Map<string, number>(BADGES.map((b, i) => [b.id, i]))

export function getBadgeDef(id: string): BadgeDef | null {
  return BY_ID.get(id) ?? null
}

/** Is `id` a known badge? */
export function isBadgeId(id: unknown): id is string {
  return typeof id === 'string' && BY_ID.has(id)
}

/** Catalog display order index (unknown ids sort last). */
export function badgeOrder(id: string): number {
  return ORDER.get(id) ?? Number.MAX_SAFE_INTEGER
}
