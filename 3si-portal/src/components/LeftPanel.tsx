import { ChevronLeft, ChevronRight, Satellite } from 'lucide-react'
import { useUI } from '@/stores/ui'

export function LeftPanel() {
  const { leftPanelOpen, toggleLeftPanel } = useUI()

  return (
    <div className="h-full bg-panel/95 backdrop-blur-md border-r border-panel-border flex flex-col relative">
      {/* Toggle button */}
      <button
        onClick={toggleLeftPanel}
        className="absolute -right-3 top-4 z-10 w-6 h-6 bg-navy-700 border border-panel-border rounded-full flex items-center justify-center text-gray-400 hover:text-white transition-colors cursor-pointer"
      >
        {leftPanelOpen ? <ChevronLeft className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {leftPanelOpen ? (
        <>
          <div className="p-3 border-b border-panel-border">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Satellite className="w-4 h-4 text-accent" />
              Devices
            </h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2">
            <p className="text-xs text-gray-500 p-2">Loading devices...</p>
          </div>
        </>
      ) : (
        <div className="flex flex-col items-center pt-14 gap-3">
          <Satellite className="w-5 h-5 text-gray-400" />
        </div>
      )}
    </div>
  )
}
