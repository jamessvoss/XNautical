import { create } from 'zustand'

type MapStyle = 'streets' | 'satellite' | 'terrain' | 'dark'

interface UIState {
  leftPanelOpen: boolean
  rightPanelOpen: boolean
  bottomPanelOpen: boolean
  darkMode: boolean
  mapStyle: MapStyle
  toggleLeftPanel: () => void
  toggleRightPanel: () => void
  toggleBottomPanel: () => void
  toggleDarkMode: () => void
  setMapStyle: (style: MapStyle) => void
  openRightPanel: () => void
  closeRightPanel: () => void
}

export const useUI = create<UIState>((set) => ({
  leftPanelOpen: true,
  rightPanelOpen: false,
  bottomPanelOpen: false,
  darkMode: true,
  mapStyle: 'streets',
  toggleLeftPanel: () => set((s) => ({ leftPanelOpen: !s.leftPanelOpen })),
  toggleRightPanel: () => set((s) => ({ rightPanelOpen: !s.rightPanelOpen })),
  toggleBottomPanel: () => set((s) => ({ bottomPanelOpen: !s.bottomPanelOpen })),
  toggleDarkMode: () => set((s) => ({ darkMode: !s.darkMode })),
  setMapStyle: (mapStyle) => set({ mapStyle }),
  openRightPanel: () => set({ rightPanelOpen: true }),
  closeRightPanel: () => set({ rightPanelOpen: false }),
}))
