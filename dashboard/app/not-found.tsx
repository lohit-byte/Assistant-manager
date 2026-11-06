import Link from 'next/link'
import { Compass, Home } from 'lucide-react'

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-purple-500/30 bg-purple-500/10 text-purple-300">
        <Compass className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-bold">Page not found</h1>
      <p className="max-w-md text-sm text-slate-400">
        That page does not exist. Head back to your servers and pick a dashboard.
      </p>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500"
      >
        <Home className="h-4 w-4" />
        Back to servers
      </Link>
    </div>
  )
}
