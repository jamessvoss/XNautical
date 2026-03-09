import { Layers, MapPin } from 'lucide-react'
import { useUI } from '@/stores/ui'
import { cn } from '@/lib/cn'

export function MapModeToggle() {
  const { mapMode, setMapMode } = useUI()

  return (
    <div className="flex bg-panel/90 backdrop-blur-md border border-panel-border rounded-lg overflow-hidden">
      <button
        onClick={() => setMapMode('clustered')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all cursor-pointer',
          mapMode === 'clustered'
            ? 'bg-accent text-white'
            : 'text-gray-400 hover:text-white hover:bg-navy-700'
        )}
      >
        <Layers className="w-3.5 h-3.5" />
        Clustered
      </button>
      <button
        onClick={() => setMapMode('all')}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-all cursor-pointer',
          mapMode === 'all'
            ? 'bg-accent text-white'
            : 'text-gray-400 hover:text-white hover:bg-navy-700'
        )}
      >
        <MapPin className="w-3.5 h-3.5" />
        All Pins
      </button>
    </div>
  )
}
