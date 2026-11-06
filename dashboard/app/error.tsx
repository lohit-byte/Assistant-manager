'use client'

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button, Card, CardBody } from '@/components/ui'

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <Card className="w-full max-w-lg">
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-400">
              The dashboard hit an unexpected error. You can retry or return to the server list.
            </p>
            <pre className="mt-4 overflow-x-auto rounded-xl border border-slate-800 bg-slate-950 p-3 text-left font-mono text-xs text-red-300">
              {error.message}
            </pre>
          </div>
          <div className="flex justify-center gap-2">
            <Button onClick={reset}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <a
              href="/dashboard"
              className="inline-flex items-center justify-center rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:bg-slate-700"
            >
              Server list
            </a>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
