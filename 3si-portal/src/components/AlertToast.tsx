import { AlertTriangle, X, Navigation } from 'lucide-react'
import { useAlerts, type AlertDevice } from '@/stores/alerts'

export function AlertToastContainer() {
  const { newAlerts, dismissAlert } = useAlerts()

  if (newAlerts.length === 0) return null

  return (
    <div className="absolute top-3 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {newAlerts.slice(0, 5).map((alert) => (
        <AlertToast key={alert.number} alert={alert} onDismiss={() => dismissAlert(alert.number)} />
      ))}
    </div>
  )
}

function AlertToast({ alert, onDismiss }: { alert: AlertDevice; onDismiss: () => void }) {
  return (
    <div className="bg-alert-red/90 backdrop-blur-md border border-alert-red rounded-xl p-3 shadow-2xl animate-slide-in-right">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-white shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">{alert.name || alert.number}</p>
          <p className="text-xs text-white/80 mt-0.5">{alert.comment || 'Device activated'}</p>
        </div>
        <div className="flex items-center gap-1">
          <button className="p-1 text-white/80 hover:text-white rounded cursor-pointer" title="View on map">
            <Navigation className="w-4 h-4" />
          </button>
          <button onClick={onDismiss} className="p-1 text-white/80 hover:text-white rounded cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
