import { X } from 'lucide-react'
import { useUI } from '@/stores/ui'

export function RightPanel() {
  const { rightPanelOpen, closeRightPanel } = useUI()

  if (!rightPanelOpen) return null

  return (
    <div className="h-full w-80 bg-panel/95 backdrop-blur-md border-l border-panel-border flex flex-col">
      <div className="p-3 border-b border-panel-border flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Details</h2>
        <button
          onClick={closeRightPanel}
          className="p-1 text-gray-400 hover:text-white hover:bg-navy-700 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        <p className="text-xs text-gray-500">Select a device to view details.</p>
      </div>
    </div>
  )
}
