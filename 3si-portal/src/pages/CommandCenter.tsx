import { useEffect } from 'react'
import { TopBar } from '@/components/TopBar'
import { LeftPanel } from '@/components/LeftPanel'
import { RightPanel } from '@/components/RightPanel'
import { BottomPanel } from '@/components/BottomPanel'
import { MapView } from '@/components/MapView'
import { FilterChips } from '@/components/FilterChips'
import { MapStyleSelector } from '@/components/MapStyleSelector'
import { MapModeToggle } from '@/components/MapModeToggle'
import { MapLoadingIndicator } from '@/components/MapLoadingIndicator'
import { AlertToastContainer } from '@/components/AlertToast'
import { useUI } from '@/stores/ui'
import { useAlerts } from '@/stores/alerts'
import { useMapDevices } from '@/stores/mapDevices'

export function CommandCenter() {
  const { leftPanelOpen, bottomPanelOpen } = useUI()
  const { startPolling, stopPolling, alertDevices } = useAlerts()
  const { allDevices: mapDevices, loading: mapLoading } = useMapDevices()

  useEffect(() => {
    startPolling()
    return () => stopPolling()
  }, [])

  return (
    <div className="h-screen w-screen flex flex-col bg-navy-900 overflow-hidden">
      <TopBar />

      <div className="flex-1 relative overflow-hidden">
        {/* Map fills everything */}
        <MapView />

        {/* Alert toasts */}
        <AlertToastContainer />

        {/* Top bar: filter chips + mode toggle + loading indicator */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 flex items-center gap-2">
          <FilterChips />
          <MapModeToggle />
          <MapLoadingIndicator />
        </div>

        {/* Map status overlay */}
        <div className="absolute bottom-14 left-1/2 -translate-x-1/2 z-10">
          <div className="bg-panel/90 backdrop-blur-sm border border-panel-border rounded-lg px-4 py-2 text-center">
            <p className="text-sm text-gray-400">
              <span className="text-healthy-green">&#9679;</span>{' '}
              {!mapLoading && mapDevices.length > 0
                ? `${mapDevices.length.toLocaleString()} devices on map`
                : mapLoading && mapDevices.length > 0
                ? `${mapDevices.length.toLocaleString()} devices loaded...`
                : 'Loading devices...'}{' '}
              {alertDevices.length === 0 && <>&middot; No active tracking events</>}
            </p>
          </div>
        </div>

        {/* Map style selector — offset for right panel (w-80 = 320px + 16px gap) */}
        <div className="absolute bottom-4 z-10" style={{ right: '336px' }}>
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

        {/* Right panel — always visible */}
        <div className="absolute top-0 right-0 h-full z-20 w-80">
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
