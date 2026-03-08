import { Map, Satellite, Mountain, Moon } from 'lucide-react'
import { useUI } from '@/stores/ui'
import { cn } from '@/lib/cn'

const STYLES = [
  { id: 'streets' as const, label: 'Street', icon: Map },
  { id: 'satellite' as const, label: 'Satellite', icon: Satellite },
  { id: 'terrain' as const, label: 'Terrain', icon: Mountain },
  { id: 'dark' as const, label: 'Dark', icon: Moon },
]

export function MapStyleSelector() {
  const { mapStyle, setMapStyle } = useUI()

  return (
    <div className="flex flex-col gap-1 bg-panel/90 backdrop-blur-md border border-panel-border rounded-xl p-1.5">
      {STYLES.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          onClick={() => setMapStyle(id)}
          className={cn(
            'flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer',
            mapStyle === id
              ? 'bg-accent text-white'
              : 'text-gray-400 hover:text-white hover:bg-navy-700'
          )}
          title={label}
        >
          <Icon className="w-4 h-4" />
          <span>{label}</span>
        </button>
      ))}
    </div>
  )
}
