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
  // Boolean rather than a count threshold - the user's mental model
  // is "show me cards that have alt art", not "show me cards with N+".
  onlyAltArt: boolean
  setOnlyAltArt: (v: boolean) => void
  // High-level language picker that swaps the gallery between Bandai's
  // five regional catalogues. Values:
  //   - 'ALL' : show every print Bandai publishes anywhere (default).
  //             Each card uses its highest-priority image (EN → JP → CN)
  //             but the carousel surfaces every regional alt and stamped
  //             prize the catalogues list.
  //   - 'EN'  : EN + Asia-EN cardlists. Card text reads in English.
  //   - 'JP'  : Japanese cardlist only -- the master catalogue with the
  //             earliest release dates and richest promo coverage.
  //   - 'CN'  : Traditional Chinese (HK/Macau + Taiwan). Card text reads
  //             in Traditional Chinese; "CN" is the user-facing label
  //             because TC + TW cover the entire Chinese-language
  //             Bandai catalogue (Simplified Chinese has no official
  //             Bandai cardlist site).
  // When a specific language is selected, applyLanguageFilter (in
  // card-filter.ts) hides cards that ship in NO matching region and
  // swaps each visible print's render URL to the matching localized
  // scan. Persisted so the preference survives reloads.
  language: LanguagePickerValue
  setLanguage: (v: LanguagePickerValue) => void
  // Sibling narrowing filter: when true, show only cards whose base
  // print is exclusive to the currently-selected language (i.e. no
  // other Bandai region publishes it). With `language='JP'` this is
  // every Japan-only base card -- ST-30, magazine promos, JP-only
  // Family Deck Set / Storage Box reprints. With `language='ALL'`
  // (the default) the toggle has no effect because no language is
  // selected to be "exclusive to". Mirrors the Alt-art toggle's
  // semantics. Persisted.
  onlyExclusives: boolean
  setOnlyExclusives: (v: boolean) => void
  zoom: number
  setZoom: (z: number) => void
  lightboxCardId: string | null
  openLightbox: (id: string) => void
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
          onlyExclusives: false,
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
      language: 'ALL',
      setLanguage: (language) => set({ language }),
      onlyExclusives: false,
      setOnlyExclusives: (onlyExclusives) => set({ onlyExclusives }),
      zoom: 5,
      setZoom: (zoom) => set({ zoom }),
      lightboxCardId: null,
      openLightbox: (id) => set({ lightboxCardId: id }),
      closeLightbox: () => set({ lightboxCardId: null }),
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
        onlyExclusives: state.onlyExclusives,
      }),
      version: 9,
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
          // v9 replaces the jpOnly boolean with a 4-way language picker
          // ('ALL' | 'EN' | 'JP' | 'CN') and an onlyExclusives narrowing
          // toggle. Map: jpOnly === true  -> language='JP' + exclusives;
          //              jpOnly === false -> default 'ALL'.
          const legacy = s as { jpOnly?: boolean }
          if (legacy.jpOnly === true) {
            s.language = 'JP'
            s.onlyExclusives = true
          } else {
            s.language = 'ALL'
            s.onlyExclusives = false
          }
          delete legacy.jpOnly
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
