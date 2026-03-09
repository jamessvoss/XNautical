import { create } from 'zustand'
import { api } from '@/lib/api'

export interface MapDevice {
  id?: number
  imei?: string
  name?: string
  number?: string
  lat?: number | string
  lon?: number | string
  locationId?: string
  locationName?: string
  device_needs_attention?: boolean
  dna_message?: any
  isActive?: boolean
  last_location_fix?: string
  batteryVoltage?: number
  [key: string]: any
}

interface CachedData {
  allDevices: MapDevice[]
  activeNumbers: string[]
  timestamp: number
}

const CACHE_KEY = 'dtd_map_devices'
const CACHE_TTL = 10 * 60 * 1000 // 10 minutes

function loadCache(): { allDevices: MapDevice[]; activeNumbers: Set<string> } | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    if (!raw) return null
    const cached: CachedData = JSON.parse(raw)
    if (Date.now() - cached.timestamp > CACHE_TTL) {
      localStorage.removeItem(CACHE_KEY)
      return null
    }
    return {
      allDevices: cached.allDevices,
      activeNumbers: new Set(cached.activeNumbers),
    }
  } catch {
    return null
  }
}

function saveCache(allDevices: MapDevice[], activeNumbers: Set<string>) {
  try {
    const data: CachedData = {
      allDevices,
      activeNumbers: Array.from(activeNumbers),
      timestamp: Date.now(),
    }
    localStorage.setItem(CACHE_KEY, JSON.stringify(data))
  } catch {
    // Storage full or unavailable
  }
}

interface MapDeviceState {
  allDevices: MapDevice[]
  activeNumbers: Set<string>
  loading: boolean
  fetching: boolean
  error: string | null
  loaded: boolean
  totalWithCoords: number
  fetchAllMapDevices: () => Promise<void>
}

export const useMapDevices = create<MapDeviceState>((set, get) => {
  const cached = loadCache()

  return {
    allDevices: cached?.allDevices || [],
    activeNumbers: cached?.activeNumbers || new Set(),
    loading: false,
    fetching: false,
    error: null,
    loaded: !!cached,
    totalWithCoords: cached?.allDevices.length || 0,

    fetchAllMapDevices: async () => {
      if (get().fetching) return
      const hasCachedData = get().allDevices.length > 0
      set({ fetching: true, loading: !hasCachedData, error: null })

      try {
        let allDevices: MapDevice[] = []
        let page = 1
        let hasMore = true

        while (hasMore) {
          const data = await api<{ devices: MapDevice[]; numberResults?: number; numberPages?: number }>(
            `/devices/map?page=${page}&max_per_page=1000`
          )
          const list = data.devices || []

          const withCoords = list.filter((d) => {
            const lat = Number(d.lat)
            const lon = Number(d.lon)
            return d.lat != null && d.lon != null && !isNaN(lat) && !isNaN(lon) && (lat !== 0 || lon !== 0)
          })

          allDevices = [...allDevices, ...withCoords]

          // Progressive update — show pins as they arrive
          set({ allDevices: [...allDevices], totalWithCoords: allDevices.length, loaded: true })

          if (list.length < 1000) hasMore = false
          else page++
        }

        // Fetch active devices
        let activeDevices: MapDevice[] = []
        page = 1
        hasMore = true

        while (hasMore) {
          const data = await api<{ active_devices: MapDevice[] }>(
            `/devices/active?page=${page}&max_per_page=1000`
          )
          const list = data.active_devices || []
          activeDevices = [...activeDevices, ...list]
          if (list.length < 1000) hasMore = false
          else page++
        }

        const activeNumbers = new Set(activeDevices.map((d) => d.number || ''))

        for (const d of allDevices) {
          d.isActive = activeNumbers.has(d.number || '')
        }

        set({ allDevices: [...allDevices], activeNumbers, loading: false, fetching: false })
        saveCache(allDevices, activeNumbers)
      } catch (err: any) {
        if (get().allDevices.length > 0) {
          set({ loading: false, fetching: false })
        } else {
          set({ error: err.message, loading: false, fetching: false })
        }
      }
    },
  }
})
