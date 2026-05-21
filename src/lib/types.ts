export type CardRegion = 'EN' | 'JP'

export type CardVariant = {
  id: string
  label: string        // e.g. "p1", "p2", "r1"
  imageUrl: string
  // Raw "Card Set(s)" string from Bandai's getInfo div, e.g.
  // "Premium Card Collection -FILM RED Edition-", "2025 NEW YEAR EVENT",
  // "Tournament Pack Vol.3", "Super Pre-Release". Use for human-readable
  // labels and substring-based filtering. Undefined for cards Bandai ships
  // with no distribution metadata (rare).
  distribution?: string
  // Which Bandai region(s) list this variant. JP-only variants are alt-arts
  // from Japan-only promos (Family Deck Sets, JP Storage Boxes, etc.) that
  // EN Bandai hasn't published. Undefined on data generated before the JP
  // merge landed.
  regions?: CardRegion[]
}

export type Card = {
  id: string           // base card ID e.g. "OP01-006"
  code: string
  name: string
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder?: number
  cardType?: string    // Character | Leader | Event | Stage
  rarity?: string      // C | UC | R | SR | SEC | L | P | TR
  colors?: string[]
  cost?: number | null
  power?: number | null
  counter?: number | null
  attributes?: string[]
  types?: string[]
  effect?: string | null
  trigger?: string | null
  // Where the base card came from -- same shape as CardVariant.distribution.
  // For starter-set cards this typically echoes the set name, e.g.
  // "-Straw Hat Crew-[ST-01]".
  distribution?: string
  regions?: CardRegion[]
  imageSmall: string
  imageLarge?: string
  variants?: CardVariant[]
}

export type CardSet = {
  setCode: string
  setName: string
  releaseDate?: string
  releaseOrder: number
  cardCount?: number
}
