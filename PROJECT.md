# TCG Viewer — Project Documentation

> Last updated: April 20, 2026 (R2 pipeline complete — real card images live)

---

## What This Is

A premium card gallery web app for One Piece TCG (and future TCG collections). Built for a "luxury product photography" aesthetic — buttery scroll, Studio Dark/Light themes, virtualized card wall, lightbox viewer, and a cursor spotlight (ChromaGrid) effect.

---

## Tech Stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15.5 (App Router, Turbopack) | Fast builds, RSC, Vercel-native |
| Language | TypeScript | Type safety |
| Styling | Tailwind v4 (`@tailwindcss/postcss`) | Utility-first, v4 CSS-first config |
| Scroll | Lenis 1.2.3 | Smooth inertia scroll |
| Virtualization | TanStack Virtual (`useWindowVirtualizer`) | Window-native virtual rows, no scroll container |
| Animation | Motion (Framer) | Hover animations only |
| GSAP | gsap 3.x | ChromaGrid cursor tracking (quickSetter) |
| State | Zustand + persist | zoom, theme, filters, lightbox |
| Fonts | Space Grotesk (`--font-display`), Inter (`--font-body`) | |
| Images | Cloudflare R2 | Self-hosted, egress-free CDN |
| Deployment | Vercel | |

---

## Project Structure

```
tcg_viewer/
├── src/
│   ├── app/
│   │   ├── page.tsx              # Root page — assembles all components
│   │   ├── layout.tsx            # HTML shell, font variables, ThemeProvider, SmoothScroll
│   │   └── globals.css           # CSS vars, theme tokens, ChromaGrid, zoom slider styles
│   ├── components/
│   │   ├── gallery/
│   │   │   ├── card-grid.tsx     # Virtualized card wall (useWindowVirtualizer)
│   │   │   ├── card-tile.tsx     # Individual card — hover effects, spotlight
│   │   │   ├── chroma-overlay.tsx # Full-screen cursor spotlight overlay (GSAP)
│   │   │   ├── header.tsx        # Search, set filter, zoom slider, theme toggle
│   │   │   ├── lightbox-viewer.tsx # Full-screen lightbox, keyboard nav
│   │   │   └── theme-toggle.tsx  # Dark/light theme button
│   │   ├── smooth-scroll.tsx     # Lenis instance + RAF loop
│   │   └── theme-provider.tsx    # Sets data-theme on <html>, mounted guard
│   └── lib/
│       ├── types.ts              # Card, CardSet types
│       ├── store.ts              # Zustand store (zoom, theme, filters, lightbox)
│       ├── data.ts               # getCards() / getSets() — uses real data if present, else mock
│       ├── cards-generated.json  # GENERATED + GITIGNORED — run npm run cards:all
│       └── sets-generated.json   # GENERATED + GITIGNORED — run npm run cards:all
├── scripts/
│   ├── fetch-card-data.mjs       # Pulls card JSONs from vegapull-records (GitHub)
│   ├── generate-card-data.mjs    # Maps raw JSON → Card type, writes cards-generated.json
│   ├── download-images.mjs       # Downloads card images (zip or CDN method)
│   └── upload-to-r2.mjs          # Uploads public/cards/ to Cloudflare R2 (concurrency=5, retry)
├── data/                         # GITIGNORED — raw JSON + upload progress marker
│   ├── cards.json                # Raw vegapull output
│   ├── packs.json                # Pack metadata
│   ├── english-images.zip        # 761MB image archive (delete after extracting)
│   └── uploaded.json             # Upload resume marker — tracks completed files
├── public/
│   └── cards/                    # GITIGNORED — 2627 local PNGs (source of truth before R2)
├── next.config.js                # Image domain allowlist (includes R2 hostname)
├── .env.local                    # GITIGNORED — secrets (see Secrets section below)
├── .gitignore
└── PROJECT.md                    # This file
```

---

## Zustand Store (`src/lib/store.ts`)

| Key | Type | Default | Persisted |
|---|---|---|---|
| `zoom` | `number` (1–12) | `5` | ✅ |
| `theme` | `'dark' \| 'light'` | `'dark'` | ✅ |
| `searchQuery` | `string` | `''` | ❌ |
| `activeSet` | `string \| null` | `null` | ❌ |
| `activeRarity` | `string \| null` | `null` | ❌ |
| `activeColor` | `string \| null` | `null` | ❌ |
| `lightboxCardId` | `string \| null` | `null` | ❌ |

---

## Card Data Pipeline

### Source

[`vegapull-records`](https://github.com/coko7/vegapull-records) — community dataset scraped from the official Bandai site (`en.onepiece-cardgame.com`). English dataset updated April 27, 2025.

**Available packs:** OP-01 through OP-10, ST-01 through ST-21, EB-01/02, PRB-01 → **2,406 real cards**

**Per-card fields:** `id`, `name`, `rarity`, `category`, `colors[]`, `cost`, `power`, `counter`, `attributes[]`, `types[]`, `effect`, `trigger`, `img_full_url`

Image URL pattern on Bandai CDN: `https://en.onepiece-cardgame.com/images/cardlist/card/{ID}.png?{cache_buster}`

### NPM Scripts

```bash
npm run cards:fetch      # Pull all pack JSONs → data/cards.json (200ms/request, ~30s total)
npm run cards:generate   # Map to Card type → src/lib/cards-generated.json (R2 URLs baked in)
npm run cards:all        # fetch + generate in sequence

npm run cards:images     # Download pre-built 761MB zip from GitHub release (recommended)
npm run cards:images:cdn # Download one-by-one from Bandai CDN at 2 req/s (slow ~40min)

npm run r2:upload        # Upload public/cards/ → R2 (concurrency=5, retry, resumable)
```

### Full One-Time Setup Flow

```bash
# 1. Fetch metadata
npm run cards:all

# 2. Download images (761MB zip, fastest)
npm run cards:images
# → public/cards/{CARD_ID}.png (2627 files including alternate arts)

# 3. Upload to R2 (resumable — re-run if it fails, skips already-done files)
npm run r2:upload

# 4. Regenerate with R2 URLs (already done — IMAGE_BASE is set in generate-card-data.mjs)
npm run cards:generate
```

### Image Variants in the Zip

The zip contains both base cards and alternate arts:
- `OP01-001.png` — base card (what the gallery uses)
- `OP01-001_p1.png`, `_p2.png` — parallel/alternate art prints
- `OP01-001_r1.png` — rainbow/special treatment

All variants are uploaded to R2. The gallery currently links to base IDs only (`{ID}.png`).

---

## Cloudflare R2 Bucket

| Setting | Value |
|---|---|
| Bucket name | `tcg-viewer` |
| Account ID | `ea61e9c39953b4007182b6e35fdab347` |
| S3 API endpoint | `https://ea61e9c39953b4007182b6e35fdab347.r2.cloudflarestorage.com/tcg-viewer` |
| Public development URL | `https://pub-6d5072ccd26a467db70791436c203abb.r2.dev` |
| Image path format | `https://pub-6d5072ccd26a467db70791436c203abb.r2.dev/cards/{CARD_ID}.png` |
| Location | Eastern North America (ENAM) |
| Status | ✅ Live — 2,627 images uploaded |

### Secrets (stored in `.env.local` — never committed)

```
CLOUDFLARE_API_TOKEN=<your-token>
CLOUDFLARE_ACCOUNT_ID=ea61e9c39953b4007182b6e35fdab347
R2_BUCKET=tcg-viewer
R2_PUBLIC_URL=https://pub-6d5072ccd26a467db70791436c203abb.r2.dev
```

To recreate the API token: [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → Create Token → Custom Token → **Account / Cloudflare R2 Storage / Edit**.

### Upload Script Notes

- `scripts/upload-to-r2.mjs` uses the Cloudflare REST API directly (no wrangler needed)
- Concurrency=5 to avoid 429 rate limits
- Exponential backoff: 2s → 4s → 8s → 16s on 429/502/503
- Resumable: progress tracked in `data/uploaded.json` — re-run safely after failures
- Images stored under `cards/` prefix in the bucket

---

## Key Implementation Decisions

### Virtualization: `useWindowVirtualizer` not `useVirtualizer`

Using window-native scroll (not a scroll container `div`) so Lenis can own the scroll event. `useVirtualizer` with a ref container broke Lenis. `useWindowVirtualizer` measures against `window.scrollY` directly.

### Hydration guard in `card-grid.tsx`

`window.innerWidth` is unavailable during SSR. Added a `mounted` state — card grid renders `null` server-side and mounts after first client render. Eliminates React hydration mismatch errors.

### Zoom system

Zoom level 1–12 (stored in Zustand, persisted). `zoomToColumns(zoom, windowWidth, windowHeight)` maps zoom to a column count, with a viewport-height-aware floor so a card always fits fully in the viewport vertically (no half-cut cards at max zoom-out).

### ChromaGrid cursor spotlight

A `position: fixed; z-index: 10` div with a `radial-gradient` background that has a transparent hole at `--x, --y` (cursor position) and fades to near-black outside the radius. GSAP `quickSetter` drives `--x`/`--y` CSS variables with `power3.out` easing for a lagging spotlight feel.

**Why not `backdrop-filter + mask-image`:** Tried this first — completely unreliable when Lenis and Motion create transform stacking contexts that break backdrop sampling. Replaced with solid radial-gradient overlay; works everywhere.

**Mobile:** No `pointermove` on touch → overlay stays in `is-idle` state (45% dim). Acceptable UX for now.

### Scroll performance

Removed all scroll-triggered entrance animations from `CardTile`. Only `whileHover` animations remain (Motion). `overscan = 12` rows keeps above/below rows pre-rendered.

---

## Themes

Two themes via `data-theme` attribute on `<html>`:

| Token | Dark | Light |
|---|---|---|
| `--bg` | `#0a0a0a` | `#f5f5f5` |
| `--surface` | `#141414` | `#ffffff` |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(0,0,0,0.08)` |
| `--text` | `#e8e8e8` | `#1a1a1a` |
| `--text-muted` | `rgba(255,255,255,0.4)` | `rgba(0,0,0,0.4)` |

---

## Adding Future TCG Collections

The data layer is collection-agnostic. To add e.g. Pokémon TCG:

1. Add a new fetcher script in `scripts/` that outputs `data/pokemon-cards.json` in the same shape as One Piece
2. Add a `collection` field to the `Card` type
3. Add a collection switcher to the header (store `activeCollection` in Zustand)
4. R2 structure: use prefixes — `cards/op/`, `cards/pokemon/`, etc.
5. Images upload to separate R2 prefix per game

---

## Dev Commands

```bash
npm run dev          # Start dev server (localhost:3000, Turbopack)
npm run build        # Production build
npm run lint         # ESLint
npx tsc --noEmit     # Type check
```

---

## What's Left / Future Work

- [ ] Add alternate art variant toggle in card tile (show `_p1`, `_p2` versions)
- [ ] Add card detail metadata panel in lightbox (cost, power, effect text, types)
- [ ] Add custom domain to R2 bucket for production (replace `pub-xxx.r2.dev` URL)
- [ ] Deploy to Vercel (connect GitHub repo, add env vars)
- [ ] New TCG collections — see "Adding Future TCG Collections" section above
- [ ] Mobile: ChromaGrid follows touch position (currently stays in idle dim on mobile)
- [ ] OP-11 and beyond — re-run `npm run cards:all` + `npm run r2:upload` when new sets release
