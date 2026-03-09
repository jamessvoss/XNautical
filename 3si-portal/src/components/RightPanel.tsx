import {
  Satellite, MapPin, Battery, Clock, Radio, Navigation, History,
  ArrowRightLeft, Star, AlertTriangle, Shield, Cpu,
  Compass, Gauge, Loader2, Copy, Check,
} from 'lucide-react'
import { useState } from 'react'
import { useDevices } from '@/stores/devices'
import { useMapDevices, type MapDevice } from '@/stores/mapDevices'
import { useFavorites } from '@/stores/favorites'
import { useDevicePosition } from '@/stores/devicePosition'
import { formatRelativeTime } from '@/lib/time'
import { cn } from '@/lib/cn'

export function RightPanel() {
  const { selectedDevice, selectedMapDevice } = useDevices()
  const { activeNumbers } = useMapDevices()
  const { isFavorite, toggleFavorite } = useFavorites()

  // Derive a unified device view
  const device = selectedMapDevice || null
  const legacyDevice = selectedDevice
  const hasDevice = !!(device || legacyDevice)

  const phoneNumber = device?.number || legacyDevice?.['Phone Number'] || ''
  const favorited = phoneNumber ? isFavorite(phoneNumber) : false

  // Determine status
  const isActive = device ? activeNumbers.has(device.number || '') : false
  const needsAttention = device?.device_needs_attention || false

  return (
    <div className="h-full w-80 bg-panel/95 backdrop-blur-md border-l border-panel-border flex flex-col">
      <div className="p-3 border-b border-panel-border shrink-0 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Device Details</h2>
        {hasDevice && phoneNumber && (
          <button
            onClick={() => toggleFavorite(phoneNumber)}
            className="p-1 rounded-md transition-colors cursor-pointer hover:bg-navy-700"
            title={favorited ? 'Remove from favorites' : 'Add to favorites'}
          >
            <Star className={cn('w-4 h-4', favorited ? 'text-yellow-400 fill-yellow-400' : 'text-gray-500')} />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {hasDevice ? (
          device ? (
            <MapDeviceDetails device={device} isActive={isActive} needsAttention={needsAttention} />
          ) : legacyDevice ? (
            <LegacyDeviceDetails device={legacyDevice} />
          ) : null
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

// Full-featured view for map device data (all fields available)
function MapDeviceDetails({ device, isActive, needsAttention }: {
  device: MapDevice
  isActive: boolean
  needsAttention: boolean
}) {
  const dnaMessages = Array.isArray(device.dna_message)
    ? device.dna_message
    : device.dna_message ? [device.dna_message] : []
  const alertMessage = device.alertMessage || ''
  const hasAlerts = !!(alertMessage || dnaMessages.length > 0 || needsAttention)

  return (
    <div className="p-3 space-y-0">
      {/* Header */}
      <div className="mb-2">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-bold text-white truncate">{device.name || 'Unknown'}</h3>
            <p className="text-xs text-gray-400">{device.deviceType || 'Device'}</p>
          </div>
          <StatusDot isActive={isActive} needsAttention={needsAttention} />
        </div>
      </div>

      {/* Alerts Section */}
      {hasAlerts && (
        <div className={cn(
          'px-2.5 py-2 rounded-lg mb-2',
          isActive ? 'bg-alert-red/10 border border-alert-red/30' : 'bg-alert-amber/10 border border-alert-amber/30'
        )}>
          <div className="flex items-start gap-2">
            <AlertTriangle className={cn('w-3.5 h-3.5 shrink-0 mt-0.5', isActive ? 'text-alert-red' : 'text-alert-amber')} />
            <div className="space-y-0.5 min-w-0">
              {alertMessage && (
                <p className={cn('text-xs font-medium', isActive ? 'text-alert-red' : 'text-alert-amber')}>{alertMessage}</p>
              )}
              {dnaMessages.map((msg: string, i: number) => (
                <p key={i} className="text-[11px] text-alert-amber">{String(msg)}</p>
              ))}
              {needsAttention && !alertMessage && dnaMessages.length === 0 && (
                <p className="text-xs font-medium text-alert-amber">Device needs attention</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Location & Status */}
      <Section label="Location & Status" icon={MapPin}>
        {device.lat != null && device.lon != null && (
          <CopyableRow label="Coordinates" value={`${Number(device.lat).toFixed(5)}, ${Number(device.lon).toFixed(5)}`} />
        )}
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <MiniRow label="Accuracy" value={device.position_error != null ? `±${device.position_error}m` : null} />
          <MiniRow
            label="Battery"
            value={device.lastBatteryCharge != null ? `${device.lastBatteryCharge}V` : (device.batteryVoltage != null ? `${device.batteryVoltage}V` : null)}
            highlight={isLowBattery(device.lastBatteryCharge ?? device.batteryVoltage)}
          />
          <MiniRow
            label="Last Fix"
            value={device.last_location_fix ? formatRelativeTime(device.last_location_fix) : null}
          />
          <MiniRow label="Home" value={device.locationName} />
        </div>
      </Section>

      {/* Position Details (on-demand) */}
      <PositionSection deviceNumber={device.number || ''} />

      {/* Identity */}
      <Section label="Identity" icon={Shield}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <MiniRow label="Phone" value={device.number} />
          <MiniRow label="IMEI" value={device.imei} />
          <MiniRow label="Serial #" value={device.serialNumbers} />
          <MiniRow label="Vessel SN" value={device.vesselSerialNumber} />
          <MiniRow label="Vessel" value={device.vessel} />
          <MiniRow label="Owner Group" value={device.ownerGroup} />
        </div>
      </Section>

      {/* Configuration */}
      <Section label="Configuration" icon={Cpu}>
        <div className="grid grid-cols-2 gap-x-3 gap-y-1">
          <MiniRow label="Config" value={device.configuration} />
          <MiniRow label="Firmware" value={device.firmwareVersion} />
          <MiniRow label="Beacon Freq" value={device.beaconFrequency} />
          {device.beaconEnabled != null && (
            <div className="min-w-0">
              <p className="text-[10px] text-gray-500">Beacon</p>
              <span className={cn(
                'text-[10px] px-1.5 py-0.5 rounded-full font-medium',
                device.beaconEnabled ? 'bg-healthy-green/20 text-healthy-green' : 'bg-gray-600 text-gray-400'
              )}>
                {device.beaconEnabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
          )}
        </div>
      </Section>

      {/* Action Buttons — compact horizontal row */}
      <div className="pt-2 flex gap-1.5">
        <ActionButton icon={Navigation} label="Track" color="bg-accent hover:bg-accent-hover" />
        <ActionButton icon={History} label="History" color="bg-navy-600 hover:bg-navy-700" />
        <ActionButton icon={ArrowRightLeft} label="Relocate" color="bg-navy-600 hover:bg-navy-700" />
      </div>
    </div>
  )
}

// Fallback for legacy left-panel device selections (limited fields)
function LegacyDeviceDetails({ device }: { device: Record<string, string | undefined> }) {
  return (
    <div className="p-4">
      <div className="mb-4">
        <h3 className="text-lg font-bold text-white">{device.Name}</h3>
        <p className="text-sm text-gray-400 mt-0.5">{device['Device Type']}</p>
      </div>
      <div className="space-y-3">
        <DetailRow icon={Satellite} label="Phone Number" value={device['Phone Number']} />
        <DetailRow icon={Radio} label="Configuration" value={device.Configuration} />
        <DetailRow icon={MapPin} label="Home Location" value={device['Home Location']} />
        <DetailRow icon={Battery} label="Battery" value={device['Battery(V)']} highlight={isLowBattery(device['Battery(V)'])} />
        <DetailRow icon={Clock} label="Last Location Fix" value={device['Last Location Fix']} />
        <DetailRow icon={Satellite} label="Vessel" value={device.Vessel} />
        <DetailRow icon={Radio} label="Beacon Frequency" value={device['Beacon Frequency']} />
        <DetailRow icon={Satellite} label="IMEI" value={device.IMEI} />
        <DetailRow icon={Satellite} label="Alert" value={device['Alert Message']} />
      </div>
      <div className="mt-6 space-y-2">
        <ActionButton icon={Navigation} label="Track on Map" color="bg-accent hover:bg-accent-hover" />
        <ActionButton icon={History} label="View History" color="bg-navy-600 hover:bg-navy-700" />
        <ActionButton icon={ArrowRightLeft} label="Relocate" color="bg-navy-600 hover:bg-navy-700" />
      </div>
    </div>
  )
}

// On-demand position data section
function PositionSection({ deviceNumber }: { deviceNumber: string }) {
  const { getPosition, fetchPosition, loading } = useDevicePosition()
  const position = deviceNumber ? getPosition(deviceNumber) : null
  const isLoading = loading === deviceNumber

  if (!deviceNumber) return null

  if (!position && !isLoading) {
    return (
      <div className="py-2 border-b border-panel-border">
        <button
          onClick={() => fetchPosition(deviceNumber)}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-1.5 bg-navy-700 hover:bg-navy-600 text-gray-300 text-[11px] font-medium rounded-md transition-colors cursor-pointer"
        >
          <Gauge className="w-3 h-3" />
          Load Position Details
        </button>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="py-2 border-b border-panel-border flex items-center justify-center gap-2 text-gray-500 text-xs">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Loading position data...
      </div>
    )
  }

  const point = position?.point
  const track = position?.track

  return (
    <Section label="Position Details" icon={Gauge}>
      {point?.speed != null && (
        <DetailRow icon={Gauge} label="Speed" value={`${point.speed} km/h`} />
      )}
      {point?.heading != null && (
        <DetailRow icon={Compass} label="Heading" value={`${point.heading}°`} />
      )}
      {point?.batteryPercentage != null && (
        <div className="flex items-start gap-3">
          <Battery className="w-4 h-4 mt-0.5 shrink-0 text-gray-500" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-gray-500">Battery</p>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex-1 h-1.5 bg-navy-700 rounded-full overflow-hidden">
                <div
                  className={cn(
                    'h-full rounded-full',
                    point.batteryPercentage > 50 ? 'bg-healthy-green' :
                    point.batteryPercentage > 20 ? 'bg-alert-amber' : 'bg-alert-red'
                  )}
                  style={{ width: `${Math.min(100, point.batteryPercentage)}%` }}
                />
              </div>
              <span className="text-xs text-white">{point.batteryPercentage}%</span>
            </div>
          </div>
        </div>
      )}
      {point?.solution_type && (
        <DetailRow icon={Satellite} label="Fix Type" value={point.solution_type} />
      )}
      {track?.type && (
        <DetailRow icon={Navigation} label="Track" value={[track.type, track.subtype].filter(Boolean).join(' / ')} />
      )}
    </Section>
  )
}

// --- Shared sub-components ---

function Section({ label, icon: Icon, children }: { label: string; icon: any; children: React.ReactNode }) {
  return (
    <div className="py-2 border-b border-panel-border">
      <div className="flex items-center gap-1.5 mb-1">
        <Icon className="w-3 h-3 text-gray-500" />
        <span className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">{label}</span>
      </div>
      <div className="space-y-1.5">
        {children}
      </div>
    </div>
  )
}

function StatusDot({ isActive, needsAttention }: { isActive: boolean; needsAttention: boolean }) {
  return (
    <div className="flex items-center gap-1.5 shrink-0 mt-1">
      <div className={cn(
        'w-2 h-2 rounded-full',
        isActive ? 'bg-alert-red' : needsAttention ? 'bg-alert-amber' : 'bg-accent'
      )} />
      <span className={cn(
        'text-[10px] font-medium',
        isActive ? 'text-alert-red' : needsAttention ? 'text-alert-amber' : 'text-gray-500'
      )}>
        {isActive ? 'Active' : needsAttention ? 'Attention' : 'Normal'}
      </span>
    </div>
  )
}

function DetailRow({ icon: Icon, label, value, highlight, title }: {
  icon: any
  label: string
  value?: string | number | null
  highlight?: boolean
  title?: string
}) {
  if (value == null || value === '') return null
  return (
    <div className="flex items-start gap-3">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${highlight ? 'text-alert-amber' : 'text-gray-500'}`} />
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p
          className={`text-sm ${highlight ? 'text-alert-amber font-medium' : 'text-white'}`}
          title={title}
        >
          {String(value)}
        </p>
      </div>
    </div>
  )
}

function MiniRow({ label, value, highlight }: { label: string; value?: string | null; highlight?: boolean }) {
  if (!value) return null
  return (
    <div className="min-w-0">
      <p className="text-[10px] text-gray-500">{label}</p>
      <p className={cn('text-xs truncate', highlight ? 'text-alert-amber font-medium' : 'text-white')} title={value}>{value}</p>
    </div>
  )
}

function CopyableRow({ value }: { label?: string; value: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div className="flex items-center gap-2">
      <MapPin className="w-3.5 h-3.5 shrink-0 text-gray-500" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="text-xs text-white font-mono">{value}</p>
          <button
            onClick={handleCopy}
            className="p-0.5 rounded hover:bg-navy-700 transition-colors cursor-pointer"
            title="Copy coordinates"
          >
            {copied
              ? <Check className="w-3 h-3 text-healthy-green" />
              : <Copy className="w-3 h-3 text-gray-500 hover:text-gray-300" />
            }
          </button>
        </div>
      </div>
    </div>
  )
}

function ActionButton({ icon: Icon, label, color }: { icon: any; label: string; color: string }) {
  return (
    <button className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 ${color} text-white text-[11px] font-medium rounded-md transition-colors cursor-pointer`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </button>
  )
}

function isLowBattery(voltage?: string | number | null): boolean {
  if (voltage == null) return false
  const v = typeof voltage === 'number' ? voltage : parseFloat(voltage)
  return v > 0 && v < 3.5
}
