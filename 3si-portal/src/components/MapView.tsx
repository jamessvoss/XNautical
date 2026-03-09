import { useEffect, useRef, useMemo } from 'react'
import maplibregl from 'maplibre-gl'
import { useUI } from '@/stores/ui'
import { useDevices } from '@/stores/devices'
import { useMapDevices } from '@/stores/mapDevices'
import { useFavorites } from '@/stores/favorites'

const VECTOR_STYLES: Record<string, string> = {
  streets: 'https://tiles.openfreemap.org/styles/liberty',
  dark: 'https://tiles.openfreemap.org/styles/dark',
}

const RASTER_STYLES: Record<string, maplibregl.StyleSpecification> = {
  satellite: {
    version: 8,
    sources: {
      'esri-satellite': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxzoom: 19,
      },
      'esri-boundaries': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
      },
    },
    layers: [
      { id: 'satellite-tiles', type: 'raster', source: 'esri-satellite' },
      { id: 'boundary-tiles', type: 'raster', source: 'esri-boundaries' },
    ],
  },
  terrain: {
    version: 8,
    sources: {
      'esri-topo': {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        attribution: '&copy; Esri, HERE, Garmin, OpenStreetMap contributors',
        maxzoom: 19,
      },
    },
    layers: [{ id: 'topo-tiles', type: 'raster', source: 'esri-topo' }],
  },
}

function getMapStyle(style: string): string | maplibregl.StyleSpecification {
  if (style in RASTER_STYLES) return RASTER_STYLES[style]
  return VECTOR_STYLES[style] || VECTOR_STYLES.streets
}

const DEVICE_SOURCE = 'device-markers'
const DEVICE_LAYER = 'device-circles'
const CLUSTER_LAYER = 'clusters'
const CLUSTER_COUNT_LAYER = 'cluster-count'
// Separate source/layer for special devices that should never be clustered
const SPECIAL_SOURCE = 'special-markers'
const SPECIAL_LAYER = 'special-circles'

function isSpecialDevice(d: any, activeNumbers: Set<string>): boolean {
  const dnaMsg = Array.isArray(d.dna_message) ? d.dna_message.join(' ') : (d.dna_message || '')
  return activeNumbers.has(d.number || '') || d.device_needs_attention || dnaMsg.includes('CHARGE BATTERY')
}

function buildDeviceFeature(d: any, activeNumbers: Set<string>): GeoJSON.Feature {
  const dnaMsg = Array.isArray(d.dna_message) ? d.dna_message.join(' ') : (d.dna_message || '')
  return {
    type: 'Feature' as const,
    geometry: {
      type: 'Point' as const,
      coordinates: [Number(d.lon), Number(d.lat)],
    },
    properties: {
      name: d.name || '',
      number: d.number || '',
      type: d.deviceType || '',
      battery: d.batteryVoltage != null ? String(d.batteryVoltage) : '',
      isActive: activeNumbers.has(d.number || ''),
      needsAttention: d.device_needs_attention || dnaMsg.includes('CHARGE BATTERY'),
    },
  }
}

function buildGeoJSON(devices: any[], activeNumbers: Set<string>): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: devices.map((d) => buildDeviceFeature(d, activeNumbers)),
  }
}

function addLayers(map: maplibregl.Map, clustered: boolean) {
  // Remove existing layers/sources
  for (const id of [SPECIAL_LAYER, CLUSTER_COUNT_LAYER, CLUSTER_LAYER, DEVICE_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id)
  }
  if (map.getSource(DEVICE_SOURCE)) map.removeSource(DEVICE_SOURCE)
  if (map.getSource(SPECIAL_SOURCE)) map.removeSource(SPECIAL_SOURCE)

  const sourceOptions: maplibregl.GeoJSONSourceSpecification = {
    type: 'geojson',
    data: { type: 'FeatureCollection', features: [] },
  }

  if (clustered) {
    sourceOptions.cluster = true
    sourceOptions.clusterMaxZoom = 12
    sourceOptions.clusterRadius = 50
  }

  map.addSource(DEVICE_SOURCE, sourceOptions)

  // In clustered mode, add a separate unclustered source for special devices
  if (clustered) {
    map.addSource(SPECIAL_SOURCE, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    })
  }

  if (clustered) {
    map.addLayer({
      id: CLUSTER_LAYER,
      type: 'circle',
      source: DEVICE_SOURCE,
      filter: ['has', 'point_count'],
      paint: {
        'circle-color': [
          'step', ['get', 'point_count'],
          '#3b82f6', 100, '#2563eb', 500, '#1d4ed8',
        ],
        'circle-radius': [
          'step', ['get', 'point_count'],
          18, 100, 24, 500, 30,
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.85,
      },
    })

    map.addLayer({
      id: CLUSTER_COUNT_LAYER,
      type: 'symbol',
      source: DEVICE_SOURCE,
      filter: ['has', 'point_count'],
      layout: { 'text-field': '{point_count_abbreviated}', 'text-size': 12 },
      paint: { 'text-color': '#ffffff' },
    })
  }

  // Normal device layer (unclustered singles from the clustered source)
  const deviceLayerSpec: maplibregl.LayerSpecification = {
    id: DEVICE_LAYER,
    type: 'circle',
    source: DEVICE_SOURCE,
    paint: {
      'circle-radius': 6,
      'circle-color': '#3b82f6',
      'circle-stroke-width': 2,
      'circle-stroke-color': '#ffffff',
      'circle-opacity': 0.9,
    },
  }

  if (clustered) {
    deviceLayerSpec.filter = ['!', ['has', 'point_count']]
  } else {
    // In all-pins mode, color by status
    ;(deviceLayerSpec.paint as any)['circle-color'] = [
      'case',
      ['get', 'isActive'], '#ef4444',
      ['get', 'needsAttention'], '#f59e0b',
      '#3b82f6',
    ]
  }

  map.addLayer(deviceLayerSpec)

  // Special devices layer — always unclustered, rendered on top
  if (clustered) {
    map.addLayer({
      id: SPECIAL_LAYER,
      type: 'circle',
      source: SPECIAL_SOURCE,
      paint: {
        'circle-radius': 7,
        'circle-color': [
          'case',
          ['get', 'isActive'], '#ef4444',
          ['get', 'needsAttention'], '#f59e0b',
          '#3b82f6',
        ],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 1,
      },
    })
  }
}

/** Set data on both sources, splitting special devices out when clustered */
function setSourceData(map: maplibregl.Map, devices: any[], activeNumbers: Set<string>, clustered: boolean) {
  if (clustered) {
    const normal = devices.filter((d) => !isSpecialDevice(d, activeNumbers))
    const special = devices.filter((d) => isSpecialDevice(d, activeNumbers))

    const mainSource = map.getSource(DEVICE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (mainSource) mainSource.setData(buildGeoJSON(normal, activeNumbers))

    const specialSource = map.getSource(SPECIAL_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (specialSource) specialSource.setData(buildGeoJSON(special, activeNumbers))
  } else {
    const source = map.getSource(DEVICE_SOURCE) as maplibregl.GeoJSONSource | undefined
    if (source) source.setData(buildGeoJSON(devices, activeNumbers))
  }
}

export function MapView() {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const mapStyle = useUI((s) => s.mapStyle)
  const mapMode = useUI((s) => s.mapMode)
  const mapFilter = useUI((s) => s.mapFilter)
  const { selectMapDevice, selectedDevice } = useDevices()
  const { allDevices, activeNumbers, loaded, fetchAllMapDevices } = useMapDevices()
  const { favorites } = useFavorites()
  // Keep a ref to allDevices so the map click handler always sees current data
  const allDevicesRef = useRef(allDevices)
  allDevicesRef.current = allDevices

  // Filter devices based on active filter chip
  const filteredDevices = useMemo(() => {
    switch (mapFilter) {
      case 'active':
        return allDevices.filter((d) => activeNumbers.has(d.number || ''))
      case 'attention':
        return allDevices.filter((d) => d.device_needs_attention)
      case 'low-battery':
        return allDevices.filter((d) => {
          const msg = Array.isArray(d.dna_message) ? d.dna_message.join(' ') : (d.dna_message || '')
          return msg.includes('CHARGE BATTERY')
        })
      case 'favorites':
        return allDevices.filter((d) => favorites.has(d.number || ''))
      default:
        return allDevices
    }
  }, [allDevices, activeNumbers, favorites, mapFilter])

  // Fetch map device data on mount (always refresh in background, cache shows instantly)
  useEffect(() => {
    fetchAllMapDevices()
  }, [])

  // Initialize map
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: getMapStyle(mapStyle),
      center: [-98.5, 39.8],
      zoom: 4,
    })

    map.addControl(new maplibregl.NavigationControl(), 'bottom-right')

    map.on('load', () => {
      addLayers(map, mapMode === 'clustered')

      // Click handler for clusters — zoom in
      map.on('click', CLUSTER_LAYER, (e) => {
        const features = map.queryRenderedFeatures(e.point, { layers: [CLUSTER_LAYER] })
        if (!features.length) return
        const clusterId = features[0].properties?.cluster_id
        const source = map.getSource(DEVICE_SOURCE) as maplibregl.GeoJSONSource
        source.getClusterExpansionZoom(clusterId).then((zoom: number) => {
          map.easeTo({
            center: (features[0].geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          })
        })
      })

      // Click handler for special device markers (unclustered active/DNA/low-battery)
      map.on('click', SPECIAL_LAYER, (e) => {
        if (!e.features || e.features.length === 0) return
        const props = e.features[0].properties
        const deviceNumber = props?.number || ''
        const device = allDevicesRef.current.find((d) => d.number === deviceNumber)
        if (device) selectMapDevice(device)
      })

      // Click handler for device markers — select device directly into right panel
      map.on('click', DEVICE_LAYER, (e) => {
        if (!e.features || e.features.length === 0) return
        const props = e.features[0].properties
        const deviceNumber = props?.number || ''

        // Find full device data from store and pass the complete MapDevice
        const device = allDevicesRef.current.find((d) => d.number === deviceNumber)
        if (device) {
          selectMapDevice(device)
        }
      })

      // Cursor changes
      for (const layer of [DEVICE_LAYER, CLUSTER_LAYER, SPECIAL_LAYER]) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
      }
    })

    mapRef.current = map
    requestAnimationFrame(() => map.resize())

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  // Switch between clustered / all-pins mode
  useEffect(() => {
    const map = mapRef.current
    if (!map || !map.isStyleLoaded()) return

    addLayers(map, mapMode === 'clustered')

    // Re-apply data
    if (filteredDevices.length > 0) {
      setSourceData(map, filteredDevices, activeNumbers, mapMode === 'clustered')
    }
  }, [mapMode])

  // Update map style — re-add layers and re-apply device data after style swap
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const restoreAfterStyle = () => {
      // Wait until style is truly ready before adding layers
      const tryRestore = () => {
        if (!map.isStyleLoaded()) {
          requestAnimationFrame(tryRestore)
          return
        }

        addLayers(map, mapMode === 'clustered')

        if (filteredDevices.length > 0) {
          setSourceData(map, filteredDevices, activeNumbers, mapMode === 'clustered')
        }
      }

      tryRestore()
    }

    map.once('style.load', restoreAfterStyle)
    map.setStyle(getMapStyle(mapStyle))
  }, [mapStyle])

  // Update device markers when data or filter changes
  useEffect(() => {
    const map = mapRef.current
    if (!map || !loaded) return

    const updateSource = () => {
      setSourceData(map, filteredDevices, activeNumbers, mapMode === 'clustered')
    }

    if (map.isStyleLoaded()) {
      updateSource()
    } else {
      map.once('load', updateSource)
    }
  }, [filteredDevices, activeNumbers, loaded])

  // Fly to selected device
  const selectedMapDevice = useDevices((s) => s.selectedMapDevice)
  useEffect(() => {
    const map = mapRef.current
    // Determine which device to fly to
    const phoneNumber = selectedMapDevice?.number || selectedDevice?.['Phone Number']
    if (!map || !phoneNumber) return

    const device = allDevices.find((d) => d.number === phoneNumber)
    if (device) {
      const lat = Number(device.lat)
      const lon = Number(device.lon)
      if (!isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)) {
        map.flyTo({ center: [lon, lat], zoom: 14, duration: 1500 })
      }
    }
  }, [selectedDevice, selectedMapDevice, allDevices])

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" style={{ minHeight: '100%' }} />
}
