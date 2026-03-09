import { create } from 'zustand'

const STORAGE_KEY = 'dtd_favorites'

function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw))
  } catch {
    return new Set()
  }
}

function saveFavorites(favorites: Set<string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Array.from(favorites)))
  } catch {
    // ignore
  }
}

interface FavoritesState {
  favorites: Set<string>
  isFavorite: (deviceNumber: string) => boolean
  toggleFavorite: (deviceNumber: string) => void
}

export const useFavorites = create<FavoritesState>((set, get) => ({
  favorites: loadFavorites(),

  isFavorite: (deviceNumber: string) => get().favorites.has(deviceNumber),

  toggleFavorite: (deviceNumber: string) => {
    const next = new Set(get().favorites)
    if (next.has(deviceNumber)) {
      next.delete(deviceNumber)
    } else {
      next.add(deviceNumber)
    }
    saveFavorites(next)
    set({ favorites: next })
  },
}))
