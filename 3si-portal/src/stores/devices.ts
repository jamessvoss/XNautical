import { create } from 'zustand'
import { api } from '@/lib/api'
import type { MapDevice } from '@/stores/mapDevices'

export interface Device {
  Name: string
  'Phone Number': string
  IMEI: string
  'Vessel SN': string
  Vessel: string
  'Device Type': string
  Configuration: string
  'Last Location Fix': string
  'Home Location': string
  'Beacon Frequency': string
  'Battery(V)': string
  'Alert Message': string
  [key: string]: string | undefined
}

interface DeviceState {
  devices: Device[]
  total: number
  loading: boolean
  error: string | null
  selectedDevice: Device | null
  selectedMapDevice: MapDevice | null
  offset: number
  limit: number
  fetchDevices: (offset?: number, limit?: number) => Promise<void>
  selectDevice: (device: Device | null) => void
  selectMapDevice: (device: MapDevice | null) => void
}

export const useDevices = create<DeviceState>((set) => ({
  devices: [],
  total: 0,
  loading: false,
  error: null,
  selectedDevice: null,
  selectedMapDevice: null,
  offset: 0,
  limit: 50,

  fetchDevices: async (offset = 0, limit = 50) => {
    set({ loading: true, error: null })
    try {
      const data = await api<{ devices: Device[]; total: number }>(
        `/devices?rows=${limit}&offset=${offset}`
      )
      set({ devices: data.devices, total: data.total, offset, limit, loading: false })
    } catch (err: any) {
      set({ error: err.message, loading: false })
    }
  },

  selectDevice: (device) => set({ selectedDevice: device, selectedMapDevice: null }),
  selectMapDevice: (device) => set({ selectedMapDevice: device, selectedDevice: null }),
}))
