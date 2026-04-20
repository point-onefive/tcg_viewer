export type CardVariant = {
  id: string
  label: string        // e.g. "p1", "p2", "r1"
  imageUrl: string
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
