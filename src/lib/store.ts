import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

/**
 * Supported TCG collections. New games plug in here + get their own
 * generated JSON files (src/lib/cards-{collection}.json) and R2 prefix.
 */
export type Collection = 'one-piece' | 'gundam' | 'dbs' | 'digimon'

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
  isPinned: (p: PinInput) => boolean
  boardOpen: boolean
  setBoardOpen: (open: boolean) => void
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
      boardOpen: false,
      setBoardOpen: (boardOpen) => set({ boardOpen }),
    }),
    {
      name: 'tcg-viewer-prefs',
      partialize: (state) => ({
        theme: state.theme,
        zoom: state.zoom,
        activeCollection: state.activeCollection,
        pinned: state.pinned,
      }),
      version: 5,
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
]
