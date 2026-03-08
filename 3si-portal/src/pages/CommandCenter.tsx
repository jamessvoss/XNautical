import { TopBar } from '@/components/TopBar'
import { LeftPanel } from '@/components/LeftPanel'
import { RightPanel } from '@/components/RightPanel'
import { BottomPanel } from '@/components/BottomPanel'
import { MapView } from '@/components/MapView'
import { FilterChips } from '@/components/FilterChips'
import { MapStyleSelector } from '@/components/MapStyleSelector'
import { useUI } from '@/stores/ui'

export function CommandCenter() {
  const { leftPanelOpen, rightPanelOpen, bottomPanelOpen } = useUI()

  return (
    <div className="h-screen w-screen flex flex-col bg-navy-900 overflow-hidden">
      <TopBar />

      <div className="flex-1 relative overflow-hidden">
        {/* Map fills everything */}
        <MapView />

        {/* Floating filter chips */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10">
          <FilterChips />
        </div>

        {/* Map style selector */}
        <div className="absolute bottom-4 right-4 z-10">
          <MapStyleSelector />
        </div>

        {/* Left panel */}
        <div
          className={`absolute top-0 left-0 h-full z-20 transition-all duration-300 ${
            leftPanelOpen ? 'w-72' : 'w-12'
          }`}
        >
          <LeftPanel />
        </div>

        {/* Right panel */}
        <div
          className={`absolute top-0 right-0 h-full z-20 transition-all duration-300 ${
            rightPanelOpen ? 'w-80' : 'w-0'
          } overflow-hidden`}
        >
          <RightPanel />
        </div>

        {/* Bottom panel */}
        <div
          className={`absolute bottom-0 left-0 right-0 z-30 transition-all duration-300 ${
            bottomPanelOpen ? 'h-72' : 'h-0'
          } overflow-hidden`}
        >
          <BottomPanel />
        </div>
      </div>
    </div>
  )
}
