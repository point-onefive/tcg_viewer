// ─────────────────────────────────────────────────────────────────────────
// Player feedback poll
//
// Approved players vote on one feedback question per event (e.g. preferred
// prize type). The poll is scoped to the *live* tournament row, so starting a
// fresh tournament gives a clean slate automatically (no rows for the new
// tournament id = zero votes), and the question/options can change between
// events by editing POLL_OPTIONS below.
//
// Eligibility (phase C, per-browser): any browser that completed sign-up for
// the live event may cast one vote, deduped per-browser server-side via a
// random voter id. This is intentionally lightweight; switching to secure
// per-player tokens (phase A) later only changes WHAT we put in `voter_id`
// and the eligibility check in the service; the table, the API shape, and
// the UI below all stay the same.
//
// The option list is deliberately data-driven so the three choices can be
// edited / extended in one place without touching the server or the UI.
// ─────────────────────────────────────────────────────────────────────────

export type PollChoice = 'cash' | 'slab' | 'sealed'

export interface PollOption {
  id: PollChoice
  /** Short button label. */
  label: string
  /** One-line explanation shown under the label. */
  blurb: string
}

/** The ballot. Order here is the order rendered. Subject to change later. */
export const POLL_OPTIONS: PollOption[] = [
  { id: 'cash', label: 'Cash', blurb: 'Straight cash prize' },
  { id: 'slab', label: 'Slab', blurb: 'A graded slab from PSA or Beckett' },
  { id: 'sealed', label: 'Sealed', blurb: 'Sealed product like packs or booster boxes' },
]

const POLL_CHOICE_IDS = POLL_OPTIONS.map((o) => o.id)

export function isPollChoice(value: unknown): value is PollChoice {
  return typeof value === 'string' && (POLL_CHOICE_IDS as string[]).includes(value)
}

export interface PollResults {
  totalVotes: number
  /** Keyed by PollChoice; always contains an entry for every option. */
  counts: Record<string, number>
}

/** A zeroed result set seeded from the option list. */
export function emptyPollResults(): PollResults {
  const counts: Record<string, number> = {}
  for (const o of POLL_OPTIONS) counts[o.id] = 0
  return { totalVotes: 0, counts }
}
