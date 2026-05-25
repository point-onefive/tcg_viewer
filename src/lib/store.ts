import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { LanguagePickerValue } from './types'

type Theme = 'light' | 'dark'

/**
 * Supported TCG collections. New games plug in here + get their own
 * generated JSON files (src/lib/cards-{collection}.json) and R2 prefix.
 */
export type Collection = 'one-piece' | 'gundam' | 'dbs' | 'digimon' | 'pokemon'

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
  // When true, only show cards with at least one variant (alt art).
  // In stacked mode: hide cards with zero variants. In flatten mode:
  // hide base prints and show variant tiles only (see buildWallEntries).
  onlyAltArt: boolean
  setOnlyAltArt: (v: boolean) => void
  // When true, each variant gets its own tile on the wall instead of
  // living inside the stacked-card lightbox fan only.
  flattenWall: boolean
  setFlattenWall: (v: boolean) => void
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
      theme: 'light',
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
          onlyAltArt: false,
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
      onlyAltArt: false,
      setOnlyAltArt: (onlyAltArt) => set({ onlyAltArt }),
      flattenWall: false,
      setFlattenWall: (flattenWall) => set({ flattenWall }),
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
      }),
      version: 14,
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
        return s as StoreState
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
]
