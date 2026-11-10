'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, X } from 'lucide-react'

/**
 * Success notifications for dashboard writes.
 *
 * Staff presses a save button, the toast confirms what changed. Validation and load errors stay
 * inline next to the form (they need to point at the field); success is confirmed here so it is
 * visible wherever the button was on the page. Announced politely for screen readers.
 */
interface ToastItem {
  id: number
  message: string
  detail?: string
}

interface ToastApi {
  success: (message: string, detail?: string) => void
  dismiss: (id: number) => void
}

const AUTO_DISMISS_MS = 6000
const MAX_VISIBLE = 3

const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const value = useContext(ToastContext)
  if (!value) throw new Error('useToast must be used inside ToastProvider')
  return value
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id)
    if (timer) clearTimeout(timer)
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const success = useCallback(
    (message: string, detail?: string) => {
      const id = nextId.current++
      // Keep the newest three; a burst of writes must not stack up the whole screen.
      setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { id, message, detail }])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), AUTO_DISMISS_MS),
      )
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => {
      pending.forEach((timer) => clearTimeout(timer))
      pending.clear()
    }
  }, [])

  const api = useMemo<ToastApi>(() => ({ success, dismiss }), [dismiss, success])

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed inset-x-3 bottom-3 z-[70] flex flex-col items-stretch gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            role="status"
            className="toast-in pointer-events-auto w-full border border-sage-500/40 bg-ink-800 px-3.5 py-3 text-sm shadow-[0_12px_32px_rgba(0,0,0,0.35)] sm:w-auto sm:min-w-[320px] sm:max-w-[420px]"
          >
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-sage-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-semibold leading-snug text-slate-100">{toast.message}</p>
                {toast.detail ? (
                  <p className="mt-0.5 text-xs leading-relaxed text-slate-400">{toast.detail}</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => dismiss(toast.id)}
                className="-m-1 rounded-sm p-1 text-slate-500 transition-colors hover:text-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500"
                aria-label="Dismiss notification"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
