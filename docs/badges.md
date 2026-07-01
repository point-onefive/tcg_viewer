# Badges

Cosmetic awards shown on a player profile. A badge is a transparent-background
PNG (a shield/emblem) plus a catalog entry (name, blurb, tier, link). Players
earn badges through explicit grants in the `profile_badges` table. Badges are
purely for flavor: participation ("OG", "Beta Tester"), placement ("BONK
Champion"), or any future one-off. They never gate anything.

Placement lives entirely in badges now - there is no separate "trophy case".
Clicking a badge (or a prize) opens that event's past-event page.

There are **two kinds** of badge, both rendered identically on the shelf:

1. **Static catalog badges** - hand-authored, art in `public/badges/`, defined in
   `src/lib/wallet/badge-catalog.ts`, granted via `profile_badges`. Used for the
   original 8 (participation + the first two events' placements) and any future
   one-off/participation award. See "Onboarding a NEW badge" below.
2. **Dynamic per-tournament badges** - created by the host in the admin panel
   per event, awarded automatically by placement on completion. This is the
   go-to path for a new tournament's podium. See "Admin badge pool" below.

## Admin badge pool (dynamic, per-tournament)

In the tournament admin panel there's a **Badge pool** editor right below the
**Prize pool** editor. It works exactly like prizes, but each slot is a
placement:

- Add N slots; **slot 1 -> 1st place, slot 2 -> 2nd, ... slot N -> Nth**. It's
  flexible - 3 places or 8 places, whatever the event needs (max 16).
- Each slot has a **title** (the badge name / header) and a **description**
  (the sub-header shown under the name on the profile hover card).
- Upload a **transparent PNG** per slot. It is normalized **in the browser on
  upload** (trim -> fit longest side to 460 -> center on 512x512 -> WebP), the
  same pipeline as the manual one below, so admin-uploaded badges come out
  uniform with the existing 8. No manual processing needed.
- On completion the badges **auto-assign**: each slot is snapshotted onto the
  finalist at that rank into `tournament_awarded_badges`, and the profile shelf
  shows it with a link to the event. Same guards as prizes: it won't auto-award
  onto an unresolved merit tie, and a re-run won't duplicate.

Data path for dynamic badges: `tournaments.badges` (live pool, editable) ->
`autoAwardBadgesOnComplete` -> `tournament_awarded_badges` (immutable snapshot)
-> `getEarnedTournamentBadges` -> `/api/auth/profile-badges` (merged with catalog
badges) -> the shelf. Backed by migration `015_tournament_badges.sql`
(`tournaments.badges` + `tournaments.badges_awarded_at` +
`tournament_awarded_badges`).

## Where everything lives

| Piece | Path |
| --- | --- |
| Badge art (served) | `public/badges/<id>.png` |
| Catalog (id -> name/desc/tier/image/link) | `src/lib/wallet/badge-catalog.ts` |
| DB table | `profile_badges` (migration `supabase/migrations/014_profile_badges.sql`) |
| DB read | `getEarnedBadges()` in `src/lib/wallet/db.ts` |
| API route | `src/app/api/auth/profile-badges/route.ts` |
| Shelf UI | `src/components/wallet/profile-award-badges.tsx` (chip) + `profile-shelf.tsx` (frame) |
| Grant/backfill script | `scripts/tournament/grant-initial-badges.ts` |

## Data model

```sql
create table profile_badges (
  wallet_address text not null,
  badge_id       text not null,        -- matches BADGES[].id and the PNG filename
  awarded_at     timestamptz not null default now(),
  primary key (wallet_address, badge_id)
);
-- RLS enabled, no policies. All access via the service-role key in route
-- handlers / scripts (which bypass RLS), matching every other table.
```

A badge is keyed by `wallet_address`, so a participant who never linked a wallet
has no profile to hang it on and is simply skipped. Grants are idempotent
(primary key + upsert), so re-running a backfill never duplicates.

## Image processing (do this for every new PNG)

Source PNGs vary: different amounts of transparent padding and different content
sizes (e.g. `og.png` originally had noticeably more whitespace than the rest).
We normalize so every badge reads at the **same visual size** with **equal, tiny
padding**, on a **1:1 canvas**.

Requirements for a source PNG:

- Transparent background (no matte / no solid color behind the art).
- Roughly square is ideal but not required; the trim + re-center handles it.
- Any resolution; we downscale to a 512px canvas.

The normalization (uses ImageMagick `magick`, installed via Homebrew):

```bash
# 1. Inspect the content bounding box (how much padding a source has):
magick beta_king.png -trim info:
#   -> "... 1254x1254 1018x1185+118+31 ..."  (content is 1018x1185 inside 1254)

# 2. Normalize ONE badge: trim transparent border, scale the trimmed content so
#    its LONGEST side = 460px, then center it on a 512x512 transparent canvas.
#    Result: uniform content height, ~26px of even padding, 1:1 aspect.
magick beta_king.png -trim +repage -resize 460x460 \
  -background none -gravity center -extent 512x512 -strip \
  public/badges/beta_king.png
```

Batch several at once (run from the repo root):

```bash
for f in beta_king beta_silver beta_bronze og; do
  magick "$f.png" -trim +repage -resize 460x460 \
    -background none -gravity center -extent 512x512 -strip \
    "public/badges/$f.png"
done
```

Why these numbers:

- `-trim +repage` removes the transparent border so a badge with extra
  whitespace (like `og`) ends up the same effective size as the tight ones.
- `-resize 460x460` fits the trimmed art inside 460x460 preserving aspect, so
  the longest side becomes 460. Because these emblems are taller than wide, they
  all end up ~460px tall = uniform on the shelf.
- `-extent 512x512 -gravity center` pads to a square 512 canvas, giving ~26px
  even transparent margin so nothing touches the edge.
- `-strip` drops metadata to keep files small.

Sanity check after processing (content should be ~x460 for each, padding equal):

```bash
for f in public/badges/*.png; do printf "%-30s " "$f"; magick "$f" -trim info:; done
```

The served file (512x512) is displayed at 72px in the shelf; 512 keeps it crisp
on retina. Delete the heavy source PNGs from the repo root after processing -
`public/badges/` is the source of truth.

## Onboarding a NEW static catalog badge

(For a normal tournament podium, use the admin **Badge pool** instead - see
above. This section is for participation / one-off badges baked into the app.)

1. **Art**: drop `some_badge.png` (transparent) in the repo root, normalize it
   with the command above into `public/badges/some_badge.png`.
2. **Catalog**: add an entry to `BADGES` in `src/lib/wallet/badge-catalog.ts`:

   ```ts
   {
     id: 'some_badge',                 // == filename, == stored badge_id
     name: 'Some Badge',
     description: 'One line of context shown on hover.',
     tier: 'gold',                     // gold | silver | bronze | special (border glow)
     image: '/badges/some_badge.png',
     link: '/tournaments/OP-XXXXX',    // optional: where clicking it goes
   }
   ```

   Array order = display order on the shelf (championship badges lead).
3. **Grant it** (see below).

## Assigning / granting

Grants are explicit rows in `profile_badges`. Two ways:

- **Scripted (preferred for tournament awards)**: extend
  `scripts/tournament/grant-initial-badges.ts`. It resolves tournaments by code,
  pulls participants + `final_rank`, resolves each to a wallet (falling back to
  `wallet_profiles` by X handle), and upserts. Run:

  ```bash
  npx tsx scripts/tournament/grant-initial-badges.ts          # dry run: prints the plan
  npx tsx scripts/tournament/grant-initial-badges.ts --apply  # writes to profile_badges
  ```

  It reads PROD creds (`TOURNAMENT_SUPABASE_*`) from `.env.local`, same as the
  other tournament scripts. Idempotent - safe to re-run (e.g. after a previously
  wallet-less player links a wallet).

- **One-off**: insert directly (wallet must be lowercase):

  ```sql
  insert into profile_badges (wallet_address, badge_id)
  values ('0xabc...', 'some_badge')
  on conflict do nothing;
  ```

### How the initial 8 were assigned

Computed from live tournament data, not hardcoded (placements verified against
`final_rank`):

| Badge | Rule | Recipients |
| --- | --- | --- |
| `beta_tester` | played "The first one" (`OP-UUZY4`) | 10 (2 wallet-less signups skipped) |
| `og` | played either of the first two events | 16 |
| `beta_king` / `beta_silver` / `beta_bronze` | 1st / 2nd / 3rd of "The first one" | `@ravelberger` / `@mrseshington` / `@pengpost` |
| `bonk_king` / `bonk_silver` / `bonk_bronze` | 1st / 2nd / 3rd of BONK Vol. 1 (`OP-8BESQ`) | `@0x1001` / `@anko_getrich` / `@ravelberger` |

## Display behavior

- The badges shelf always renders (skeleton while loading, a discreet "No badges
  yet" line when empty, one horizontal swipeable row when populated), so every
  profile modal is the same size and never scrolls vertically.
- Hover/tap shows a styled card with the name + description + "View event ->".
  There is deliberately no native `title` tooltip (it would double up).
- Reads soft-fail to `[]` if the table is missing, so profiles always render.
