# One Piece TCG Gallery - Copilot Master Prompt

> **NOTE (April 20, 2026):** The MVP is built. See [PROJECT.md](./PROJECT.md) for the current implementation, file structure, data pipeline, and R2 configuration. This document is preserved as the original product brief and creative direction. Treat it as the design compass; treat PROJECT.md as the source of truth for what actually exists in the codebase.

## Implementation Status (condensed)

- Brand: **CARD WALL** (was HOARD). Unified two-panel lockup: pixel mascot in a bordered light chip + inverted black wordmark, single rounded mark.
- Default theme: **light**. Seamless token-driven toggle (global transition on color-family properties).
- Next.js 15.5 + App Router + TypeScript + Tailwind v4 + Lenis + TanStack Virtual + Motion + Zustand + dnd-kit
- **1,661** unique cards (from 2,628 raw), 518 with alternate-art variants; 35 canonical sets (including PROMO + EXCLUSIVES buckets)
- 2,627 card images hosted on Cloudflare R2
- Virtualized card wall with viewport-aware zoom (1 to 12)
- Lightbox: radial-gradient + grain backdrop, top HUD (counter / pin / close), bottom info bar (name + meta + variant dots) flanked by prev/next arrows so they never collide with the fanned variants; full keyboard, wheel, and touch navigation
- 48px frosted-glass header with unified 30px pill controls (collection filter, search, set filter, zoom, theme) + persistent **Board** pill showing pin count; mobile hamburger opens a bottom filter sheet
- Pin / Board feature: users pin any card or specific variant from the tile or lightbox; right-side slide-over shows an art-first 2\u20133 col tile grid with full-tile drag-reorder (dnd-kit) and hover X to remove; anonymous `/api/track-pin` logs events
- Collection section sits on a lifted `--bg-surface` band with hairline borders for depth against the page `--bg`\n- Variant cards use a stacked-deck visual metaphor (two peek sheets tinted in the card's dominant color, gentle sway animation, fans out on hover)\n- Collections: one-piece (available); pokemon, magic, yu-gi-oh shown as `(coming soon)`\n- Data source: `coko7/vegapull-records` (full pack coverage, no prefix allow-list)\n- Themed focus ring (`:focus-visible` uses `--text-primary`), no browser-default blue\n- Repo pushed to `point-onefive/tcg_viewer` (private)

## Style rule

**No em dashes (U+2014) anywhere.** Code, comments, JSX text, UI copy, docs, data, commit messages. Use hyphens, commas, parentheses, or separate sentences.

---

You are helping me build a premium, minimal, aesthetic-first web app for viewing the **One Piece Trading Card Game** card library from the earliest release through the current release.

This is **not** a deck builder, not a marketplace, and not a price-first product in v1.
The core purpose is **beautiful browsing and collection viewing**.
The product should feel closer to a **luxury product-photography gallery** than a typical trading card database.

## Primary Goal

Create a fast, smooth, visually pleasing card archive where users can:

- browse a huge grid / wall of One Piece TCG cards
- scroll through the archive with a **buttery premium feel**
- click any card to enlarge it for viewing
- filter by set and basic metadata
- toggle between a **light product-shot theme** and a **dark product-shot theme**

The app should emphasize:

- elegance
- spacing
- card imagery
- motion polish
- premium UI restraint
- collectible gallery feel

## Product Direction

This should feel like:

- a museum archive
- a premium product catalog
- a modern art / design showcase
- a high-end e-commerce product grid

This should **not** feel like:

- a cluttered TCG search engine
- a spreadsheet of cards
- a gamer-heavy dashboard
- a statistics-first deck builder
- a busy marketplace with too much chrome

## Core Visual Theme

The dominant visual reference is **minimal product photography**.
Every card should feel like it is being displayed the way a premium consumer product would be displayed on a product page.

### Light Theme

The light theme should resemble a premium white product-shoot environment:

- soft white / warm-white / light gray background
- subtle gradients allowed but must remain extremely restrained
- cards should appear as if sitting in a light box or studio setting
- each card tile should have a **soft cast shadow** beneath it
- shadow should feel natural, not cartoonish
- generous whitespace
- premium editorial feel
- slightly diffused depth, not flat and sterile

### Dark Theme

The dark theme should resemble a premium black product-shoot environment:

- deep charcoal / soft black background, not pure lifeless black unless used sparingly
- cards should still read clearly and remain the hero
- shadows become subtle ambient depth / glow-like lift rather than harsh black-on-black shadow
- the dark theme should feel luxurious, cinematic, and clean
- still minimal, still product-photography inspired

### Theme Toggle

Include a theme toggle that switches between:

- **Studio Light**
- **Studio Dark**

This toggle should be elegant and subtle, not oversized.
Persist theme preference locally.

## Key UX Requirements

### 1. Massive Smooth Card Wall

The homepage should primarily be a huge visually pleasing grid / wall of cards.
This is the core of the product.

Requirements:

- support a very large number of cards
- maintain excellent performance
- use virtualization where necessary
- scrolling must feel premium and smooth
- cards should lazy load
- images should fade / resolve in gracefully
- placeholders should be tasteful and minimal

### 2. Card Presentation

Each card tile should:

- preserve the real trading card aspect ratio
- remain visually uniform and aligned
- have subtle hover polish
- have a product-shot style shadow / lift
- not be overframed with loud borders
- maintain crisp image rendering

Possible hover behaviors:

- very slight translateY lift
- slightly stronger shadow
- very subtle scale increase
- micro parallax is optional but only if extremely tasteful

Do **not** overdo animation.

### 3. Click to Enlarge

Clicking a card should open a minimal premium viewer.

Viewer requirements:

- large centered display of the card
- dimmed or softened backdrop
- maintain focus on image
- allow next / previous navigation
- support keyboard navigation
- support closing with escape / click outside
- card metadata can be visible but should stay secondary

The enlarged viewer should feel like a gallery lightbox, not a cluttered modal.

### 4. Filtering / Browsing

v1 filter controls should stay minimal and useful.
Include:

- set / expansion
- release ordering
- optional rarity
- optional card type
- optional color
- search by card code or name

Filters should appear as clean floating or sticky controls with minimal visual weight.

### 5. Chronological Archive Feel

The app should support chronological browsing from earliest release to current release.
Add tasteful set segmentation so users can understand the historical progression.

Possible design options:

- compact set header rows
- floating year / set markers
- subtle separators between eras
- sticky “current set section” indicator while scrolling

These must remain clean and understated.

## Suggested Tech Stack

Use these technologies unless a strong implementation reason suggests a better equivalent:

- **Next.js** (App Router)
- **React**
- **TypeScript**
- **Tailwind CSS**
- **TanStack Virtual** for large virtualized grids / lists
- **Motion** for animation and transitions
- **Lenis** for smooth scrolling
- **next/image** if appropriate for local / remote hosted images
- **Zustand** or minimal React state if lightweight state is needed

Optional:

- **GSAP** only if truly helpful for elite polish, but do not overcomplicate v1
- **shadcn/ui** only if used sparingly and customized to remain premium/minimal

## Performance Requirements

The app should be engineered for performance from the start.

Requirements:

- virtualize the card grid
- lazy load images
- avoid rendering too many DOM nodes at once
- use responsive image sizing
- prefetch intelligently only where helpful
- avoid unnecessary heavy effects
- animation must not hurt scroll performance
- dark and light themes must both stay fast

## Data / Content Model

Assume card data comes from a normalized dataset that I will prepare from my own ingestion jobs.
I may host images and data on my own infrastructure, including an R2 bucket.
Build the app so it can work with a local JSON dataset now and an API later.

Use a normalized card model like:

```ts
export type Card = {
  id: string
  code: string
  name: string
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder?: number
  cardType?: string
  rarity?: string
  colors?: string[]
  imageSmall: string
  imageLarge?: string
  sourceUrl?: string
}
```

Also support grouped set metadata such as:

```ts
export type CardSet = {
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder: number
}
```

## Image Hosting / Pipeline Assumptions

Assume:

- I will acquire and normalize the card images separately
- images may live in Cloudflare R2 or similar object storage
- metadata may live in JSON files initially
- later this can move to an API / database

Build the front-end to be source-agnostic as long as image URLs and metadata are available.

## Legal / Source Separation

Do not hardcode scraping logic into the front-end.
Do not tightly couple the UI to any third-party website structure.
The front-end should assume I already have the image URLs and metadata.

Any crawler / ingestion tooling should be treated as a separate internal pipeline.

## MVP Scope

Build the MVP with the following features:

1. full-screen gallery homepage
2. premium light / dark studio theme toggle
3. virtualized card wall
4. lazy loaded card images
5. click-to-enlarge lightbox viewer
6. minimal filters
7. chronological set grouping
8. responsive design for desktop first, mobile supported second
9. local mock dataset support
10. elegant loading states and empty states

## Explicit Non-Goals for v1

Do **not** implement these in v1 unless structure is lightly prepared for future expansion:

- marketplace listings
- live price charts
- account systems
- wishlists
- social features
- collection ownership tracking
- checkout flows
- card trading
- deckbuilding workflows

However, organize the codebase so those features could be layered in later.

## Layout Direction

The homepage should feel mostly immersive.
A strong direction would be:

- top-left: subtle wordmark / brand area
- top-right: small controls (theme toggle, filters, search)
- the rest: the card wall
- very minimal header chrome
- avoid boxed dashboard layout
- allow the gallery to dominate the viewport

The UI should breathe.
Whitespace is a feature.

## Card Tile Aesthetic Direction

Each card tile should feel like a premium photographed object floating slightly above the background.

In light mode:

- soft drop shadow below card
- gentle sense of lift
- maybe faint edge light or soft reflected ambient highlight

In dark mode:

- subtle ambient glow / very restrained shadow separation
- enough depth to prevent cards from collapsing into the background

Do not add fake thick frames or gimmicky treatments.
The actual card art should remain the hero.

## Motion Direction

Animation philosophy:

- smooth
- elegant
- restrained
- tactile
- premium
- never flashy for its own sake

Use animation for:

- image fade-in
- hover transitions
- lightbox open/close
- filter panel transitions
- theme transitions if tasteful

Avoid:

- loud bouncy animations
- exaggerated springiness
- unnecessary 3D spins
- gaming-style flashy effects

## Responsive Behavior

Desktop is the primary focus.
The desktop experience should feel premium and expansive.

On mobile:

- maintain clean browsing
- keep filters compact
- keep lightbox usable
- preserve smoothness
- simplify where needed

Do not compromise desktop elegance just to over-optimize mobile at the MVP stage.

## Accessibility / Usability

Even though the product is visually driven, keep it usable:

- keyboard navigation in viewer
- visible focus states
- sufficient contrast in both themes
- alt text support based on card name/code
- escape to close lightbox
- accessible buttons and controls

## Suggested Project Structure

Use a clean scalable structure such as:

```txt
app/
  page.tsx
  layout.tsx
components/
  gallery/
    card-grid.tsx
    card-tile.tsx
    set-section.tsx
    lightbox-viewer.tsx
    filters.tsx
    search.tsx
    theme-toggle.tsx
lib/
  data/
  utils/
  types/
  theme/
public/
  data/
```

## Sample Implementation Direction

Please implement:

- a reusable `CardTile` component
- a virtualized gallery grid
- a minimal `LightboxViewer`
- a theme system for Studio Light / Studio Dark
- a mock dataset loader from local JSON
- filter/search support using derived state
- clean typography and spacing

## Design Language

Typography should be:

- modern
- clean
- restrained
- premium
- slightly editorial

Avoid overly playful fonts.
Avoid gamer / comic / anime-themed UI fonts.
Use a clean system or premium sans style.

## Color Palette Direction

### Studio Light

- background: warm white / soft gray white
- surfaces: slightly elevated white / off-white
- text: charcoal / soft black
- shadows: soft gray with low opacity

### Studio Dark

- background: charcoal / near-black
- surfaces: dark gray / graphite
- text: near-white / soft white
- separation: very subtle glow or ambient contrast

Keep the palette very limited.
The card art itself provides the color.

## Search / Filter UX

Keep controls sleek.
Possible direction:

- compact floating search field
- pill filters or dropdowns
- tiny elegant reset button
- optional collapsible filter panel

The controls should support function without stealing attention from the gallery.

## Empty / Loading States

Design these well.

Loading state should feel premium:

- soft skeletons or blurred placeholders
- not overly busy
- aligned with the studio-product aesthetic

Empty state should be simple and tasteful.

## Code Quality Expectations

Generate production-quality code.

Requirements:

- strongly typed TypeScript
- clean reusable components
- separation of concerns
- comments only when useful
- avoid unnecessary abstractions
- avoid overengineering
- optimize for clarity and performance

## What I Care About Most

In priority order:

1. aesthetic quality
2. smooth browsing feel
3. card image presentation
4. minimal premium UI
5. scalability to large card counts
6. clear structure for future expansion

## Important Constraint

Do not let the UI become generic.
This project should feel distinctive because of the **product-photography-inspired presentation of the cards**.
The cards should feel like collectible objects in a gallery.

## Future Expansion Hooks

Structure the codebase so I can later add:

- user accounts
- wishlists
- saved collections
- market pricing
- card detail pages
- release timelines
- marketplace / sales modules

But do not implement those deeply yet.

## Deliverables

Please generate:

1. a polished Next.js app structure
2. the main gallery page
3. mock data support
4. theme toggle between Studio Light and Studio Dark
5. premium card tile design with product-shot shadow treatment
6. lightbox viewer for enlarged cards
7. search and minimal filtering
8. scalable architecture and clear component organization

## Final Creative Direction Reminder

This should look like:

- premium product photography
- minimalist collectible archive
- elegant card museum
- smooth modern design system

This should not look like:

- cluttered TCG dashboard
- generic admin panel
- noisy anime fan site
- overbuilt trading platform

Build the MVP to feel beautiful first.
