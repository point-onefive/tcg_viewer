/**
 * Per-collection filter facet config.
 *
 * Each TCG ships its own bundle with its own card-type, rarity, and
 * colour vocabulary — Pokémon's "Rare Holo VMAX" has nothing in common
 * with One Piece's "SR", and Digimon's seven colours overlap only
 * partially with the One Piece six-colour wheel.
 *
 * Rather than special-case each TCG inside the header component, we
 * declare the curated facet options here and the header iterates the
 * active collection's config to render generic popovers + chips.
 *
 * Curation rules:
 *   - Card type: every distinct value in the bundle (small lists,
 *     under 5).
 *   - Rarity: every rarity for small TCGs (≤10), curated top-N for
 *     Pokémon (25+ distinct rarities; we surface the ones that
 *     actually have meaningful card counts so the popover doesn't
 *     turn into an unreadable scroll).
 *   - Colors: the canonical colour wheel for the TCG. Swatches drawn
 *     from card-tile.tsx::COLOR_MAP so the chip beside each option in
 *     the popover matches the colour the gallery tile wears.
 */

import type { Collection } from './store'

export type FacetOption = {
  value: string
  label: string
  swatch?: string
}

export type CollectionFacets = {
  cardTypes: ReadonlyArray<FacetOption>
  rarities: ReadonlyArray<FacetOption>
  colors: ReadonlyArray<FacetOption>
}

// Swatch palette shared with card-tile.tsx::COLOR_MAP. Kept in this
// module (not imported from card-tile) so the facet config has no
// inverse dependency on a render concern.
const COLOR_SWATCHES: Record<string, string> = {
  Red:       '#ef4444',
  Blue:      '#3b82f6',
  Green:     '#22c55e',
  Purple:    '#a855f7',
  Black:     '#9ca3af',
  Yellow:    '#eab308',
  White:     '#f3f4f6',
  Grass:     '#78c850',
  Fire:      '#f97316',
  Water:     '#38bdf8',
  Lightning: '#facc15',
  Psychic:   '#c084fc',
  Fighting:  '#b45309',
  Darkness:  '#1f2937',
  Metal:     '#94a3b8',
  Fairy:     '#f472b6',
  Dragon:    '#7c3aed',
  Colorless: '#e5e7eb',
}

const colorOpt = (name: string): FacetOption => ({
  value: name,
  label: name,
  swatch: COLOR_SWATCHES[name],
})

const ONE_PIECE: CollectionFacets = {
  cardTypes: [
    { value: 'LEADER',    label: 'Leader' },
    { value: 'CHARACTER', label: 'Character' },
    { value: 'EVENT',     label: 'Event' },
    { value: 'STAGE',     label: 'Stage' },
  ],
  rarities: [
    { value: 'L',   label: 'L · Leader' },
    { value: 'SEC', label: 'SEC · Secret Rare' },
    { value: 'SR',  label: 'SR · Super Rare' },
    { value: 'R',   label: 'R · Rare' },
    { value: 'UC',  label: 'UC · Uncommon' },
    { value: 'C',   label: 'C · Common' },
    { value: 'P',   label: 'P · Promo' },
  ],
  colors: ['Red', 'Green', 'Blue', 'Purple', 'Black', 'Yellow'].map(colorOpt),
}

const POKEMON: CollectionFacets = {
  cardTypes: [
    { value: 'Pokémon', label: 'Pokémon' },
    { value: 'Trainer', label: 'Trainer' },
    { value: 'Energy',  label: 'Energy' },
  ],
  // Curated subset · Pokémon ships 25+ rarity strings. We surface the
  // ones that map to meaningful card-count buckets (≥150 cards) plus
  // the modern "premium" tiers collectors search for. Niche values
  // (Rare Holo LV.X, Rare BREAK, etc.) are reachable via the search
  // box rather than crowding the popover.
  rarities: [
    { value: 'Common',                    label: 'Common' },
    { value: 'Uncommon',                  label: 'Uncommon' },
    { value: 'Rare',                      label: 'Rare' },
    { value: 'Rare Holo',                 label: 'Rare Holo' },
    { value: 'Promo',                     label: 'Promo' },
    { value: 'Rare Ultra',                label: 'Ultra Rare' },
    { value: 'Illustration Rare',         label: 'Illustration Rare' },
    { value: 'Rare Secret',               label: 'Secret Rare' },
    { value: 'Rare Rainbow',              label: 'Rainbow Rare' },
    { value: 'Special Illustration Rare', label: 'Special Illustration' },
    { value: 'Hyper Rare',                label: 'Hyper Rare' },
  ],
  colors: [
    'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
    'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
  ].map(colorOpt),
}

const DIGIMON: CollectionFacets = {
  cardTypes: [
    { value: 'Digimon',  label: 'Digimon' },
    { value: 'Tamer',    label: 'Tamer' },
    { value: 'Option',   label: 'Option' },
    { value: 'Digi-Egg', label: 'Digi-Egg' },
  ],
  rarities: [
    { value: 'SEC', label: 'SEC · Secret Rare' },
    { value: 'SR',  label: 'SR · Super Rare' },
    { value: 'R',   label: 'R · Rare' },
    { value: 'U',   label: 'U · Uncommon' },
    { value: 'C',   label: 'C · Common' },
    { value: 'P',   label: 'P · Promo' },
    { value: 'UR',  label: 'UR · Ultra Rare' },
  ],
  colors: ['Red', 'Blue', 'Green', 'Yellow', 'Black', 'Purple', 'White'].map(colorOpt),
}

const DBS: CollectionFacets = {
  cardTypes: [
    { value: 'LEADER',        label: 'Leader' },
    { value: 'BATTLE',        label: 'Battle' },
    { value: 'EXTRA',         label: 'Extra' },
    { value: 'ENERGY MARKER', label: 'Energy Marker' },
  ],
  rarities: [
    { value: 'SCR', label: 'SCR · Secret' },
    { value: 'L',   label: 'L · Leader' },
    { value: 'SR',  label: 'SR · Super Rare' },
    { value: 'R',   label: 'R · Rare' },
    { value: 'UC',  label: 'UC · Uncommon' },
    { value: 'C',   label: 'C · Common' },
    { value: 'PR',  label: 'PR · Promo' },
  ],
  colors: ['Red', 'Blue', 'Green', 'Yellow', 'Black'].map(colorOpt),
}

const GUNDAM: CollectionFacets = {
  cardTypes: [
    { value: 'UNIT',    label: 'Unit' },
    { value: 'PILOT',   label: 'Pilot' },
    { value: 'COMMAND', label: 'Command' },
    { value: 'BASE',    label: 'Base' },
  ],
  rarities: [
    { value: 'LR', label: 'LR · Legendary Rare' },
    { value: 'R',  label: 'R · Rare' },
    { value: 'U',  label: 'U · Uncommon' },
    { value: 'C',  label: 'C · Common' },
  ],
  colors: ['Red', 'Blue', 'Green', 'Purple', 'White'].map(colorOpt),
}

export const COLLECTION_FACETS: Record<Collection, CollectionFacets> = {
  'one-piece': ONE_PIECE,
  pokemon:     POKEMON,
  digimon:     DIGIMON,
  dbs:         DBS,
  gundam:      GUNDAM,
}

/**
 * Helper to find a facet option's display label by value. Used by the
 * filter chip strip in card-grid so an active rarity chip reads
 * "Ultra Rare" instead of "Rare Ultra" (the raw catalog string).
 */
export function facetLabel(
  options: ReadonlyArray<FacetOption>,
  value: string | null,
): string {
  if (!value) return ''
  return options.find((o) => o.value === value)?.label ?? value
}
