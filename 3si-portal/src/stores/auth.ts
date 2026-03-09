import { create } from 'zustand'
import { api, setToken, getToken } from '@/lib/api'

interface AuthState {
  token: string | null
  username: string | null
  loading: boolean
  error: string | null
  loginSuccess: boolean
  login: (username: string, password: string) => Promise<boolean>
  logout: () => void
  checkAuth: () => boolean
}

export const useAuth = create<AuthState>((set) => ({
  token: getToken(),
  username: localStorage.getItem('dtd_username'),
  loading: false,
  error: null,
  loginSuccess: false,

  login: async (username, password) => {
    set({ loading: true, error: null, loginSuccess: false })
    try {
      const { token } = await api<{ token: string }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      })
      setToken(token)
      localStorage.setItem('dtd_username', username)
      set({ loginSuccess: true, loading: false })
      // Brief delay to show success state before transitioning
      await new Promise((r) => setTimeout(r, 800))
      set({ token, username })
      return true
    } catch (err: any) {
      set({ loading: false, error: err.message, loginSuccess: false })
      return false
    }
  },

  logout: () => {
    setToken(null)
    localStorage.removeItem('dtd_username')
    set({ token: null, username: null })
  },

  checkAuth: () => !!getToken(),
}))
