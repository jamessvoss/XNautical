import { Search, Sun, Moon, Settings, LogOut, PanelBottom } from 'lucide-react'
import { useAuth } from '@/stores/auth'
import { useUI } from '@/stores/ui'
import { useState } from 'react'

export function TopBar() {
  const { username, logout } = useAuth()
  const { darkMode, toggleDarkMode, toggleBottomPanel, bottomPanelOpen } = useUI()
  const [searchQuery, setSearchQuery] = useState('')

  return (
    <div className="h-12 bg-panel backdrop-blur-md border-b border-panel-border flex items-center px-4 gap-4 z-50 shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2 shrink-0">
        <span className="text-lg font-bold text-white">3Si</span>
        <span className="text-sm text-accent font-medium hidden sm:inline">DirectToDispatch</span>
      </div>

      {/* Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search devices..."
            className="w-full pl-9 pr-3 py-1.5 bg-navy-800 border border-panel-border rounded-lg text-sm text-white placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-accent"
          />
        </div>
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">
        <button
          onClick={toggleBottomPanel}
          className={`p-1.5 rounded-md transition-colors cursor-pointer ${
            bottomPanelOpen ? 'bg-accent text-white' : 'text-gray-400 hover:text-white hover:bg-navy-700'
          }`}
          title="Toggle data panel"
        >
          <PanelBottom className="w-4 h-4" />
        </button>
        <button
          onClick={toggleDarkMode}
          className="p-1.5 text-gray-400 hover:text-white hover:bg-navy-700 rounded-md transition-colors cursor-pointer"
          title="Toggle theme"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
        <button className="p-1.5 text-gray-400 hover:text-white hover:bg-navy-700 rounded-md transition-colors cursor-pointer" title="Settings">
          <Settings className="w-4 h-4" />
        </button>

        <div className="w-px h-6 bg-panel-border mx-1" />

        <span className="text-sm text-gray-400">{username}</span>
        <button
          onClick={logout}
          className="p-1.5 text-gray-400 hover:text-alert-red hover:bg-navy-700 rounded-md transition-colors cursor-pointer"
          title="Logout"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </div>
  )
}
