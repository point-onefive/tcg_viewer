import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LanguagePickerValue } from './types'
import { defaultTiers, type TierCard, type TierDef } from './tier-list-types'
import {
  baseCardId,
  createEmptyDeck,
  maxCopiesFor,
  type Deck,
  type DeckEntry,
} from './deck-types'

type Theme = 'light' | 'dark'

/**
 * Supported TCG collections. New games plug in here + get their own
 * generated JSON files (src/lib/cards-{collection}.json) and R2 prefix.
 */
export type Collection = 'one-piece' | 'gundam' | 'dbs' | 'digimon' | 'pokemon' | 'lorcana' | 'azuki'

/**
 * A single pinned art. `collection` is set automatically by the store
 * from `activeCollection` when pinning, so call sites stay concise.
 * The board panel filters pins by the active collection.
 */
export interface Pin {
  collection: Collection
  cardId: string
  variantId?: string
}

/** Caller-facing pin arg (no collection - store fills it in). */
export interface PinInput {
  cardId: string
  variantId?: string
}

const pinKey = (p: Pin) =>
  `${p.collection}::${p.variantId ?? p.cardId}`

/**
 * A single image queued for the tier list maker. `id` is the stable
 * cardId or variantId from a Card on the gallery (so we can dedupe and
 * keep button state in sync); `src` is the large image URL we want to
 * rank with; `label` is optional metadata for accessibility / future UI.
 */
export interface TierPoolItem {
  id: string
  src: string
  label?: string
}

interface StoreState {
  theme: Theme
  toggleTheme: () => void
  setTheme: (t: Theme) => void
  activeCollection: Collection
  setActiveCollection: (c: Collection) => void
  searchQuery: string
  setSearchQuery: (q: string) => void
  activeSet: string | null
  setActiveSet: (s: string | null) => void
  activeRarity: string | null
  setActiveRarity: (r: string | null) => void
  activeColor: string | null
  setActiveColor: (c: string | null) => void
  // Filter on Card.cardType (e.g. "LEADER", "CHARACTER", "EVENT",
  // "STAGE" for One Piece). Stored as the uppercase string so it
  // matches the raw value in the bundles without normalisation.
  activeCardType: string | null
  setActiveCardType: (t: string | null) => void
  // Pokémon subtype/era filter (ex, VMAX, Tera, Stage 1, etc.)
  activeSubtype: string | null
  setActiveSubtype: (s: string | null) => void
  // Artist filter - populated for Pokémon; null for all other collections.
  activeArtist: string | null
  setActiveArtist: (a: string | null) => void
  // Multi-select character filter (One Piece). Holds the exact card
  // names the user has picked; the wall shows any card matching one of
  // them (OR). toggleCharacter flips a single name on/off;
  // clearCharacters empties the selection.
  activeCharacters: string[]
  toggleCharacter: (name: string) => void
  clearCharacters: () => void
  // When true, only show cards with at least one variant (alt art).
  // In stacked mode: hide cards with zero variants. In flatten mode:
  // hide base prints and show variant tiles only (see buildWallEntries).
  onlyAltArt: boolean
  setOnlyAltArt: (v: boolean) => void
  // When true (One Piece only), narrow the wall to the curated set of
  // cards that have received an official errata (text change) from
  // Bandai. List lives in `cards-one-piece-errata.ts` and is sourced
  // from https://en.onepiece-cardgame.com/rules/errata_card/. Not
  // persisted - users opt into the filter per session.
  onlyErrata: boolean
  setOnlyErrata: (v: boolean) => void
  // When true, each variant gets its own tile on the wall instead of
  // living inside the stacked-card lightbox fan only.
  flattenWall: boolean
  setFlattenWall: (v: boolean) => void
  // When true, render the small market-price badge on each tile. Off
  // by default because the wall is designed to read as a clean image
  // grid first; pricing is a power-user opt-in that surfaces the
  // resolved TCGPlayer market price (Foil > Holo > Normal) in the
  // top-right of every tile. Persisted so the preference survives
  // reloads.
  showTilePrices: boolean
  setShowTilePrices: (v: boolean) => void
  // Wall sort applied within each set group. 'default' = set order
  // (collector number, same as bundle order). Other values sort tiles
  // within each set header group without removing the headers.
  wallSort: 'default' | 'cost-asc' | 'cost-desc' | 'rarity' | 'type' | 'power-desc' | 'price-desc'
  setWallSort: (s: 'default' | 'cost-asc' | 'cost-desc' | 'rarity' | 'type' | 'power-desc' | 'price-desc') => void
  // Single-select view mode for the gallery:
  //
  //   - 'EN'         : EN + Asia-EN cardlists. Card text reads in English.
  //                    Anything Bandai didn't publish in English is hidden.
  //   - 'JP'         : Japanese cardlist only -- the master catalogue
  //                    with the earliest release dates and richest promo
  //                    coverage. Card text reads in Japanese.
  //
  // CN was removed in v13. See samples/jp-cn-compare/README.md for the
  // why (Bandai's TC/TW CDNs hot-link the JP file for the vast majority
  // of cards, so the CN bucket was just JP-under-a-different-URL).
  //
  // applyLanguageFilter (in card-filter.ts) handles the wall narrowing
  // + image-URL swapping. Persisted so the preference survives reloads.
  language: LanguagePickerValue
  setLanguage: (v: LanguagePickerValue) => void
  zoom: number
  setZoom: (z: number) => void
  lightboxCardId: string | null
  /** Which print to focus in the lightbox fan (card.id for base). */
  lightboxPrintId: string | null
  openLightbox: (cardId: string, printId?: string) => void
  closeLightbox: () => void
  pinned: Pin[]
  togglePin: (p: PinInput) => void
  reorderPins: (fromKey: string, toKey: string) => void
  removePin: (key: string) => void
  clearActivePins: () => void
  isPinned: (p: PinInput) => boolean
  boardOpen: boolean
  setBoardOpen: (open: boolean) => void
  tierPool: TierPoolItem[]
  addToTierPool: (item: TierPoolItem) => void
  removeFromTierPool: (id: string) => void
  toggleTierPool: (item: TierPoolItem) => void
  isInTierPool: (id: string) => boolean
  clearTierPool: () => void

  /**
   * The persisted state of the Tier List Maker board. Lifted out of
   * the page's local React state so it survives the user navigating
   * to the gallery and back -- previously the entire chart (custom
   * tier rows, card-to-tier assignments, board title) was wiped the
   * moment the component unmounted, which made the tier-list page
   * feel hostile after even one round-trip to grab another card.
   *
   * Persistence policy:
   *   - `tierBoardTiers`: persisted (the user's custom S+/D/etc).
   *   - `tierBoardTitle`: persisted (free-form chart title).
   *   - `tierBoardCards`: persisted, BUT we drop upload-kind cards on
   *     the way out (their `blob:` URLs die on page reload, so we'd
   *     restore broken thumbs). Gallery-kind cards are stable URLs
   *     and round-trip fine.
   *
   * `setTierBoardTiers` / `setTierBoardCards` accept either a new
   * value or a `(prev) => next` updater so call sites can keep using
   * the React-style functional update pattern they had with useState.
   */
  tierBoardTiers: TierDef[]
  setTierBoardTiers: (next: TierDef[] | ((prev: TierDef[]) => TierDef[])) => void
  tierBoardCards: TierCard[]
  setTierBoardCards: (next: TierCard[] | ((prev: TierCard[]) => TierCard[])) => void
  tierBoardTitle: string
  setTierBoardTitle: (next: string) => void
  /**
   * Wipe the board back to a clean slate: default tier rows, no
   * cards, empty title. Does NOT touch the gallery's tier-pool queue
   * (`tierPool`) - that lives on the main wall side and clearing it
   * separately is a different intent ("forget every card I queued
   * for ranking" vs. "I want to start ranking from scratch but keep
   * my queued cards").
   */
  resetTierBoard: () => void
  /**
   * Restore the default S/A/B/C tier rows (names, colors, count,
   * order) and move every charted card back to the pool. Keeps cards
   * on the board and leaves the chart title untouched.
   */
  resetTierChart: () => void

  /**
   * Deck Builder state. Multiple named decks per browser instance,
   * persisted in localStorage (no login). Decks are scoped to a
   * collection (mirrors the per-collection board / pins) so a One Piece
   * deck never mixes with a Pokémon one. The builder reads the decks
   * for the active collection and the lightbox "Deck" button appends to
   * `activeDeckId` (creating a first deck on demand).
   */
  decks: Deck[]
  activeDeckId: string | null
  /** Create a new (empty) deck for the active collection; returns its id. */
  createDeck: (name?: string) => string
  renameDeck: (id: string, name: string) => void
  deleteDeck: (id: string) => void
  /** Clone a deck (entries + leader) under a new id; returns the new id. */
  duplicateDeck: (id: string) => string | null
  setActiveDeck: (id: string) => void
  /**
   * Append a card to the active deck (creating a first deck for the
   * collection if none exists). If the card's base code is already in
   * the deck, its quantity is bumped instead of adding a duplicate row.
   */
  addCardToActiveDeck: (input: DeckCardAddInput) => void
  /**
   * Append a card to a specific deck and make that deck active. Used by
   * the lightbox deck picker when more than one deck exists, so the user
   * can choose the destination instead of always hitting the active one.
   */
  addCardToDeck: (deckId: string, input: DeckCardAddInput) => void
  /** Add a user-authored proxy card to a specific deck. */
  addCustomCardToDeck: (deckId: string, input: CustomCardInput) => void
  /** Set an entry's quantity (qty <= 0 removes the entry). */
  setDeckEntryQty: (deckId: string, uid: string, qty: number) => void
  removeDeckEntry: (deckId: string, uid: string) => void
  /** Swap the displayed print (alt art) for a gallery entry. */
  setDeckEntryPrint: (deckId: string, uid: string, printId: string, src: string) => void
  /** Remove every entry from a deck (keeps the deck + its name). */
  clearDeck: (deckId: string) => void
  /** True when the active deck already contains this base card code. */
  isCardInActiveDeck: (cardId: string) => boolean
}

/** Caller-facing arg for adding a gallery card to a deck. */
export interface DeckCardAddInput {
  /** Print id of the focused art (base = card.id, variant = variant.id). */
  cardId: string
  name: string
  src: string
  cardType?: string
  cost?: number | null
  color?: string
}

/** Caller-facing arg for adding a custom proxy card. */
export interface CustomCardInput {
  name: string
  /** Optional index/code the player wants in the export. */
  cardId?: string
  /** Optional image (data-URL preferred so it persists across reloads). */
  src?: string
}

function newUid(): string {
  return (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : `e-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** Fire-and-forget telemetry. Anonymous, no user id, no cookies. */
async function track(action: 'pin' | 'unpin', pin: Pin) {
  if (typeof window === 'undefined') return
  try {
    await fetch('/api/track-pin', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, ...pin }),
      keepalive: true,
    })
  } catch {
    // Telemetry never blocks the UI.
  }
}

export const useStore = create<StoreState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
      setTheme: (theme) => set({ theme }),
      activeCollection: 'one-piece',
      setActiveCollection: (activeCollection) =>
        set({
          activeCollection,
          activeSet: null,
          activeRarity: null,
          activeColor: null,
          activeCardType: null,
          activeSubtype: null,
          activeArtist: null,
          activeCharacters: [],
          onlyAltArt: false,
          onlyErrata: false,
          flattenWall: false,
          searchQuery: '',
          lightboxCardId: null,
        }),
      searchQuery: '',
      setSearchQuery: (searchQuery) => set({ searchQuery }),
      activeSet: null,
      setActiveSet: (activeSet) => set({ activeSet }),
      activeRarity: null,
      setActiveRarity: (activeRarity) => set({ activeRarity }),
      activeColor: null,
      setActiveColor: (activeColor) => set({ activeColor }),
      activeCardType: null,
      setActiveCardType: (activeCardType) => set({ activeCardType }),
      activeSubtype: null,
      setActiveSubtype: (activeSubtype) => set({ activeSubtype }),
      activeArtist: null,
      setActiveArtist: (activeArtist) => set({ activeArtist }),
      activeCharacters: [],
      toggleCharacter: (name) =>
        set((s) => ({
          activeCharacters: s.activeCharacters.includes(name)
            ? s.activeCharacters.filter((n) => n !== name)
            : [...s.activeCharacters, name],
        })),
      clearCharacters: () => set({ activeCharacters: [] }),
      onlyAltArt: false,
      setOnlyAltArt: (onlyAltArt) => set({ onlyAltArt }),
      onlyErrata: false,
      setOnlyErrata: (onlyErrata) => set({ onlyErrata }),
      flattenWall: false,
      setFlattenWall: (flattenWall) => set({ flattenWall }),
      showTilePrices: false,
      setShowTilePrices: (showTilePrices) => set({ showTilePrices }),
      wallSort: 'default',
      setWallSort: (wallSort) => set({ wallSort }),
      // Default to EN: the app's surface language is English, so an
      // English-speaking user starting fresh sees a wall they can read.
      // JP is one click away for users who want the master catalogue.
      language: 'EN',
      setLanguage: (language) => set({ language }),
      zoom: 5,
      setZoom: (zoom) => set({ zoom }),
      lightboxCardId: null,
      lightboxPrintId: null,
      openLightbox: (cardId, printId) =>
        set({
          lightboxCardId: cardId,
          lightboxPrintId: printId ?? cardId,
        }),
      closeLightbox: () => set({ lightboxCardId: null, lightboxPrintId: null }),
      pinned: [],
      isPinned: (p) => {
        const { pinned, activeCollection } = get()
        const full: Pin = { ...p, collection: activeCollection }
        const k = pinKey(full)
        return pinned.some((x) => pinKey(x) === k)
      },
      togglePin: (p) => {
        const { pinned, activeCollection } = get()
        const full: Pin = { ...p, collection: activeCollection }
        const k = pinKey(full)
        const exists = pinned.some((x) => pinKey(x) === k)
        if (exists) {
          set({ pinned: pinned.filter((x) => pinKey(x) !== k) })
          void track('unpin', full)
        } else {
          set({ pinned: [...pinned, full] })
          void track('pin', full)
        }
      },
      removePin: (key) => {
        const { pinned } = get()
        const target = pinned.find((x) => pinKey(x) === key)
        set({ pinned: pinned.filter((x) => pinKey(x) !== key) })
        if (target) void track('unpin', target)
      },
      reorderPins: (fromKey, toKey) => {
        const { pinned } = get()
        const from = pinned.findIndex((x) => pinKey(x) === fromKey)
        const to = pinned.findIndex((x) => pinKey(x) === toKey)
        if (from < 0 || to < 0 || from === to) return
        const next = pinned.slice()
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        set({ pinned: next })
      },
      // Clear every pin for the currently-active collection only. We
      // explicitly preserve pins on other collections so the user
      // doesn't lose their other boards when they hit "Clear all" on,
      // say, the Pokémon board. Telemetry fires one unpin event per
      // removed pin to keep parity with the single-remove path.
      clearActivePins: () => {
        const { pinned, activeCollection } = get()
        const removed = pinned.filter((x) => x.collection === activeCollection)
        if (removed.length === 0) return
        set({ pinned: pinned.filter((x) => x.collection !== activeCollection) })
        for (const p of removed) void track('unpin', p)
      },
      boardOpen: false,
      setBoardOpen: (boardOpen) => set({ boardOpen }),

      tierPool: [],
      isInTierPool: (id) => get().tierPool.some((x) => x.id === id),
      addToTierPool: (item) => {
        const { tierPool } = get()
        if (tierPool.some((x) => x.id === item.id)) return
        set({ tierPool: [...tierPool, item] })
      },
      removeFromTierPool: (id) => {
        set({ tierPool: get().tierPool.filter((x) => x.id !== id) })
      },
      toggleTierPool: (item) => {
        const { tierPool } = get()
        const exists = tierPool.some((x) => x.id === item.id)
        if (exists) {
          set({ tierPool: tierPool.filter((x) => x.id !== item.id) })
        } else {
          set({ tierPool: [...tierPool, item] })
        }
      },
      clearTierPool: () => set({ tierPool: [] }),

      tierBoardTiers: defaultTiers(),
      setTierBoardTiers: (next) =>
        set((s) => ({
          tierBoardTiers:
            typeof next === 'function' ? (next as (prev: TierDef[]) => TierDef[])(s.tierBoardTiers) : next,
        })),
      tierBoardCards: [],
      setTierBoardCards: (next) =>
        set((s) => ({
          tierBoardCards:
            typeof next === 'function' ? (next as (prev: TierCard[]) => TierCard[])(s.tierBoardCards) : next,
        })),
      tierBoardTitle: '',
      setTierBoardTitle: (tierBoardTitle) => set({ tierBoardTitle }),
      resetTierBoard: () =>
        set({
          tierBoardTiers: defaultTiers(),
          tierBoardCards: [],
          tierBoardTitle: '',
        }),
      resetTierChart: () =>
        set((s) => ({
          tierBoardTiers: defaultTiers(),
          tierBoardCards: s.tierBoardCards.map((c) =>
            c.tierId === null ? c : { ...c, tierId: null },
          ),
        })),

      decks: [],
      activeDeckId: null,
      createDeck: (name) => {
        const { decks, activeCollection } = get()
        const collectionDecks = decks.filter((d) => d.collection === activeCollection)
        const deck = createEmptyDeck(
          activeCollection,
          name?.trim() || `Deck ${collectionDecks.length + 1}`,
        )
        set({ decks: [...decks, deck], activeDeckId: deck.id })
        return deck.id
      },
      renameDeck: (id, name) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === id ? { ...d, name, updatedAt: Date.now() } : d,
          ),
        })),
      deleteDeck: (id) =>
        set((s) => {
          const decks = s.decks.filter((d) => d.id !== id)
          let activeDeckId = s.activeDeckId
          if (activeDeckId === id) {
            // Fall back to another deck in the same collection, else null.
            const removed = s.decks.find((d) => d.id === id)
            const sibling = decks.find((d) => d.collection === removed?.collection)
            activeDeckId = sibling?.id ?? null
          }
          return { decks, activeDeckId }
        }),
      duplicateDeck: (id) => {
        const { decks } = get()
        const src = decks.find((d) => d.id === id)
        if (!src) return null
        const copy = createEmptyDeck(src.collection, `${src.name} copy`)
        copy.entries = src.entries.map((e) => ({ ...e, uid: newUid() }))
        set({ decks: [...decks, copy], activeDeckId: copy.id })
        return copy.id
      },
      setActiveDeck: (id) => set({ activeDeckId: id }),
      addCardToActiveDeck: (input) => {
        const { decks, activeDeckId, activeCollection } = get()
        const code = baseCardId(input.cardId)

        // Ensure there's a live target deck for this collection.
        let targetId = activeDeckId
        let working = decks
        const activeValid = decks.some(
          (d) => d.id === activeDeckId && d.collection === activeCollection,
        )
        if (!activeValid) {
          const existing = decks.find((d) => d.collection === activeCollection)
          if (existing) {
            targetId = existing.id
          } else {
            const fresh = createEmptyDeck(activeCollection, 'Deck 1')
            working = [...decks, fresh]
            targetId = fresh.id
          }
        }

        const now = Date.now()
        set({
          activeDeckId: targetId,
          decks: working.map((d) => {
            if (d.id !== targetId) return d
            const has = d.entries.find((e) => e.cardId === code)
            if (has) {
              return {
                ...d,
                updatedAt: now,
                entries: d.entries.map((e) =>
                  e.cardId === code ? { ...e, qty: Math.min(e.qty + 1, maxCopiesFor(e)) } : e,
                ),
              }
            }
            const entry: DeckEntry = {
              uid: newUid(),
              cardId: code,
              name: input.name,
              src: input.src,
              printId: input.cardId,
              qty: 1,
              kind: 'gallery',
              cardType: input.cardType,
              cost: input.cost,
              color: input.color,
            }
            return { ...d, updatedAt: now, entries: [...d.entries, entry] }
          }),
        })
      },
      addCardToDeck: (deckId, input) => {
        const code = baseCardId(input.cardId)
        const now = Date.now()
        set((s) => {
          if (!s.decks.some((d) => d.id === deckId)) return {}
          return {
            activeDeckId: deckId,
            decks: s.decks.map((d) => {
              if (d.id !== deckId) return d
              const has = d.entries.find((e) => e.cardId === code)
              if (has) {
                return {
                  ...d,
                  updatedAt: now,
                  entries: d.entries.map((e) =>
                    e.cardId === code ? { ...e, qty: Math.min(e.qty + 1, maxCopiesFor(e)) } : e,
                  ),
                }
              }
              const entry: DeckEntry = {
                uid: newUid(),
                cardId: code,
                name: input.name,
                src: input.src,
                printId: input.cardId,
                qty: 1,
                kind: 'gallery',
                cardType: input.cardType,
                cost: input.cost,
                color: input.color,
              }
              return { ...d, updatedAt: now, entries: [...d.entries, entry] }
            }),
          }
        })
      },
      addCustomCardToDeck: (deckId, input) =>
        set((s) => ({
          decks: s.decks.map((d) => {
            if (d.id !== deckId) return d
            const entry: DeckEntry = {
              uid: newUid(),
              cardId: (input.cardId ?? '').trim(),
              name: input.name.trim() || 'Custom card',
              src: input.src ?? '',
              qty: 1,
              kind: 'custom',
            }
            return { ...d, updatedAt: Date.now(), entries: [...d.entries, entry] }
          }),
        })),
      setDeckEntryQty: (deckId, uid, qty) =>
        set((s) => ({
          decks: s.decks.map((d) => {
            if (d.id !== deckId) return d
            const entries =
              qty <= 0
                ? d.entries.filter((e) => e.uid !== uid)
                : d.entries.map((e) => (e.uid === uid ? { ...e, qty: Math.min(qty, maxCopiesFor(e)) } : e))
            return { ...d, updatedAt: Date.now(), entries }
          }),
        })),
      removeDeckEntry: (deckId, uid) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? { ...d, updatedAt: Date.now(), entries: d.entries.filter((e) => e.uid !== uid) }
              : d,
          ),
        })),
      setDeckEntryPrint: (deckId, uid, printId, src) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId
              ? {
                  ...d,
                  updatedAt: Date.now(),
                  entries: d.entries.map((e) =>
                    e.uid === uid ? { ...e, printId, src } : e,
                  ),
                }
              : d,
          ),
        })),
      clearDeck: (deckId) =>
        set((s) => ({
          decks: s.decks.map((d) =>
            d.id === deckId ? { ...d, updatedAt: Date.now(), entries: [] } : d,
          ),
        })),
      isCardInActiveDeck: (cardId) => {
        const { decks, activeDeckId } = get()
        const deck = decks.find((d) => d.id === activeDeckId)
        if (!deck) return false
        const code = baseCardId(cardId)
        return deck.entries.some((e) => e.cardId === code)
      },
    }),
    {
      name: 'tcg-viewer-prefs',
      partialize: (state) => ({
        theme: state.theme,
        zoom: state.zoom,
        activeCollection: state.activeCollection,
        pinned: state.pinned,
        tierPool: state.tierPool,
        language: state.language,
        flattenWall: state.flattenWall,
        showTilePrices: state.showTilePrices,
        // Active filters - persisted so a refresh doesn't clear the
        // user's active search context. Switching collection still
        // resets them via setActiveCollection.
        searchQuery: state.searchQuery,
        activeSet: state.activeSet,
        activeCardType: state.activeCardType,
        activeRarity: state.activeRarity,
        activeColor: state.activeColor,
        activeSubtype: state.activeSubtype,
        activeArtist: state.activeArtist,
        activeCharacters: state.activeCharacters,
        onlyAltArt: state.onlyAltArt,
        // wallSort is deliberately NOT persisted. A sort picked during one
        // browsing session silently reordering the wall days later reads as
        // "the cards are broken", not "my old sort is still on" - fresh
        // visits should always open in canonical set order.
        tierBoardTiers: state.tierBoardTiers,
        tierBoardTitle: state.tierBoardTitle,
        // Drop upload-kind cards from the persisted slice: their
        // `blob:` URLs are tied to the current document lifetime, so
        // restoring them after a reload would just render broken
        // thumbs. Gallery cards round-trip fine - they're stable
        // R2/CDN URLs that the page can re-fetch on rehydrate.
        tierBoardCards: state.tierBoardCards.filter((c) => c.kind !== 'upload'),
        // Deck Builder: saved decks + which one is active. Gallery
        // entries carry stable CDN/R2 image URLs that round-trip fine;
        // custom proxies should be saved as data-URLs (not blob:) so
        // their pasted art survives a reload.
        decks: state.decks,
        activeDeckId: state.activeDeckId,
      }),
      version: 24,
      migrate: (persisted: unknown, fromVersion): StoreState => {
        const s = (persisted || {}) as Partial<StoreState> & { pinned?: Array<Partial<Pin>> }
        if (fromVersion < 5 && Array.isArray(s.pinned)) {
          // Older pins had no collection field - backfill to one-piece.
          s.pinned = s.pinned.map((p) => ({
            collection: (p.collection as Collection) ?? 'one-piece',
            cardId: p.cardId ?? '',
            variantId: p.variantId,
          }))
        }
        if (fromVersion < 6) {
          // tierPool was introduced in v6.
          s.tierPool = Array.isArray((s as { tierPool?: unknown }).tierPool)
            ? ((s as { tierPool?: TierPoolItem[] }).tierPool ?? [])
            : []
        }
        if (fromVersion < 7) {
          // Introduced (and later removed) `showJpVariants` in v7.
          delete (s as { showJpVariants?: boolean }).showJpVariants
        }
        if (fromVersion < 8) {
          // jpOnly (boolean) replaced showJpVariants in v8.
          delete (s as { showJpVariants?: boolean }).showJpVariants
        }
        if (fromVersion < 9) {
          // v9 replaced the jpOnly boolean with a 4-way (ALL|EN|JP|CN)
          // picker + an `onlyExclusives` narrowing toggle. Pre-v9 maps
          // jpOnly === true -> language='JP' + onlyExclusives=true.
          const legacy = s as { jpOnly?: boolean }
          if (legacy.jpOnly === true) {
            s.language = 'JP'
            ;(s as { onlyExclusives?: boolean }).onlyExclusives = true
          } else {
            s.language = 'EN'
          }
          delete legacy.jpOnly
        }
        if (fromVersion < 10) {
          // v10 collapsed the (language, onlyExclusives) pair into a
          // single picker. The 'EXCLUSIVES' value it introduced was
          // later removed in v12 (see below). Pre-v10 mappings here
          // still emit 'EXCLUSIVES' or 'ALL'; the v12 step normalises
          // those legacy values to the surviving {EN, JP, CN} set.
          const legacy = s as { language?: string; onlyExclusives?: boolean }
          if (legacy.onlyExclusives === true) {
            // Stamp the now-removed sentinel; the v12 step below
            // immediately rewrites it to 'EN'. Cast through unknown
            // because 'EXCLUSIVES' is no longer in LanguagePickerValue.
            ;(s as { language?: string }).language = 'EXCLUSIVES'
          } else if (legacy.language === 'ALL' || !legacy.language) {
            s.language = 'EN'
          }
          delete legacy.onlyExclusives
        }
        if (fromVersion < 11) {
          // v11 is a no-op migration: the picker enum is unchanged,
          // only the underlying CN bucket expanded from [TC, TW] to
          // [SC, TC, TW] in src/lib/types.ts to surface Bandai's
          // Simplified Chinese site (`onepiece-cardgame.cn`). No
          // persisted shape changes; bumping the version forces a
          // single rehydration so the new mapping takes effect.
        }
        if (fromVersion < 12) {
          // v12 collapses the picker from {EN, JP, CN, EXCLUSIVES}
          // back to {EN, JP, CN}. The cross-region "Exclusives" mode
          // was surfacing too many cards that ALSO appeared in plain
          // EN/JP/CN browse (loose semantics: a card was "exclusive"
          // if any one of its variants was region-locked, but its
          // base print still shipped globally) and the same
          // characters showed up as visual duplicates between modes.
          // Anyone persisted on EXCLUSIVES falls back to EN (the
          // default) on rehydrate.
          const legacy = s as { language?: string }
          if (legacy.language === 'EXCLUSIVES') {
            s.language = 'EN'
          }
        }
        if (fromVersion < 13) {
          // v13 drops CN from the picker. Bandai's TC/TW CDNs hot-link
          // the JP file for the vast majority of cards, so the CN
          // bucket was surfacing the JP image under a different URL
          // and the same artwork showed up twice when users flipped
          // languages -- the canonical "JP and CN look the same" bug
          // captured in samples/jp-cn-compare/. SC-exclusive prints
          // remain in the bundle but only reachable via search /
          // drill-down, not via a top-level picker pill. Anyone
          // persisted on CN falls back to EN on rehydrate.
          const legacy = s as { language?: string }
          if (legacy.language === 'CN') {
            s.language = 'EN'
          }
        }
        if (fromVersion < 14) {
          // v14 adds flattenWall (default off).
          s.flattenWall = false
        }
        if (fromVersion < 15) {
          // v15 persists the Tier List Maker board (tiers + cards +
          // title) so it survives navigation away to the gallery
          // and back. Older snapshots have none of these fields;
          // the default-initialised values from the create() call
          // above (defaultTiers(), [], '') are what we want on a
          // first-rehydrate-after-upgrade.
          s.tierBoardTiers = defaultTiers()
          s.tierBoardCards = []
          s.tierBoardTitle = ''
        }
        if (fromVersion < 16) {
          // v16 adds the per-tile pricing badge as an opt-in toggle.
          // Default off keeps the wall reading as a clean image grid
          // for users who don't care about prices.
          s.showTilePrices = false
        }
        if (fromVersion < 17) {
          // v17 adds wall sort (default = bundle order).
          s.wallSort = 'default'
        }
        if (fromVersion < 18) {
          // v18 adds Pokémon subtype filter (default = no filter).
          s.activeSubtype = null
        }
        if (fromVersion < 19) {
          // v19 adds artist filter (default = no filter).
          s.activeArtist = null
        }
        if (fromVersion < 20) {
          // v20 stops persisting wallSort (session-only now). Clear any
          // stale sort baked into older persisted blobs so returning
          // visitors get canonical set order again.
          s.wallSort = 'default'
        }
        if (fromVersion < 21) {
          // v21 re-clears wallSort on every upgrade path. Older blobs
          // could still carry a wallSort key even after v20 stopped
          // writing it - zustand merges stored keys on rehydrate, so
          // a leftover "price-desc" silently reordered the wall for
          // returning visitors (incognito looked fine; regular browser
          // did not).
          s.wallSort = 'default'
        }
        if (fromVersion < 22) {
          // v22 starts persisting active filters. Old sessions have no
          // stored values, so ensure every filter lands at its null/false
          // default rather than undefined (which Zustand would merge
          // incorrectly against the initialState default).
          s.searchQuery  = s.searchQuery  ?? ''
          s.activeSet       = s.activeSet       ?? null
          s.activeCardType  = s.activeCardType  ?? null
          s.activeRarity    = s.activeRarity    ?? null
          s.activeColor     = s.activeColor     ?? null
          s.activeSubtype   = s.activeSubtype   ?? null
          s.activeArtist    = s.activeArtist    ?? null
          s.onlyAltArt      = s.onlyAltArt      ?? false
        }
        if (fromVersion < 23) {
          // v23 adds the multi-select character filter (One Piece).
          // Coerce to an array so a pre-v23 blob (no key) doesn't leave
          // it undefined when merged against initialState.
          s.activeCharacters = Array.isArray(s.activeCharacters) ? s.activeCharacters : []
        }
        if (fromVersion < 24) {
          // v24 adds the Deck Builder (saved decks + active deck id).
          // Old blobs have neither key; default to an empty deck list so
          // Zustand doesn't merge `undefined` against initialState.
          s.decks = Array.isArray((s as { decks?: unknown }).decks)
            ? ((s as { decks?: Deck[] }).decks ?? [])
            : []
          s.activeDeckId = (s as { activeDeckId?: string | null }).activeDeckId ?? null
        }
        return s as StoreState
      },
      onRehydrateStorage: () => (state) => {
        // Belt-and-suspenders: never restore a sort from localStorage.
        if (state) state.wallSort = 'default'
      },
    }
  )
)

export const pinKeyFor = pinKey

export const COLLECTIONS: { id: Collection; name: string; available: boolean }[] = [
  { id: 'one-piece', name: 'One Piece',        available: true },
  { id: 'gundam',    name: 'Gundam',           available: true },
  { id: 'dbs',       name: 'Dragon Ball Super', available: true },
  { id: 'digimon',   name: 'Digimon',          available: true },
  { id: 'pokemon',   name: 'Pokémon',          available: true },
  { id: 'lorcana',   name: 'Lorcana',          available: true },
  { id: 'azuki',     name: 'Azuki',            available: true },
]
