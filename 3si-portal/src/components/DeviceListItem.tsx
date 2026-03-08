import { Battery, MapPin } from 'lucide-react'
import { cn } from '@/lib/cn'
import type { Device } from '@/stores/devices'

interface Props {
  device: Device
  selected: boolean
  onClick: () => void
}

export function DeviceListItem({ device, selected, onClick }: Props) {
  const batteryValue = parseFloat(device.last_battery_voltage || '0')
  const isLowBattery = batteryValue > 0 && batteryValue < 3.5

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-2.5 rounded-lg transition-all cursor-pointer',
        selected
          ? 'bg-accent/20 border border-accent/40'
          : 'hover:bg-navy-700 border border-transparent'
      )}
    >
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white truncate">{device.name || device.number}</p>
          <p className="text-xs text-gray-400 truncate mt-0.5">{device.device_type}</p>
        </div>
        {isLowBattery && (
          <Battery className="w-4 h-4 text-alert-amber shrink-0 mt-0.5" />
        )}
      </div>
      <div className="flex items-center gap-3 mt-1.5">
        {device.location && (
          <span className="flex items-center gap-1 text-xs text-gray-500 truncate">
            <MapPin className="w-3 h-3 shrink-0" />
            {device.location}
          </span>
        )}
        {device.last_battery_voltage && (
          <span className="text-xs text-gray-500 shrink-0">{device.last_battery_voltage}</span>
        )}
      </div>
    </button>
  )
}
