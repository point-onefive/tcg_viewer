import { create } from 'zustand'
import { persist } from 'zustand/middleware'

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
      }),
      version: 6,
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
