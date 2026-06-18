# Tournaments

A self-serve tournament host/runner at `/tournaments`. Anyone can spin up a
bracket, share a code, and let players enroll, schedule matches across time
zones, and self-report results - no accounts required.

This is the **first stateful feature** in the project. Unlike the card wall /
tier list / sealed dashboard (which are static + `localStorage` + git-as-data),
tournaments need shared mutable multi-user state, so they run on **Supabase
(Postgres)** behind Next.js route handlers.

---

## Architecture

```
Browser ──fetch──▶ Next.js route handlers (/api/tournaments/*)
                     │  service-role Supabase client (server-only)
                     ▼
                  Supabase Postgres
```

- **Single trust boundary.** The browser never talks to Supabase directly.
  Every read/write goes through `/api/tournaments/*` route handlers using the
  **service-role key** (`src/lib/tournament/supabase.ts`, `import 'server-only'`).
  RLS is enabled on every table with **no policies**, so the anon key is denied
  by default - authorization is enforced in the app layer.
- **Identity = opaque tokens.** A tournament has one host token; each player has
  one player token. The server stores only `sha256(token)`. The plaintext lives
  only in the creator's browser (`localStorage`, keyed by code) and in the
  bookmarkable link. No passwords, no email. Losing the link = losing access.
- **"Realtime" = polling.** Active views poll the snapshot endpoint every ~12s.
  Tournament cadence is hours/days, so this is plenty and avoids websocket
  complexity. (Can be upgraded to Supabase Realtime later.)
- **Hands-off maintenance = Vercel Cron.** `vercel.json` runs
  `/api/cron/tournament-sweep` hourly to (1) auto-close enrollment timers and
  generate round 1, (2) auto-confirm ghosted single-sided reports past the
  confirmation window, and (3) advance fully-resolved rounds.

### Formats

- **Swiss** (default, best for async/global): fixed number of rounds, nobody
  eliminated early. Pairs by score, never repeats a pairing, gives the bye to
  the lowest-ranked player who hasn't had one. Tiebreak = opponent match-win %.
- **Single elimination**: seeded bracket, top seeds get byes when N isn't a
  power of two, winners advance until one remains.

Pairing/standings logic is pure and lives in `src/lib/tournament/pairing.ts`.

### Match resolution state machine

`pending → reported → confirmed` (or `disputed`). Both players report; if they
agree it confirms immediately. If only one reports, a provisional winner is
stored and the cron sweep confirms it after `CONFIRM_WINDOW_MINUTES` (120) -
this is the "loser ghosts, winner still advances" guarantee. Conflicting claims
go to `disputed` for the host. The host can override any match.

---

## One-time setup

### 1. Create a Supabase project

<https://supabase.com> → New project (free tier is fine). Grab from
**Project Settings → API**:

- Project URL
- `anon` public key (not strictly needed today, but harmless to set)
- `service_role` secret key (server-side only - keep it secret)

### 2. Apply the schema

Open **SQL Editor** in Supabase and paste/run `supabase/schema.sql` from this
repo. It creates the five tables (tournaments, players, rounds, matches,
schedule_proposals) and locks them down with RLS.

### 3. Set environment variables

Locally in `.env.local`, and in **Vercel → Project → Settings → Environment
Variables** (see `.env.example`):

```
TOURNAMENT_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
TOURNAMENT_SUPABASE_SECRET_KEY=YOUR-SECRET-KEY   # sb_secret_… server only
CRON_SECRET=some-long-random-string              # protects the cron route
```

The tournament backend uses **its own** env var names (`TOURNAMENT_SUPABASE_*`)
so it never collides with any other Supabase project the repo might use (e.g. a
separate market/alerts project on `NEXT_PUBLIC_SUPABASE_URL`).

If these are absent the rest of the site is unaffected - `/tournaments` simply
shows a friendly "backend not configured" message and the API returns 503.

### 4. Cron secret

`vercel.json` already schedules the hourly sweep. Vercel automatically sends
`Authorization: Bearer $CRON_SECRET` to cron routes, and the handler rejects
anything else. Set `CRON_SECRET` in Vercel and you're done. To trigger manually
in dev (where `CRON_SECRET` is usually unset, so the route is open):

```bash
curl http://localhost:3000/api/cron/tournament-sweep
```

### 5. (Optional) Discord login

Token-links work with zero extra setup. To additionally offer "Sign in with
Discord" (recoverable identity + avatars), create a Discord application, add the
OAuth redirect Supabase gives you, and enable the Discord provider under
**Supabase → Authentication → Providers**. The current MVP ships the token-link
flow; Discord is a documented fast-follow and not required to run.

---

## API surface (all under `/api/tournaments`)

| Method | Path                         | Who    | Purpose                                  |
| ------ | ---------------------------- | ------ | ---------------------------------------- |
| POST   | `/`                          | anyone | Create a tournament (returns host token) |
| GET    | `/:code`                     | public | Snapshot (bracket, players, standings)   |
| POST   | `/:code/enroll`              | wallet | Join (X handle read from wallet profile; returns player token) |
| POST   | `/:code/close`               | host   | Close enrollment + generate round 1      |
| POST   | `/:code/report`              | player | Report a match result                    |
| POST   | `/:code/override`            | host   | Force-resolve a match                    |
| POST   | `/:code/schedule`            | player | Propose / accept match times (UTC)       |
| POST   | `/:code/drop`                | both   | Self-drop, or host-drop a player         |
| GET    | `/api/cron/tournament-sweep` | cron   | Hourly maintenance sweep                 |

## Guard-rails

`MAX_PLAYERS = 256`, `MIN_PLAYERS_TO_START = 2`, duplicate display names per
tournament are rejected. Tune in `src/lib/tournament/service.ts`.
