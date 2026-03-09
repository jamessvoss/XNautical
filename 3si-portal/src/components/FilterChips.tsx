import { Satellite, AlertTriangle, AlertCircle, Battery, Star } from 'lucide-react'
import { useUI, type MapFilter } from '@/stores/ui'
import { useMapDevices } from '@/stores/mapDevices'
import { useFavorites } from '@/stores/favorites'
import { cn } from '@/lib/cn'

const FILTERS: { id: MapFilter; label: string; icon: any; color: string }[] = [
  { id: 'all', label: 'All Devices', icon: Satellite, color: 'bg-accent' },
  { id: 'active', label: 'Active', icon: AlertTriangle, color: 'bg-alert-red' },
  { id: 'attention', label: 'Needs Attention', icon: AlertCircle, color: 'bg-purple-500' },
  { id: 'low-battery', label: 'Low Battery', icon: Battery, color: 'bg-alert-amber' },
  { id: 'favorites', label: 'Favorites', icon: Star, color: 'bg-yellow-500' },
]

export function FilterChips() {
  const { mapFilter, setMapFilter } = useUI()
  const { allDevices, activeNumbers } = useMapDevices()
  const { favorites } = useFavorites()

  // Compute counts for each filter
  const counts: Record<MapFilter, number> = {
    all: allDevices.length,
    active: allDevices.filter((d) => activeNumbers.has(d.number || '')).length,
    attention: allDevices.filter((d) => d.device_needs_attention).length,
    'low-battery': allDevices.filter((d) => {
      const msg = Array.isArray(d.dna_message) ? d.dna_message.join(' ') : (d.dna_message || '')
      return msg.includes('CHARGE BATTERY')
    }).length,
    favorites: allDevices.filter((d) => favorites.has(d.number || '')).length,
  }

  return (
    <div className="flex gap-1.5 bg-panel/90 backdrop-blur-md border border-panel-border rounded-full px-2 py-1.5">
      {FILTERS.map(({ id, label, icon: Icon, color }) => (
        <button
          key={id}
          onClick={() => setMapFilter(id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer',
            mapFilter === id
              ? `${color} text-white shadow-lg`
              : 'text-gray-400 hover:text-white hover:bg-navy-700'
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{label}</span>
          {counts[id] > 0 && id !== 'all' && (
            <span className={cn(
              'text-[10px] px-1.5 py-0.5 rounded-full',
              mapFilter === id ? 'bg-white/20' : 'bg-navy-600'
            )}>
              {counts[id].toLocaleString()}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
