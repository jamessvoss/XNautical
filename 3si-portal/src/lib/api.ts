const BASE = '/api'

let authToken: string | null = localStorage.getItem('dtd_token')

export function setToken(token: string | null) {
  authToken = token
  if (token) localStorage.setItem('dtd_token', token)
  else localStorage.removeItem('dtd_token')
}

export function getToken() {
  return authToken
}

export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  }
  if (authToken) headers['Authorization'] = `Bearer ${authToken}`

  const res = await fetch(`${BASE}${path}`, { ...options, headers })

  if (res.status === 401 && !path.startsWith('/auth/')) {
    throw new Error('Session expired')
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error(err.error || 'API error')
  }

  return res.json()
}
