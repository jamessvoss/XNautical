import { useState, type FormEvent } from 'react'
import { useAuth } from '@/stores/auth'

export function LoginPage() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const { login, loading, error } = useAuth()

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    await login(username, password)
  }

  return (
    <div className="h-screen w-screen bg-navy-900 flex items-center justify-center">
      <div className="w-full max-w-sm px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white tracking-tight">
            3Si <span className="text-accent">DirectToDispatch</span>
          </h1>
          <p className="text-sm text-gray-400 mt-1">Tracking Command Center</p>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="bg-panel backdrop-blur-md border border-panel-border rounded-xl p-6 shadow-2xl"
        >
          {error && (
            <div className="mb-4 p-3 rounded-lg bg-alert-red/10 border border-alert-red/30 text-alert-red text-sm">
              {error}
            </div>
          )}

          <div className="mb-4">
            <label htmlFor="username" className="block text-sm font-medium text-gray-300 mb-1">
              Username
            </label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="w-full px-3 py-2 bg-navy-800 border border-panel-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              placeholder="Enter username"
              autoFocus
              required
            />
          </div>

          <div className="mb-6">
            <label htmlFor="password" className="block text-sm font-medium text-gray-300 mb-1">
              Password
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 bg-navy-800 border border-panel-border rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-accent focus:border-transparent"
              placeholder="Enter password"
              required
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-accent hover:bg-accent-hover disabled:opacity-50 text-white font-medium rounded-lg transition-colors cursor-pointer"
          >
            {loading ? 'Signing in...' : 'Sign In'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-500 mt-6">
          &copy; 2003-2026 3Si Security Systems, Inc.
        </p>
      </div>
    </div>
  )
}
