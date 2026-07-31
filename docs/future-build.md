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

---

## Paid-tournament autopilot: no-show handling, reliability score, region lobbies

Status: SCOPED, decisions locked (captured 2026-07-30). This is the P1 build for
paid tournaments, to land right after the P0 launch-blocker work (cancel /
refund / manual-settle / withdraw / needs-attention). Goal: make a paid
tournament run end-to-end with the operator only ever touching (1) applicant
approval, (2) genuine disputes, (3) a rare unbreakable pay-line tie. Everything
else is automated.

### Problem

A player who goes AFK and never reports can distort a Swiss bracket. The ripple
is narrower than it first seems, but the real distortion is worth killing.

What today's policy already handles (baseline, do not regress):

- One-sided report auto-confirms at the hard round deadline (present player taps
  "Win", it stands). See `enforceRoundDeadlines()` in
  `src/lib/tournament/service.ts`.
- Both players silent = `double_forfeit` (both lose). Anti-stalling backstop.
- Conflicting reports = `disputed`, freezes for operator.
- `double_forfeit` already counts as a played loss for both in standings
  (`tallyMatches` in `src/lib/tournament/pairing.ts`).

The remaining distortion: a persistent ghost who stays in the bracket becomes a
**random free win** for whoever draws them each round. That is luck, not skill.

### Decision 1: no-show handling = auto-drop + cross-tournament reliability score

Locked: drop_plus_score.

- When a player is flagged as a no-show for a round, **auto-drop them from that
  tournament** (set `dropped`) so they never poison a future pairing. Swiss then
  pairs the remaining field (bye on odd parity) as normal. This converts "ghost
  taints N future rounds" into "ghost cost exactly one opponent a one-tap
  self-report in round K, then they're gone".
- No-show definition at hard deadline (we only have report data, not presence):
  - opponent reports win + player silent -> player = no-show (drop).
  - both silent -> `double_forfeit`, both flagged as soft no-show.
  - player concedes (reports own loss) -> NOT a no-show (they acted).
  - conflicting -> dispute, neither flagged.
- Track a **profile-level reliability score** keyed by wallet (persists across
  events, like `wallet_standings`). Counters: `matches_played`,
  `matches_reported_on_time`, `no_shows`, `double_forfeits`, `clean_drops`,
  `disputes_lost`, plus a derived 0-100 score (fresh account starts neutral,
  recovers over time). Weight it so a strong-attendance player barely feels a
  single "both silent" double forfeit while a serial offender's score craters.

### Decision 2: repeat offenders gated to manual approval

Locked: manual gate (not auto-cooldown, not warn-only).

- First offense already costs the match + the entry money; the escalation hits
  the offender's **ability to keep entering**, never the opponent (the opponent
  already got the win).
- Below a reliability threshold, a paid-tournament application is forced into the
  manual-approval queue (operator decides), regardless of any future auto-approve
  path. Surface the applicant's reliability score + no-show count in the approval
  UI so the decision is informed.

### Decision 3: voluntary drop != no-show

- A clean self-serve "Drop" is a **minor** score event; ghosting is the penalized
  one. This nudges frustrated players (e.g. "lost round 1, can't top-cut") toward
  the exit button instead of vanishing and poisoning others.
- Pair with participation incentives already in the system (participation badge /
  consolation) to keep the bottom half engaged.

### Decision 4: region-locked lobbies (timezone), OPTIONAL per lobby

Locked: locked_lobbies. Refined 2026-07-30: region gating must be a per-lobby
toggle, not a global rule.

- At creation the organizer picks one of: **Open (no region requirement)** or a
  specific region (reuse the existing AMER / EMEA / APAC `region` on players +
  `wallet_profiles`). Region-locked lobbies only admit that region; open lobbies
  admit everyone. This is the "jurisdiction or not" flexibility the operator
  asked for: a fast live lobby can require a region, a 24h international lobby can
  stay open.
- Region is a matchmaking / eligibility input only. Explicitly NOT a
  win-determinant: never auto-award a match based on declared timezone (region is
  self-declared, trivially gamed, unfair to travelers/night owls).
- Optional later: bias same-region pairings within an open lobby (groundwork
  exists in `scripts/tournament/region-pairing-sim.ts`).

### Decision 5: fully flexible round timing + live vs async modes

Refined 2026-07-30. The operator wants to set the round limit to anything and
have the format read correctly, from a live-paced jurisdictional event to a
multi-day international one.

- **Round length must accept any duration, minutes through hours/days**, not just
  whole hours. Today `adminCreatePaidGame` takes `paidRoundHours` (hours only).
  Widen this to a minutes-capable value (store round length in minutes, or a
  seconds field) so the operator can pick e.g. 30 or 45 min for a live event, or
  12/24/48 h for an async one. The hard-deadline autopilot
  (`enforceRoundDeadlines`) already keys off `rounds.endsAt`, so it works at any
  granularity; the only real constraint is the sweep cadence (see below).
- **Two implied modes, driven purely by round length (no separate flag needed,
  but label it in the UI so expectations are clear):**
  - **Live / synchronous** (short rounds, e.g. 30-45 min): participants are
    expected to be present for the whole event. Pair with a region requirement
    (Decision 4) so everyone is awake in the same window, and lean on the
    no-show auto-drop (Decision 1) hard, since a missed 30-min round is a real
    no-show, not a timezone problem.
  - **Async / international** (long rounds, e.g. 24h): open region, players
    schedule within the window. No-show weighting should be gentler here because
    a long window forgives timezone spread.
- **Both short (30-40 min) and long (N-hour) rounds are required for beta from
  day one** (operator decision 2026-07-30: early beta testing will lean on
  frequent short-round events with small groups). So the sweep-cadence fix below
  is a BETA BLOCKER, not a fast-follow.
- **Sweep cadence is the binding constraint for short rounds.** Autopilot is an
  hourly Vercel cron today (`vercel.json`: `"schedule": "0 * * * *"`), so a 30-min
  "hard" deadline could be enforced up to ~59 min late. Fix, two layers:
  1. **Tighten the cron** to about every minute or two (Vercel Pro allows
     sub-hourly, e.g. `"* * * * *"`). This is the primary mechanism and makes
     short deadlines honest within a minute or so.
  2. **Lazy on-read enforcement (recommended addition).** In a live 30-min-round
     event players are actively loading the page, so also run
     `enforceRoundDeadlines` opportunistically on paid-tournament snapshot reads
     when the current round's `endsAt` has passed. That advances an active event
     near-instantly regardless of cron. Requires idempotency / a short lock so
     concurrent reads can't double-advance (the on-chain `Locked -> Paid` guard
     already prevents double-settle; add equivalent guards for round advance and
     the double-forfeit writes).
  Net: cron guarantees eventual progress even for idle/async events; lazy on-read
  gives crisp advancement for active live events. With both, we do not need to
  cap the shortest selectable round length.
- **Setup-form surface (create-paid-game):** round length (value + unit
  min/hour), region requirement (Open or a region), plus the existing entry fee,
  rake, payout preset, cap, and format. Make the live-vs-async implication
  visible (e.g. a note like "short rounds = live event, players must stay
  active").

### Build sketch (whenever we start)

- Migration: reliability counters + score on `wallet_profiles` (or a small
  `wallet_reliability` table keyed by wallet); a `region` (or `lobby_region`)
  column on `tournaments` for locked lobbies; a `no_show` / drop-reason marker on
  `players` to distinguish auto-drop from clean drop.
- `service.ts`: extend `enforceRoundDeadlines()` to set `dropped` + record the
  no-show, and to bump the wallet's reliability counters. Add reliability read +
  the manual-approval gate in the enroll/approve path.
- Admin: region selector on the create-paid-game form; reliability + no-show
  columns in the approval queue.
- Profile UI: show the reliability score / "shows up" reputation stat.

### Edge cases to cover in the build

- No-show sitting in a pay position: auto-drop removes them from standings before
  settlement, so a ghost can't hold a paid slot (payouts are pull-based anyway).
- Odd-parity byes shift when a ghost is dropped mid-event: standard Swiss, fine.
- Collusion (one entrant ghosts to feed an ally a win): disincentivized because
  the ghost forfeits their own paid entry + tanks their reliability. Economic
  stake does the heavy lifting in paid events.
- Scheduling tie-in: ignoring all of an opponent's proposed times (schedule
  proposals) should count toward the no-show signal, against the non-responder.
