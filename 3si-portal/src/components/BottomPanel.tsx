import { useEffect } from 'react'
import { ChevronDown, Download, Loader2 } from 'lucide-react'
import { useUI } from '@/stores/ui'
import { useDevices, type Device } from '@/stores/devices'
import { cn } from '@/lib/cn'

const COLUMNS = [
  { key: 'Name', label: 'Name', width: 'w-48' },
  { key: 'Phone Number', label: 'Number', width: 'w-36' },
  { key: 'Device Type', label: 'Type', width: 'w-40' },
  { key: 'Home Location', label: 'Location', width: 'w-48' },
  { key: 'Battery(V)', label: 'Battery', width: 'w-24' },
  { key: 'Last Location Fix', label: 'Last Seen', width: 'w-40' },
  { key: 'Configuration', label: 'Configuration', width: 'w-36' },
] as const

export function BottomPanel() {
  const { bottomPanelOpen, toggleBottomPanel, openRightPanel } = useUI()
  const { devices, total, loading, offset, limit, selectedDevice, fetchDevices, selectDevice } = useDevices()

  useEffect(() => {
    if (bottomPanelOpen && devices.length === 0) {
      fetchDevices()
    }
  }, [bottomPanelOpen])

  if (!bottomPanelOpen) return null

  function handleRowClick(device: Device) {
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
    <div className="h-full bg-panel/95 backdrop-blur-md border-t border-panel-border flex flex-col">
      {/* Header */}
      <div className="px-4 py-2 border-b border-panel-border flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold text-white">Devices</h2>
          {total > 0 && (
            <span className="text-xs text-gray-400">
              {offset + 1}-{Math.min(offset + limit, total)} of {total.toLocaleString()}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Pagination */}
          <button
            onClick={handlePrev}
            disabled={offset === 0}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            Prev
          </button>
          <button
            onClick={handleNext}
            disabled={offset + limit >= total}
            className="px-2 py-1 text-xs text-gray-400 hover:text-white disabled:opacity-30 cursor-pointer disabled:cursor-default"
          >
            Next
          </button>

          <div className="w-px h-4 bg-panel-border mx-1" />

          {/* Export */}
          <button className="flex items-center gap-1 px-2 py-1 text-xs text-gray-400 hover:text-white cursor-pointer" title="Export CSV">
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>

          <div className="w-px h-4 bg-panel-border mx-1" />

          <button
            onClick={toggleBottomPanel}
            className="p-1 text-gray-400 hover:text-white hover:bg-navy-700 rounded-md transition-colors cursor-pointer"
          >
            <ChevronDown className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading && devices.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-navy-800">
              <tr>
                {COLUMNS.map(({ key, label, width }) => (
                  <th
                    key={key}
                    className={`${width} px-3 py-2 text-left text-xs font-medium text-gray-400 uppercase tracking-wider cursor-pointer hover:text-white`}
                  >
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-panel-border">
              {devices.map((device, i) => (
                <tr
                  key={device.IMEI || device.Name || i}
                  onClick={() => handleRowClick(device)}
                  className={cn(
                    'cursor-pointer transition-colors',
                    selectedDevice?.IMEI === device.IMEI
                      ? 'bg-accent/10'
                      : 'hover:bg-navy-700/50'
                  )}
                >
                  {COLUMNS.map(({ key }) => (
                    <td key={key} className="px-3 py-2 text-white whitespace-nowrap truncate max-w-48">
                      {device[key] || ''}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
