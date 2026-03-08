import { useEffect } from 'react'
import { ChevronLeft, ChevronRight, Satellite, Loader2, ChevronUp, ChevronDown } from 'lucide-react'
import { useUI } from '@/stores/ui'
import { useDevices } from '@/stores/devices'
import { DeviceListItem } from '@/components/DeviceListItem'

export function LeftPanel() {
  const { leftPanelOpen, toggleLeftPanel, openRightPanel } = useUI()
  const { devices, total, loading, error, offset, limit, selectedDevice, fetchDevices, selectDevice } = useDevices()

  useEffect(() => {
    fetchDevices()
  }, [])

  function handleSelectDevice(device: typeof selectedDevice) {
    selectDevice(device)
    openRightPanel()
  }

  function handlePrev() {
    if (offset > 0) fetchDevices(Math.max(0, offset - limit), limit)
  }

  function handleNext() {
    if (offset + limit < total) fetchDevices(offset + limit, limit)
  }

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
          {/* Header */}
          <div className="p-3 border-b border-panel-border">
            <h2 className="text-sm font-semibold text-white flex items-center gap-2">
              <Satellite className="w-4 h-4 text-accent" />
              Devices
              {total > 0 && (
                <span className="text-xs text-gray-400 font-normal">({total.toLocaleString()})</span>
              )}
            </h2>
          </div>

          {/* Device list */}
          <div className="flex-1 overflow-y-auto p-2">
            {loading && devices.length === 0 && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-5 h-5 text-accent animate-spin" />
              </div>
            )}

            {error && (
              <div className="p-2 text-xs text-alert-red">{error}</div>
            )}

            {devices.map((device) => (
              <DeviceListItem
                key={device.number || device.name}
                device={device}
                selected={selectedDevice?.number === device.number}
                onClick={() => handleSelectDevice(device)}
              />
            ))}
          </div>

          {/* Pagination */}
          {total > limit && (
            <div className="p-2 border-t border-panel-border flex items-center justify-between text-xs text-gray-400">
              <button
                onClick={handlePrev}
                disabled={offset === 0}
                className="p-1 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
              >
                <ChevronUp className="w-4 h-4" />
              </button>
              <span>{offset + 1}-{Math.min(offset + limit, total)} of {total.toLocaleString()}</span>
              <button
                onClick={handleNext}
                disabled={offset + limit >= total}
                className="p-1 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
              >
                <ChevronDown className="w-4 h-4" />
              </button>
            </div>
          )}
        </>
      ) : (
        <div className="flex flex-col items-center pt-14 gap-3">
          <Satellite className="w-5 h-5 text-gray-400" />
        </div>
      )}
    </div>
  )
}
