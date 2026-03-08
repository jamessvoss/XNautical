import { create } from 'zustand'
import { api } from '@/lib/api'

export interface Device {
  name: string
  number: string
  device_type: string
  vessel: string
  location: string
  last_battery_voltage: string
  last_point_time: string
  configuration: string
  name_link?: string
  [key: string]: string | undefined
}

interface DeviceState {
  devices: Device[]
  total: number
  loading: boolean
  error: string | null
  selectedDevice: Device | null
  offset: number
  limit: number
  fetchDevices: (offset?: number, limit?: number) => Promise<void>
  selectDevice: (device: Device | null) => void
}

export const useDevices = create<DeviceState>((set) => ({
  devices: [],
  total: 0,
  loading: false,
  error: null,
  selectedDevice: null,
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

  selectDevice: (device) => set({ selectedDevice: device }),
}))
