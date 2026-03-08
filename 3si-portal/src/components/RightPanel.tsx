import { X, Satellite, MapPin, Battery, Clock, Radio, Navigation, History, ArrowRightLeft } from 'lucide-react'
import { useUI } from '@/stores/ui'
import { useDevices } from '@/stores/devices'

export function RightPanel() {
  const { rightPanelOpen, closeRightPanel } = useUI()
  const { selectedDevice } = useDevices()

  if (!rightPanelOpen) return null

  return (
    <div className="h-full w-80 bg-panel/95 backdrop-blur-md border-l border-panel-border flex flex-col">
      <div className="p-3 border-b border-panel-border flex items-center justify-between shrink-0">
        <h2 className="text-sm font-semibold text-white">Device Details</h2>
        <button
          onClick={closeRightPanel}
          className="p-1 text-gray-400 hover:text-white hover:bg-navy-700 rounded-md transition-colors cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {selectedDevice ? (
          <div className="p-4">
            {/* Device name */}
            <div className="mb-4">
              <h3 className="text-lg font-bold text-white">{selectedDevice.name || selectedDevice.number}</h3>
              <p className="text-sm text-gray-400 mt-0.5">{selectedDevice.device_type}</p>
            </div>

            {/* Info rows */}
            <div className="space-y-3">
              <DetailRow icon={Satellite} label="Number" value={selectedDevice.number} />
              <DetailRow icon={Radio} label="Configuration" value={selectedDevice.configuration} />
              <DetailRow icon={MapPin} label="Location" value={selectedDevice.location} />
              <DetailRow icon={Battery} label="Battery" value={selectedDevice.last_battery_voltage} highlight={isLowBattery(selectedDevice.last_battery_voltage)} />
              <DetailRow icon={Clock} label="Last Seen" value={selectedDevice.last_point_time} />
              <DetailRow icon={Satellite} label="Vessel" value={selectedDevice.vessel} />
            </div>

            {/* Action buttons */}
            <div className="mt-6 space-y-2">
              <ActionButton icon={Navigation} label="Track on Map" color="bg-accent hover:bg-accent-hover" />
              <ActionButton icon={History} label="View History" color="bg-navy-600 hover:bg-navy-700" />
              <ActionButton icon={ArrowRightLeft} label="Relocate" color="bg-navy-600 hover:bg-navy-700" />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-gray-500">
            <Satellite className="w-8 h-8 mb-2 opacity-50" />
            <p className="text-sm">Select a device to view details</p>
          </div>
        )}
      </div>
    </div>
  )
}

function DetailRow({ icon: Icon, label, value, highlight }: {
  icon: any
  label: string
  value?: string
  highlight?: boolean
}) {
  if (!value) return null
  return (
    <div className="flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${highlight ? 'text-alert-amber' : 'text-gray-500'}`} />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className={`text-sm ${highlight ? 'text-alert-amber font-medium' : 'text-white'}`}>{value}</p>
      </div>
    </div>
  )
}

function ActionButton({ icon: Icon, label, color }: { icon: any; label: string; color: string }) {
  return (
    <button className={`w-full flex items-center gap-2 px-3 py-2 ${color} text-white text-sm font-medium rounded-lg transition-colors cursor-pointer`}>
      <Icon className="w-4 h-4" />
      {label}
    </button>
  )
}

function isLowBattery(voltage?: string): boolean {
  if (!voltage) return false
  const v = parseFloat(voltage)
  return v > 0 && v < 3.5
}
