/**
 * Per-collection filter facet config.
 *
 * Each TCG ships its own bundle with its own card-type, rarity, and
 * colour vocabulary - Pokémon's "Rare Holo VMAX" has nothing in common
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
  /**
   * Optional list of subtype/era filter options. Currently Pokémon-only
   * (maps to card.attributes). When present, the header renders a fourth
   * facet popover for "Subtype". Other collections leave this undefined.
   */
  subtypes?: ReadonlyArray<FacetOption>
  /**
   * Card-type values whose `card.name` is a named character/leader, used
   * to build the multi-select character picker. The picker derives its
   * option list from the live bundle (one entry per distinct name on a
   * card of one of these types), so it stays in sync as new prints land.
   * Undefined (or empty) hides the picker for that collection. Currently
   * One Piece only - the franchise whose roster users asked to filter by.
   */
  characterTypes?: ReadonlyArray<string>
  /**
   * Does this collection's bundle ship alt-art / parallel `variants`?
   * Gates the Alt art and Flatten toggles in the header - Pokémon
   * treats each parallel as its own card (no nested variants), so
   * exposing those toggles for Pokémon would be a dead-action UX.
   */
  hasVariants: boolean
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
  // Lorcana inks
  Amber:     '#f59e0b',
  Amethyst:  '#9333ea',
  Emerald:   '#10b981',
  Ruby:      '#dc2626',
  Sapphire:  '#2563eb',
  Steel:     '#64748b',
  // Azuki elements
  Earth:     '#92400e',
  Neutral:   '#a8a29e',
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
  // Leaders and Characters carry the roster names users filter by
  // ("Monkey.D.Luffy", "Roronoa.Zoro", combo prints like "Ace & Sabo
  // & Luffy"). Events/Stages are excluded - their `name` is a card
  // title, not a character.
  characterTypes: ['LEADER', 'CHARACTER'],
  hasVariants: true,
}

const POKEMON: CollectionFacets = {
  cardTypes: [
    { value: 'Pokémon', label: 'Pokémon' },
    { value: 'Trainer', label: 'Trainer' },
    { value: 'Energy',  label: 'Energy' },
  ],
  // Curated subset · Pokémon ships 25+ rarity strings. Ordered high → low
  // prestige so the popover reads as a natural scale.
  rarities: [
    { value: 'Hyper Rare',                label: 'Hyper Rare' },
    { value: 'Special Illustration Rare', label: 'Special Illustration' },
    { value: 'Illustration Rare',         label: 'Illustration Rare' },
    { value: 'Shiny Ultra Rare',          label: 'Shiny Ultra Rare' },
    { value: 'Rare Rainbow',              label: 'Rainbow Rare' },
    { value: 'Rare Secret',               label: 'Secret Rare' },
    { value: 'ACE SPEC Rare',             label: 'ACE SPEC' },
    { value: 'Ultra Rare',                label: 'Ultra Rare' },
    { value: 'Double Rare',               label: 'Double Rare' },
    { value: 'Rare Ultra',                label: 'Rare Ultra' },
    { value: 'Radiant Rare',              label: 'Radiant Rare' },
    { value: 'Shiny Rare',                label: 'Shiny Rare' },
    { value: 'Amazing Rare',              label: 'Amazing Rare' },
    { value: 'Rare Holo',                 label: 'Rare Holo' },
    { value: 'Rare',                      label: 'Rare' },
    { value: 'Promo',                     label: 'Promo' },
    { value: 'Uncommon',                  label: 'Uncommon' },
    { value: 'Common',                    label: 'Common' },
  ],
  colors: [
    'Grass', 'Fire', 'Water', 'Lightning', 'Psychic',
    'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless',
  ].map(colorOpt),
  // Era / mechanic subtypes - the most-searched `attributes` values.
  // Ordered from newest SV era backward so recent cards appear first.
  subtypes: [
    { value: 'ex',             label: 'ex (SV)' },
    { value: 'Tera',           label: 'Tera ex' },
    { value: 'ACE SPEC',       label: 'ACE SPEC' },
    { value: 'VSTAR',          label: 'VSTAR' },
    { value: 'VMAX',           label: 'VMAX' },
    { value: 'V',              label: 'V' },
    { value: 'GX',             label: 'GX' },
    { value: 'EX',             label: 'EX (XY)' },
    { value: 'TAG TEAM',       label: 'TAG TEAM' },
    { value: 'MEGA',           label: 'MEGA' },
    { value: 'Radiant',        label: 'Radiant' },
    { value: 'Prism Star',     label: 'Prism Star' },
    { value: 'Ultra Beast',    label: 'Ultra Beast' },
    { value: 'Ancient',        label: 'Ancient' },
    { value: 'Future',         label: 'Future' },
    { value: 'Stage 1',        label: 'Stage 1' },
    { value: 'Stage 2',        label: 'Stage 2' },
    { value: 'Basic',          label: 'Basic' },
    { value: 'Supporter',      label: 'Supporter' },
    { value: 'Item',           label: 'Item' },
    { value: 'Stadium',        label: 'Stadium' },
    { value: 'Special',        label: 'Special Energy' },
  ],
  // Pokémon parallels ship as separate cards (own id, own name), not
  // as nested `variants` on a base card. Audited bundle: 0 cards with
  // variants out of 20.5k. Toggle would be a dead action.
  hasVariants: false,
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
  hasVariants: true,
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
  hasVariants: true,
}

const GUNDAM: CollectionFacets = {
  cardTypes: [
    { value: 'UNIT',    label: 'Unit' },
    { value: 'PILOT',   label: 'Pilot' },
    { value: 'COMMAND', label: 'Command' },
    { value: 'BASE',    label: 'Base' },
  ],
  rarities: [
    { value: 'LR',  label: 'LR · Legendary Rare' },
    { value: 'LR+', label: 'LR+ · Parallel' },
    { value: 'LR++', label: 'LR++ · Double Parallel' },
    { value: 'R',   label: 'R · Rare' },
    { value: 'U',   label: 'U · Uncommon' },
    { value: 'C',   label: 'C · Common' },
    { value: 'P',   label: 'P · Promo' },
  ],
  colors: ['Red', 'Blue', 'Green', 'Purple', 'White'].map(colorOpt),
  hasVariants: true,
}

const LORCANA: CollectionFacets = {
  cardTypes: [
    { value: 'Character', label: 'Character' },
    { value: 'Action',    label: 'Action' },
    { value: 'Item',      label: 'Item' },
    { value: 'Location',  label: 'Location' },
  ],
  // Full ladder - Lorcana only ships 9 rarity strings. "Special" covers
  // promo prints (organized play, D23, convention exclusives).
  rarities: [
    { value: 'Iconic',     label: 'Iconic' },
    { value: 'Enchanted',  label: 'Enchanted' },
    { value: 'Epic',       label: 'Epic' },
    { value: 'Legendary',  label: 'Legendary' },
    { value: 'Super Rare', label: 'Super Rare' },
    { value: 'Rare',       label: 'Rare' },
    { value: 'Uncommon',   label: 'Uncommon' },
    { value: 'Common',     label: 'Common' },
    { value: 'Special',    label: 'Special · Promo' },
  ],
  colors: ['Amber', 'Amethyst', 'Emerald', 'Ruby', 'Sapphire', 'Steel'].map(colorOpt),
  // Like Pokémon: every print (Enchanted, promo) is its own card object.
  hasVariants: false,
}

const AZUKI: CollectionFacets = {
  cardTypes: [
    { value: 'Leader', label: 'Leader' },
    { value: 'Entity', label: 'Entity' },
    { value: 'Weapon', label: 'Weapon' },
    { value: 'Spell',  label: 'Spell' },
    { value: 'Gate',   label: 'Gate' },
    { value: 'IKZ',    label: 'IKZ' },
  ],
  // Full ladder - Azuki ships a compact rarity set plus star-foil tiers
  // (★ / ★★). Ordered high prestige to low.
  rarities: [
    { value: 'L ★★',  label: 'L ★★ · Leader (double foil)' },
    { value: 'L ★',   label: 'L ★ · Leader (foil)' },
    { value: 'L',     label: 'L · Leader' },
    { value: 'SR ★★', label: 'SR ★★ · Super Rare (double foil)' },
    { value: 'SR ★',  label: 'SR ★ · Super Rare (foil)' },
    { value: 'SR',    label: 'SR · Super Rare' },
    { value: 'R',     label: 'R · Rare' },
    { value: 'UC',    label: 'UC · Uncommon' },
    { value: 'C',     label: 'C · Common' },
    { value: 'G ★',   label: 'G ★ · Gate (foil)' },
    { value: 'G',     label: 'G · Gate' },
    { value: 'IKZ ★', label: 'IKZ ★ · Token (foil)' },
    { value: 'IKZ',   label: 'IKZ · Token' },
  ],
  colors: ['Fire', 'Water', 'Earth', 'Lightning', 'Neutral'].map(colorOpt),
  // Azuki bundles parallel/foil prints as nested variants on a base card
  // (same as Gundam / One Piece), so the Alt art + Flatten toggles apply.
  hasVariants: true,
}

export const COLLECTION_FACETS: Record<Collection, CollectionFacets> = {
  'one-piece': ONE_PIECE,
  pokemon:     POKEMON,
  digimon:     DIGIMON,
  dbs:         DBS,
  gundam:      GUNDAM,
  lorcana:     LORCANA,
  azuki:       AZUKI,
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
