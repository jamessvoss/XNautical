import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { useUI } from '@/stores/ui'
import { useAlerts, type AlertDevice } from '@/stores/alerts'
import { useDevices } from '@/stores/devices'
import { renderDevicePopupHTML } from '@/components/DevicePopup'

const STYLES: Record<string, string> = {
  streets: 'https://tiles.openfreemap.org/styles/liberty',
  satellite: 'https://tiles.openfreemap.org/styles/liberty',
  terrain: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

const DEVICE_SOURCE = 'device-markers'
const DEVICE_LAYER = 'device-circles'

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const popupRef = useRef<maplibregl.Popup | null>(null)
  const mapStyle = useUI((s) => s.mapStyle)
  const alertDevices = useAlerts((s) => s.alertDevices)
  const { selectDevice, selectedDevice } = useDevices()
  const openRightPanel = useUI((s) => s.openRightPanel)

  // Handle "Details" button clicks from popups
  useEffect(() => {
    function handleDetail(e: Event) {
      const number = (e as CustomEvent).detail
      const device = alertDevices.find((d) => d.number === number)
      if (device) {
        selectDevice({
          name: device.name,
          number: device.number,
          device_type: device.type || '',
          vessel: '',
          location: '',
          last_battery_voltage: '',
          last_point_time: '',
          configuration: '',
        })
        openRightPanel()
      }
    }
    window.addEventListener('device-detail', handleDetail)
    return () => window.removeEventListener('device-detail', handleDetail)
  }, [alertDevices, selectDevice, openRightPanel])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLES[mapStyle] || STYLES.streets,
      center: [-98.5, 39.8],
      zoom: 4,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')

    map.on('load', () => {
      // Add empty source
      map.addSource(DEVICE_SOURCE, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] },
      })

      // Normal device circles (blue)
      map.addLayer({
        id: DEVICE_LAYER,
        type: 'circle',
        source: DEVICE_SOURCE,
        paint: {
          'circle-radius': 7,
          'circle-color': [
            'case',
            ['get', 'isActive'], '#ef4444',
            ['get', 'isLowBattery'], '#f59e0b',
            '#3b82f6',
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#ffffff',
          'circle-opacity': 0.9,
        },
      })

      // Click handler for device markers
      map.on('click', DEVICE_LAYER, (e) => {
        if (!e.features || e.features.length === 0) return
        const feature = e.features[0]
        const coords = (feature.geometry as GeoJSON.Point).coordinates.slice() as [number, number]
        const props = feature.properties

        // Remove existing popup
        popupRef.current?.remove()

        const popup = new maplibregl.Popup({ offset: 15, closeButton: true })
          .setLngLat(coords)
          .setHTML(
            renderDevicePopupHTML({
              name: props?.name || '',
              number: props?.number || '',
              type: props?.type || '',
              battery: props?.battery || '',
            })
          )
          .addTo(map)

        popupRef.current = popup
      })

      // Cursor change on hover
      map.on('mouseenter', DEVICE_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', DEVICE_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })
    })

    mapRef.current = map

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Update map style
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    map.once('styledata', () => {
      // Re-add source and layers after style change
      if (!map.getSource(DEVICE_SOURCE)) {
        map.addSource(DEVICE_SOURCE, {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] },
        })
        map.addLayer({
          id: DEVICE_LAYER,
          type: 'circle',
          source: DEVICE_SOURCE,
          paint: {
            'circle-radius': 7,
            'circle-color': [
              'case',
              ['get', 'isActive'], '#ef4444',
              ['get', 'isLowBattery'], '#f59e0b',
              '#3b82f6',
            ],
            'circle-stroke-width': 2,
            'circle-stroke-color': '#ffffff',
            'circle-opacity': 0.9,
          },
        })
      }
    })

    map.setStyle(STYLES[mapStyle] || STYLES.streets)
  }, [mapStyle])

  // Update device markers when alert data changes
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Build GeoJSON from alert devices that have GPS coordinates
    // The alert data may include lat/lng — we'll use them if available
    // For now, create features from devices that have coordinate data
    const features: GeoJSON.Feature[] = alertDevices
      .filter((d: AlertDevice) => {
        // Check if device has any coordinate-like properties
        const lat = parseFloat((d as any).latitude || (d as any).lat || '0')
        const lng = parseFloat((d as any).longitude || (d as any).lng || (d as any).lon || '0')
        return lat !== 0 && lng !== 0
      })
      .map((d: AlertDevice) => {
        const lat = parseFloat((d as any).latitude || (d as any).lat || '0')
        const lng = parseFloat((d as any).longitude || (d as any).lng || (d as any).lon || '0')
        return {
          type: 'Feature' as const,
          geometry: {
            type: 'Point' as const,
            coordinates: [lng, lat],
          },
          properties: {
            name: d.name,
            number: d.number,
            type: d.type || '',
            battery: '',
            isActive: d.tracking || d.dam,
            isLowBattery: false,
          },
        }
      })

    const geojson: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features,
    }

    // Update the source if it exists
    const source = map.getSource(DEVICE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (source) {
      source.setData(geojson)
    }
  }, [alertDevices])

  // Fly to selected device
  useEffect(() => {
    const map = mapRef.current
    if (!map || !selectedDevice) return

    // Try to find the device in alert data to get coordinates
    const alertDevice = alertDevices.find((d) => d.number === selectedDevice.number)
    if (alertDevice) {
      const lat = parseFloat((alertDevice as any).latitude || (alertDevice as any).lat || '0')
      const lng = parseFloat((alertDevice as any).longitude || (alertDevice as any).lng || (alertDevice as any).lon || '0')
      if (lat !== 0 && lng !== 0) {
        map.flyTo({ center: [lng, lat], zoom: 14, duration: 1500 })
      }
    }
  }, [selectedDevice, alertDevices])

  return <div ref={containerRef} className="absolute inset-0" />
}
