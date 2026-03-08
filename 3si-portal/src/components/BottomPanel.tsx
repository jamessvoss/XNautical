import { useUI } from '@/stores/ui'
import { ChevronDown } from 'lucide-react'

export function BottomPanel() {
  const { bottomPanelOpen, toggleBottomPanel } = useUI()

  if (!bottomPanelOpen) return null

  return (
    <div className="h-full bg-panel/95 backdrop-blur-md border-t border-panel-border flex flex-col">
      <div className="px-4 py-2 border-b border-panel-border flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-white">Data View</h2>
        <button
          onClick={toggleBottomPanel}
          className="p-1 text-gray-400 hover:text-white hover:bg-navy-700 rounded-md transition-colors cursor-pointer"
        >
          <ChevronDown className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-auto p-3">
        <p className="text-xs text-gray-500">Device data table will appear here.</p>
      </div>
    </div>
  )
}
