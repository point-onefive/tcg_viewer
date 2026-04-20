import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

export type Collection = 'one-piece' | 'pokemon' | 'magic' | 'yugioh'

/** A single pinned art. `variantId` is undefined for the base card. */
export interface Pin {
  cardId: string
  variantId?: string
}

const pinKey = (p: Pin) => p.variantId ?? p.cardId

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
  togglePin: (p: Pin) => void
  reorderPins: (fromKey: string, toKey: string) => void
  removePin: (key: string) => void
  isPinned: (p: Pin) => boolean
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
      setActiveCollection: (activeCollection) => set({ activeCollection, activeSet: null }),
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
      isPinned: (p) => get().pinned.some((x) => pinKey(x) === pinKey(p)),
      togglePin: (p) => {
        const { pinned } = get()
        const key = pinKey(p)
        const exists = pinned.some((x) => pinKey(x) === key)
        if (exists) {
          set({ pinned: pinned.filter((x) => pinKey(x) !== key) })
          void track('unpin', p)
        } else {
          set({ pinned: [...pinned, p] })
          void track('pin', p)
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
      version: 4,
    }
  )
)

export const pinKeyFor = pinKey

export const COLLECTIONS: { id: Collection; name: string; available: boolean }[] = [
  { id: 'one-piece', name: 'One Piece TCG', available: true },
  { id: 'pokemon',   name: 'Pokemon TCG',   available: false },
  { id: 'magic',     name: 'Magic',         available: false },
  { id: 'yugioh',    name: 'Yu-Gi-Oh!',     available: false },
]
