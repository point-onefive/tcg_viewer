# CARD WALL - Project Documentation

> Last updated: April 21, 2026 (4 collections live + deployed to thecardwall.com)

---

## What This Is

A premium card gallery web app for One Piece TCG (and future TCG collections). Built for a "luxury product photography" aesthetic: buttery scroll, light/dark themes, virtualized card wall, a fan-out lightbox for alternate arts, and a personal pin-board for curating favorites.

**Brand:** CARD WALL - unified two-panel lockup (pixel mascot chip + inverted black wordmark).

**Live repo:** [point-onefive/tcg_viewer](https://github.com/point-onefive/tcg_viewer) (private)

---

## Current State

- **Deployed:** https://thecardwall.com (Vercel, domain registered through Vercel, auto-DNS)
- **4 live collections:** One Piece, Gundam, Dragon Ball Super, Digimon
  - One Piece: 1,661 cards / 35 sets / 2,627 images
  - Gundam: 656 cards / 13 sets / ~800 images
  - Dragon Ball Super: 1,693 cards / 28 sets / 3,391 images
  - Digimon: 4,071 cards / 61 sets / 7,132 images
- **~14k images live on Cloudflare R2** (`https://pub-6d5072ccd26a467db70791436c203abb.r2.dev/cards/{collection}/`)
- **Default theme: light.** Themed focus ring (no browser-default blue).
- **Collection header** sits on a lifted `--bg-surface` band (hairline borders + 1px drop) for depth against the page `--bg`.
- **Variant-card discovery:** cards with alternates render with a 2-sheet stacked-deck visual + animated sway + dominant-color glow. Fans out on hover.
- **Lightbox:** radial-gradient + grain backdrop, top HUD (counter left, pin + close right), bottom info bar with card name/set/rarity/type/variant dots flanked by prev/next arrows (arrows live in the info bar so they never collide with the fanned variants).
- **Pin / Board:** users pin any card (or specific variant). Navbar shows a "Board" pill with count; clicking opens a right-side slide-over. Board is an art-first tile grid (2-col, 3-col on wider panels, 5:7 aspect) with full-tile drag-reorder via dnd-kit and hover X to remove. Anonymous pin events POST to `/api/track-pin` for telemetry.
- **Header:** 48px frosted backdrop-blur bar, unified pill controls (collection, search, set filter, zoom slider, theme toggle, Board pill). All controls share the 30px height + 6px corner-radius language of the logo mark. Strong vertical separator between logo and controls.
- **Mobile:** hamburger reveals a bottom filter sheet (search, set, zoom, theme). Logo + Board pill stay visible in the top bar.
- **Collections:** one-piece, gundam, dbs, digimon (all active).

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) | Fast builds, RSC, Vercel-native |
| Language | TypeScript | Type safety |
| Styling | Tailwind v4 (`@tailwindcss/postcss`) + hand-written CSS vars | Utility-first, v4 CSS-first config |
| Scroll | Lenis 1.2.3 | Smooth inertia scroll |
| Virtualization | TanStack Virtual (`useWindowVirtualizer`) | Window-native virtual rows, no scroll container |
| Animation | Motion (Framer) | Lightbox spring, hover polish, board tile layout reorder |
| DnD | dnd-kit (core + sortable) | Board tile drag-reorder (rectSortingStrategy) |
| State | Zustand + persist | zoom, theme, filters, lightbox, pins |
| Fonts | Space Grotesk (`--font-display`), Inter (`--font-body`) | |
| Images | Cloudflare R2 | Self-hosted, egress-free CDN |
| Deployment | Vercel (thecardwall.com) | auto-deploy on push to `main` via GitHub integration |

---

## Project Structure

```
tcg_viewer/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Root page, assembles Header + CardGrid + LightboxViewer
│   │   ├── layout.tsx            # HTML shell, font vars, ThemeProvider, SmoothScroll
│   │   └── globals.css           # CSS vars, theme tokens, card-tile, stacked-deck,
│   │                             #   lightbox, zoom slider
│   ├── app/api/
│   │   └── track-pin/route.ts    # Anonymous POST telemetry for pin events
│   ├── components/
│   │   ├── gallery/
│   │   │   ├── card-grid.tsx     # Virtualized wall, GAP=14, HEADER_H=48, viewport-aware zoom
│   │   │   ├── card-tile.tsx     # Card tile, stacked-deck hint, pin button on hover
│   │   │   ├── header.tsx        # 48px frosted bar, unified 30px pill controls, mobile sheet, Board pill
│   │   │   ├── lightbox-viewer.tsx # HUD overlay, arrows in info bar, per-variant pin button
│   │   │   ├── board-panel.tsx   # Right-side slide-over: art-first tile grid, dnd-kit drag-reorder
│   │   │   └── theme-toggle.tsx  # Dark/light theme button
│   │   ├── smooth-scroll.tsx     # Lenis instance + RAF loop
│   │   └── theme-provider.tsx    # Sets data-theme on <html>, mounted guard
│   └── lib/
│       ├── types.ts              # Card (with variants[], metadata), CardSet
│       ├── store.ts              # Zustand: zoom, theme, filters, lightbox
│       ├── data.ts               # getCards() / getSets(), real data with mock fallback
│       ├── cards-generated.json  # GENERATED + GITIGNORED - 1,661 unique base cards
│       └── sets-generated.json   # GENERATED + GITIGNORED - 35 sets
├── scripts/
│   ├── fetch-card-data.mjs       # Pulls card JSONs from vegapull-records
│   ├── generate-card-data.mjs    # Raw -> Card type, canonical set names, collapses variants
│   ├── download-images.mjs       # Downloads card images (zip or CDN)
│   └── upload-to-r2.mjs          # Uploads public/cards/ to R2 (concurrency=5, retry, resume)
├── data/                         # GITIGNORED
│   ├── cards.json
│   ├── packs.json
│   ├── english-images.zip        # 761MB image archive
│   └── uploaded.json             # R2 upload progress marker
├── public/
│   └── cards/                    # GITIGNORED - 2,627 local PNGs
├── next.config.js                # Image domain allowlist (R2 hostname)
├── .env.local                    # GITIGNORED - secrets
├── .gitignore
└── PROJECT.md                    # This file
```

---

## Zustand Store (`src/lib/store.ts`)

| Key | Type | Default | Persisted |
|---|---|---|---|
| `zoom` | `number` (1 to 12) | `5` | yes |
| `theme` | `'dark' \| 'light'` | `'dark'` | yes |
| `searchQuery` | `string` | `''` | no |
| `activeSet` | `string \| null` | `null` | no |
| `activeRarity` | `string \| null` | `null` | no |
| `activeColor` | `string \| null` | `null` | no |
| `lightboxCardId` | `string \| null` | `null` | no |
| `pinned` | `Pin[]` (`{cardId, variantId?}`) | `[]` | yes |
| `boardOpen` | `boolean` | `false` | no |

---

## Card Data Pipeline

### Source

[`vegapull-records`](https://github.com/coko7/vegapull-records), community dataset scraped from `en.onepiece-cardgame.com`. English dataset updated April 27, 2025.

### Normalization

The pipeline collapses alternate-art printings into a single canonical card:

- Raw dataset: **2,628 card entries** (includes `_p1`, `_p2`, `_r1` variant IDs)
- After canonicalization: **1,661 unique base cards**, **518 of which have `variants[]`**
- Each variant stores its own `id`, `imageUrl`, `rarity`, and a human label (`Parallel`, `Alt Art`, `Manga`, etc.)
- Set names are hand-mapped to canonical titles (e.g. `Starter - Straw Hat Crew` instead of raw pack names)

### Card type (`src/lib/types.ts`)

```ts
type Variant = { id: string; imageUrl: string; rarity?: string; label?: string }
type Card = {
  id: string            // base card id, e.g. OP01-001
  code: string
  name: string
  setCode: string
  setName: string       // canonical, not raw pack name
  releaseDate?: string
  releaseOrder?: number
  rarity?: string
  category?: string     // LEADER / CHARACTER / EVENT / STAGE
  colors?: string[]
  cost?: number
  power?: number
  counter?: number
  attributes?: string[]
  types?: string[]
  effect?: string
  trigger?: string
  imageUrl: string      // R2 URL for base art
  primaryColor?: string // dominant color hex, drives UI tint (stack, glow)
  variants?: Variant[]  // alternate arts if any
}
```

### NPM Scripts

```bash
npm run cards:fetch      # Pull pack JSONs -> data/cards.json
npm run cards:generate   # Normalize -> src/lib/cards-generated.json (R2 URLs baked in)
npm run cards:all        # fetch + generate

npm run cards:images     # Download pre-built 761MB zip from GitHub release (fastest)
npm run cards:images:cdn # Download one-by-one from Bandai CDN at 2 req/s

npm run r2:upload        # Upload public/cards/ -> R2 (concurrency=5, retry, resumable)
```

### Full One-Time Setup Flow

```bash
npm run cards:all        # 1. Metadata
npm run cards:images     # 2. Images (761MB zip)
npm run r2:upload        # 3. Upload to R2 (resumable)
npm run cards:generate   # 4. Regenerate with R2 URLs baked in
```

---

## Cloudflare R2 Bucket

| Setting | Value |
|---|---|
| Bucket name | `tcg-viewer` |
| Account ID | `ea61e9c39953b4007182b6e35fdab347` |
| S3 API endpoint | `https://ea61e9c39953b4007182b6e35fdab347.r2.cloudflarestorage.com/tcg-viewer` |
| Public dev URL | `https://pub-6d5072ccd26a467db70791436c203abb.r2.dev` |
| Image path | `https://pub-6d5072ccd26a467db70791436c203abb.r2.dev/cards/{CARD_ID}.png` |
| Status | Live, 2,627 images uploaded |

Secrets live in `.env.local` (never committed):

```
CLOUDFLARE_API_TOKEN=<token>
CLOUDFLARE_ACCOUNT_ID=ea61e9c39953b4007182b6e35fdab347
R2_BUCKET=tcg-viewer
R2_PUBLIC_URL=https://pub-6d5072ccd26a467db70791436c203abb.r2.dev
```

Upload script uses the Cloudflare REST API directly. Concurrency=5, exponential backoff on 429/502/503, resumable via `data/uploaded.json`.

---

## Key Implementation Decisions

### Virtualization: `useWindowVirtualizer`

Using window-native scroll (not a scroll container) so Lenis owns the scroll event. `scrollMargin: 48` accounts for the fixed header.

### Hydration guard

`window.innerWidth` is unavailable during SSR. `card-grid.tsx` renders `null` server-side and mounts after first client render.

### Zoom system

Zoom 1 to 12 (persisted). `zoomToColumns(zoom, windowWidth, windowHeight)` with a viewport-height-aware floor so a card always fits fully vertically (no half-cut cards at max zoom-out).

### Variant indicator: stacked-deck metaphor

Cards with `variants[]` render two peek sheets (`card-tile__stack--1` and `--2`) behind the main tile:

- Vivid card-color paper (85%/55% color-mix gradient) with color-tinted inner borders and colored box-shadow glow
- Gentle 3.4s sway animation drifting between two offset/rotation positions
- Main tile has a pulsing drop-shadow in the dominant color (12px to 22px)
- On hover, animation halts and the stack fans out (18px / 9 deg) with intensified glow

Chosen after iterating through rarity-based glows, breathing outlines, and `+N` badges, all of which conflicted with the cards' own inner white borders.

### Header

48px fixed frosted bar (`backdrop-filter: blur(18px) saturate(140%)` over `bg` at 78% opacity) with a 1px bottom border. Inner container matches the grid: `max-w-[1800px]` + `px-4`. Controls grouped into matching pills separated by a vertical divider.

### Grid GAP

`GAP = 14` px between cards (previously 6, felt cramped at max zoom).

### Scroll performance

No scroll-triggered entrance animations. Only hover on tiles. `overscan = 12` rows pre-rendered above/below.

---

## Themes

Two themes via `data-theme` attribute on `<html>`:

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0a0a0a` | `#f5f5f5` |
| `--bg-surface` | `#141414` | `#ffffff` |
| `--border-subtle` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` |
| `--text-primary` | `#e8e8e8` | `#1a1a1a` |
| `--text-muted` | `rgba(255,255,255,0.4)` | `rgba(0,0,0,0.4)` |

---

## Style Rules

- **No em dashes (U+2014)** anywhere in the codebase: code, comments, JSX text, UI copy, data files, docs, commit messages. Use hyphens, commas, parentheses, or separate sentences.

---

## Adding Future TCG Collections

The data layer is collection-agnostic. To add Pokemon TCG, for example:

1. New fetcher in `scripts/` outputting `data/pokemon-cards.json` in the same shape
2. Add `collection` field to the `Card` type
3. Collection switcher in the header (store `activeCollection` in Zustand)
4. R2 prefixes: `cards/op/`, `cards/pokemon/`, etc.

---

## Dev Commands

```bash
npm run dev          # Dev server (localhost:3001, Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npx tsc --noEmit     # Type check
```

---

## What's Left / Future Work

- [x] Deploy to Vercel (live at https://thecardwall.com)
- [x] Add Gundam collection
- [x] Add Dragon Ball Super collection
- [x] Add Digimon collection
- [ ] Custom domain for R2 bucket (replace `pub-xxx.r2.dev` URL with e.g. `cdn.thecardwall.com`)
- [ ] Persist `track-pin` telemetry to a real store (currently logs only)
- [ ] Share / export board (image, link)
- [ ] Re-ingest when new sets release (per-collection `npm run {coll}:all` + `npm run {coll}:r2`)
