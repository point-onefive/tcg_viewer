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

export interface PollOption {
  /** Stable slug stored on each vote row. Never reuse across questions. */
  id: string
  /** Short button label. */
  label: string
  /** One-line explanation shown under the label. */
  blurb: string
}

/** Heading shown above the ballot when the event has no custom question. */
export const DEFAULT_POLL_QUESTION = 'Which prize would you prefer?'

/** The default ballot, used when an event has no custom options set. */
export const POLL_OPTIONS: PollOption[] = [
  { id: 'cash', label: 'Cash', blurb: 'Straight cash prize' },
  { id: 'slab', label: 'Slab', blurb: 'A graded slab from PSA or Beckett' },
  { id: 'sealed', label: 'Sealed', blurb: 'Sealed product like packs or booster boxes' },
]

/** Bounds for an admin-defined ballot. */
export const POLL_MIN_OPTIONS = 2
export const POLL_MAX_OPTIONS = 6
export const POLL_QUESTION_MAX = 160
export const POLL_LABEL_MAX = 60
export const POLL_BLURB_MAX = 140

/** Is `value` the id of one of the supplied options? */
export function isValidChoice(options: PollOption[], value: unknown): value is string {
  return typeof value === 'string' && options.some((o) => o.id === value)
}

/** Slugify a label into a stable, storage-safe option id. */
export function slugifyOptionId(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}

/**
 * Validate + clean an admin-submitted ballot. Returns the normalized question
 * (falling back to the default when blank) and a deduped option list with
 * stable ids. Throws a plain Error with a human message when invalid.
 */
export function normalizePollConfig(
  questionRaw: unknown,
  optionsRaw: unknown,
): { question: string; options: PollOption[] } {
  const question =
    (typeof questionRaw === 'string' ? questionRaw.trim() : '').slice(0, POLL_QUESTION_MAX) ||
    DEFAULT_POLL_QUESTION
  if (!Array.isArray(optionsRaw)) throw new Error('Poll options must be a list.')
  const seen = new Set<string>()
  const options: PollOption[] = []
  optionsRaw.forEach((o, i) => {
    const obj = (o ?? {}) as Record<string, unknown>
    const label = (typeof obj.label === 'string' ? obj.label.trim() : '').slice(0, POLL_LABEL_MAX)
    if (!label) return // skip empty rows
    const blurb = (typeof obj.blurb === 'string' ? obj.blurb.trim() : '').slice(0, POLL_BLURB_MAX)
    let id = typeof obj.id === 'string' && obj.id.trim() ? slugifyOptionId(obj.id) : slugifyOptionId(label)
    if (!id) id = `opt${i + 1}`
    while (seen.has(id)) id = `${id}_${i + 1}`
    seen.add(id)
    options.push({ id, label, blurb })
  })
  if (options.length < POLL_MIN_OPTIONS) {
    throw new Error(`Add at least ${POLL_MIN_OPTIONS} options with a label.`)
  }
  if (options.length > POLL_MAX_OPTIONS) {
    throw new Error(`At most ${POLL_MAX_OPTIONS} options.`)
  }
  return { question, options }
}

export interface PollResults {
  totalVotes: number
  /** Keyed by option id; always contains an entry for every option. */
  counts: Record<string, number>
}

/** A zeroed result set seeded from an option list (defaults to the ballot). */
export function emptyPollResults(options: PollOption[] = POLL_OPTIONS): PollResults {
  const counts: Record<string, number> = {}
  for (const o of options) counts[o.id] = 0
  return { totalVotes: 0, counts }
}
