import { useAuth } from '@/stores/auth'
import { LoginPage } from '@/pages/LoginPage'
import { CommandCenter } from '@/pages/CommandCenter'

export default function App() {
  const token = useAuth((s) => s.token)
  return token ? <CommandCenter /> : <LoginPage />
}
