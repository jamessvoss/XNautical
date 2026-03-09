import { create } from 'zustand'

type MapStyle = 'streets' | 'satellite' | 'terrain' | 'dark'
type MapMode = 'clustered' | 'all'
export type MapFilter = 'all' | 'active' | 'attention' | 'low-battery' | 'favorites'

interface UIState {
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  bottomPanelOpen: boolean
  darkMode: boolean
  mapStyle: MapStyle
  mapMode: MapMode
  mapFilter: MapFilter
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  toggleBottomPanel: () => void
  toggleDarkMode: () => void
  setMapStyle: (style: MapStyle) => void
  setMapMode: (mode: MapMode) => void
  setMapFilter: (filter: MapFilter) => void
  openRightPanel: () => void
  closeRightPanel: () => void
}

export const useUI = create<UIState>((set) => ({
  leftPanelOpen: true,
  rightPanelOpen: false,
  bottomPanelOpen: false,
  darkMode: true,
  mapStyle: 'satellite',
  mapMode: 'all',
  mapFilter: 'all',
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
  setMapStyle: (mapStyle) => set({ mapStyle }),
  setMapMode: (mapMode) => set({ mapMode }),
  setMapFilter: (mapFilter) => set({ mapFilter }),
  openRightPanel: () => set({ rightPanelOpen: true }),
  closeRightPanel: () => set({ rightPanelOpen: false }),
}))
