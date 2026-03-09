import { Loader2 } from 'lucide-react'
import { useMapDevices } from '@/stores/mapDevices'

export function MapLoadingIndicator() {
  const { loading, loaded, allDevices } = useMapDevices()

  if (!loading) return null

  const count = allDevices.length

  return (
    <div className="flex items-center gap-2 bg-panel/90 backdrop-blur-md border border-panel-border rounded-lg px-3 py-1.5">
      <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
      <span className="text-xs text-gray-300">
        {loaded && count > 0
          ? `Loading devices... ${count.toLocaleString()} on map`
          : 'Loading device locations...'}
      </span>
    </div>
  )
}
