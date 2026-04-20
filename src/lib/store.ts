import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type Theme = 'light' | 'dark'

export type Collection = 'one-piece' | 'pokemon' | 'magic' | 'yugioh'

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
}

export const useStore = create<StoreState>()(
  persist(
    (set) => ({
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
    }),
    {
      name: 'tcg-viewer-prefs',
      partialize: (state) => ({
        theme: state.theme,
        zoom: state.zoom,
        activeCollection: state.activeCollection,
      }),
      version: 3,
    }
  )
)

export const COLLECTIONS: { id: Collection; name: string; available: boolean }[] = [
  { id: 'one-piece', name: 'One Piece TCG', available: true },
  { id: 'pokemon',   name: 'Pokemon TCG',   available: false },
  { id: 'magic',     name: 'Magic',         available: false },
  { id: 'yugioh',    name: 'Yu-Gi-Oh!',     available: false },
]
