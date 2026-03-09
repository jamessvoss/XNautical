import { create } from 'zustand'
import { api } from '@/lib/api'

export interface PositionData {
  point?: {
    speed?: number
    heading?: number
    batteryVoltage?: number
    batteryPercentage?: number
    time?: string
    error?: number
    solution_type?: string
  }
  track?: {
    id?: number
    type?: string
    subtype?: string
  }
  [key: string]: any
}

interface PositionCache {
  data: PositionData
  fetchedAt: number
}

const CACHE_TTL = 2 * 60 * 1000 // 2 minutes

interface DevicePositionState {
  cache: Record<string, PositionCache>
  loading: string | null
  error: string | null
  fetchPosition: (number: string) => Promise<void>
  getPosition: (number: string) => PositionData | null
}

export const useDevicePosition = create<DevicePositionState>((set, get) => ({
  cache: {},
  loading: null,
  error: null,

  getPosition: (number: string) => {
    const entry = get().cache[number]
    if (!entry) return null
    if (Date.now() - entry.fetchedAt > CACHE_TTL) return null
    return entry.data
  },

  fetchPosition: async (number: string) => {
    if (get().loading === number) return
    set({ loading: number, error: null })

    try {
      const data = await api<PositionData>(`/devices/position/${number}`)
      set((s) => ({
        cache: { ...s.cache, [number]: { data, fetchedAt: Date.now() } },
        loading: null,
      }))
    } catch (err: any) {
      set({ error: err.message, loading: null })
    }
  },
}))
