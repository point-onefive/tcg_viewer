# Agent guide

This file is a quick orientation for AI coding agents working in this
repo. The detailed conventions live in `.cursor/rules/*.mdc` (which
load automatically). This file is the human-readable index.

## Project at a glance

`tcg_viewer` is a Next.js gallery + tier-list maker for trading card
games (One Piece, Pokémon, Dragon Ball Super, Digimon, Gundam,
Lorcana).
Card data lives in `src/lib/cards-*.json` bundles produced by the
scripts in `scripts/`. The deployed UI reads these bundles directly
at build time.

The `/tournaments` feature is the one **stateful** surface: it runs
on Supabase (Postgres) behind Next.js route handlers rather than the
static-bundle pattern. See `docs/tournaments.md` for setup +
architecture. It degrades gracefully (503) when Supabase env vars are
unset, so the rest of the site is unaffected.

## Routine operator tasks

| Task                                | Command / playbook                                                       |
| ----------------------------------- | ------------------------------------------------------------------------ |
| Find net-new One Piece prints       | `npm run cards:scan` — see `.cursor/rules/cards-scan-maintenance.mdc`    |
| Refresh One Piece catalog (full)    | `docs/data-pipeline.md` §4.2                                             |
| Refresh One Piece catalog (quick)   | `docs/data-pipeline.md` §4.1                                             |
| Ingest a single off-catalog print   | Edit `src/lib/cards-one-piece.json` directly — see `OP01-016_p9_sc` for the pattern |
| Refresh Lorcana catalog             | `npm run lorcana:all` then `npm run lorcana:r2` (source: LorcanaJSON)    |
| Dev server                          | `npm run dev` or `npm run dev:turbo`                                     |
| Production build                    | `npm run build`                                                          |

## Data pipeline

`docs/data-pipeline.md` is the source of truth for every fetcher,
every dedupe rule, and the refresh playbook. Read §4 before
suggesting any bulk catalog operation.

## When in doubt

If the user asks about catalog freshness, missing cards, new
products, or anything that smells like "is this card in the
gallery?" — the answer usually starts with `npm run cards:scan`.
See `.cursor/rules/cards-scan-maintenance.mdc` for the full workflow.
