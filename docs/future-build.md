# Future build context

A running backlog of ideas, scoping notes, and "when we get to it" context for
things we have discussed but deliberately not built yet. Nothing here is
committed work. Each entry captures the intent, the current state, options, and
gotchas so we can pick it up later without re-deriving the analysis.

Status legend: IDEA (not started, no decision) / SCOPED (analyzed, awaiting go)
/ DEFERRED (decided to wait).

---

## Tournament sign-up anti-gaming / soft security

Status: SCOPED. NFA for now (captured 2026-07-03).

Goal: raise the cost of gaming tournament sign-ups and the next-event waitlist
(one person spinning up many entries to flood a capacity-capped field), using
layered soft barriers and flags rather than hard blocks. Perfect prevention is
not the goal; making abuse cost more than the payoff is.

### What we already have (the real baseline)

Sign-up is not anonymous. Two gates already make casual gaming expensive:

1. Wallet-backed sign-in (SIWE). The enroll + waitlist endpoints require a
   connected wallet with a valid signed session. See
   `src/app/api/tournaments/[code]/enroll/route.ts` and
   `src/app/api/tournaments/waitlist/route.ts`.
2. Verified X handle, deduped. The handle comes from the signed-in profile
   (never the request body, so it can't be spoofed), and `enroll` rejects a
   second active entry for the same handle. Waitlist join is also blocked for
   players already in the current enrolling event.
3. Human approval gate. Every entry is `pending` until the operator
   approves/rejects it.

Practical framing: wallets are free/instant to create, so the real friction is
X handles. Highest leverage is on the X side (account quality) or on generic
bot-blocking. The wallet is the primary anti-sybil primitive already.

### Signals we could collect (server-side, routes run on Node/Vercel)

- IP address (`x-forwarded-for`): easy to capture. Weak as a blocker (shared by
  households, game stores, campuses, mobile carriers; VPN/proxy rotates), good
  as a rate-limit + clustering flag.
- Geo (country/region/city): free from Vercel headers alongside the IP. Useful
  for flagging bursts from one location and complements the region field we
  already collect.
- User-Agent: free, low value, easily spoofed.
- Browser device fingerprint (canvas/fonts/screen/timezone, e.g. FingerprintJS):
  medium signal for one-machine-many-accounts. Privacy-invasive, defeatable,
  legally personal data.
- Per-browser device id in localStorage: we already use this pattern for poll
  vote dedupe. Trivial to clear/rotate, fine as a soft signal.

### Stronger, more on-brand signals

- Wallet quality gating: minimum wallet age, some on-chain activity, or holding
  a specific token/NFT (token-gating). Throwaway wallets are cheap to mint but
  hard to age or fund, so this raises cost sharply. Native to a wallet-first app.
- X account-age / follower threshold: filters day-old throwaway handles. Needs
  the paid X API.
- CAPTCHA / Cloudflare Turnstile at sign-up: cheapest bot barrier, near-zero UX
  friction, kills scripted floods.
- One-entry-per-wallet dedupe (we already enforce one-per-handle): easy second
  dedupe key.

### Recommended layered approach (best ROI order)

1. Capture IP + geo + user-agent + device id on each sign-up for AUDIT ONLY.
   Store, don't block. Lets us see gaming and lets the approve/reject queue flag
   suspicious clusters (same IP + fingerprint + brand-new handles).
2. Add Turnstile + a per-IP rate limit on enroll/waitlist endpoints. Stops the
   scripted-flood case cheaply.
3. Feed signals into the existing approval step as a "review" flag, not an
   auto-reject, to keep a human in the loop and avoid punishing legit players who
   share a network.
4. Only if abuse escalates: wallet-age / token-gating or X account-age
   thresholds.

### Storage sketch (whenever we build)

- A few nullable columns on the player (and waitlist) rows: `signup_ip`,
  `signup_country`, `signup_user_agent`, `device_id`, plus a `review_flag` /
  notes field. Or a small separate audit table keyed by player/waitlist id.

### Caveats

- Privacy/legal: IP and fingerprints are personal data (GDPR and similar). Needs
  a privacy-policy line, a clear fraud-prevention purpose, and a sane retention
  window.
- Soft, not perfect: "capture + flag + human approval + captcha" gets ~90% of the
  protection for ~10% of the effort. Fingerprinting/gating is the last mile only
  if needed.

---

## UI internationalization (multi-language page text)

Status: SCOPED. NFA for now (captured 2026-07-03).

Goal: offer language variants for the Card Wall's UI text (not card images, not
user-generated content) to reach non-English audiences.

### Feasibility

Very doable, low technical risk, but broad and tedious. No architectural blocker.
Difficulty moderate; effort meaningful (days-to-weeks of setup + string
extraction, then an ongoing translation cost).

### Why it's easy here

- Next.js App Router with first-class i18n support; `next-intl` slots in cleanly.
- Zero existing i18n to unwind (clean greenfield add, not a migration).
- Text and images are already separate; card catalog data (names/sets) lives in
  separate JSON bundles from UI chrome, so "translate the pages" is well-bounded.

### The real cost driver

- Copy is written inline in JSX across ~65 component files / ~24k lines of TSX,
  with a few very copy-heavy files (tournament live page, admin panel).
- Step one is string extraction: pull each hardcoded phrase into a keyed message
  catalog and replace with a lookup. Rough estimate 1,500 to 3,000 strings. This
  extraction pass is the bulk of the engineering effort.
- Translation itself is a separate, recurring cost (every string x every
  language, forever). Machine translation gets 80-90%, human pass for the last
  mile (tone, TCG terms, UI fit).

### Gotchas (all solvable)

- Pluralization + interpolation (ICU message format) for strings like
  "1 player owes" vs "8 players owe".
- Dynamic/user content stays untranslated (handles, typed tournament names, deck
  lists, admin-authored poll labels).
- Locale-aware dates/numbers/currency (countdowns, prize values, timestamps).
- URL/SEO strategy (locale routing like `/en/...`, `/ja/...` vs detection).
- Layout stretch (German long, Japanese short) can break tight buttons/pills.
- RTL only matters if we add Arabic/Hebrew.

### Rough effort shape

- Foundation (library, locale routing, provider, language switcher): ~1-2 days.
- Full string extraction + wiring: ~1-3 weeks, best done incrementally.
- First translation set per language: days of machine + human review, ongoing.
- Each new language after the system exists: cheap (mostly translation cost).

### Recommendation

Incremental, not big-bang. Stand up `next-intl` + a language switcher, then do
the highest-value surfaces first (home/gallery, then the public tournament page
since it's the sponsor-facing, most-shared screen). Leave the admin panel for
last or English-only (only the operator sees it).
