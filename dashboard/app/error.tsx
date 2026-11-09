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
    <main id="main" className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
      <Card className="w-full max-w-lg">
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center border border-danger-500/40 bg-danger-500/[0.08] text-danger-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div>
            <h1 className="display text-2xl text-slate-50">Something went wrong</h1>
            <p className="mt-2 text-sm text-slate-400">
              The dashboard hit an unexpected error. Retry the page, or return to the server
              list.
            </p>
            <pre className="mt-4 overflow-x-auto border border-white/[0.1] bg-ink-950 p-3 text-left font-mono text-xs text-danger-300">
              {error.message}
            </pre>
          </div>
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={reset}>
              <RefreshCw className="h-4 w-4" />
              Try again
            </Button>
            <a
              href="/dashboard"
              className="inline-flex items-center justify-center border border-white/[0.16] px-4 py-2.5 text-sm font-semibold text-slate-200 transition-colors hover:border-accent-500/60 hover:text-slate-50"
            >
              Server list
            </a>
          </div>
        </CardBody>
      </Card>
    </main>
  )
}
