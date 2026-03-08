import { Satellite, MapPin, AlertTriangle, Battery, Star } from 'lucide-react'
import { useState } from 'react'
import { cn } from '@/lib/cn'

const FILTERS = [
  { id: 'all', label: 'All Devices', icon: Satellite, color: 'bg-accent' },
  { id: 'active', label: 'Active', icon: AlertTriangle, color: 'bg-alert-red' },
  { id: 'locations', label: 'Locations', icon: MapPin, color: 'bg-purple-500' },
  { id: 'low-battery', label: 'Low Battery', icon: Battery, color: 'bg-alert-amber' },
  { id: 'favorites', label: 'Favorites', icon: Star, color: 'bg-yellow-500' },
] as const

export function FilterChips() {
  const [active, setActive] = useState<string>('all')

  return (
    <div className="flex gap-1.5 bg-panel/90 backdrop-blur-md border border-panel-border rounded-full px-2 py-1.5">
      {FILTERS.map(({ id, label, icon: Icon, color }) => (
        <button
          key={id}
          onClick={() => setActive(id)}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium transition-all cursor-pointer',
            active === id
              ? `${color} text-white shadow-lg`
              : 'text-gray-400 hover:text-white hover:bg-navy-700'
          )}
        >
          <Icon className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">{label}</span>
        </button>
      ))}
    </div>
  )
}
