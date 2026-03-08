import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useUI } from '@/stores/ui'

const STYLES: Record<string, string> = {
  streets: 'https://tiles.openfreemap.org/styles/liberty',
  satellite: 'https://tiles.openfreemap.org/styles/liberty',
  terrain: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapStyle = useUI((s) => s.mapStyle)

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLES[mapStyle] || STYLES.streets,
      center: [-98.5, 39.8],
      zoom: 4,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')
    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!mapRef.current) return
    mapRef.current.setStyle(STYLES[mapStyle] || STYLES.streets)
  }, [mapStyle])

  return <div ref={containerRef} className="absolute inset-0" />
}
