import { create } from 'zustand'
import { api } from '@/lib/api'

export interface AlertDevice {
  name: string
  number: string
  type: string
  tracking: boolean
  dam: boolean
  gps: string
  comment: string
  track_duration: number
  popup: boolean
}

interface AlertState {
  alertDevices: AlertDevice[]
  newAlerts: AlertDevice[]
  loading: boolean
  pollingInterval: ReturnType<typeof setInterval> | null
  startPolling: () => void
  stopPolling: () => void
  dismissAlert: (number: string) => void
}

export const useAlerts = create<AlertState>((set, get) => ({
  alertDevices: [],
  newAlerts: [],
  loading: false,
  pollingInterval: null,

  startPolling: () => {
    const poll = async () => {
      try {
        const data = await api('/alerts')
        const previousNumbers = new Set(get().alertDevices.map((d: AlertDevice) => d.number))
        const devices: AlertDevice[] = Array.isArray(data?.devices) ? data.devices :
          Array.isArray(data) ? data : []

        const newOnes = devices.filter(
          (d: AlertDevice) => !previousNumbers.has(d.number) && (d.tracking || d.dam)
        )

        set((s) => ({
          alertDevices: devices,
          newAlerts: [...s.newAlerts, ...newOnes],
          loading: false,
        }))
      } catch {
        // Silently retry on next poll
      }
    }

    poll()
    const interval = setInterval(poll, 20000)
    set({ pollingInterval: interval })
  },

  stopPolling: () => {
    const { pollingInterval } = get()
    if (pollingInterval) clearInterval(pollingInterval)
    set({ pollingInterval: null })
  },

  dismissAlert: (number) =>
    set((s) => ({ newAlerts: s.newAlerts.filter((a) => a.number !== number) })),
}))
