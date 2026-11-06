import Link from 'next/link'
import { ShieldAlert } from 'lucide-react'

export default function AuthErrorPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-slate-950 px-6 text-center text-white">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <h1 className="text-2xl font-bold">Authentication failed</h1>
      <p className="max-w-md text-sm text-slate-400">
        Discord sign-in did not complete. This usually means the login was cancelled or the OAuth
        redirect is not configured for this deployment.
      </p>
      <Link
        href="/"
        className="rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500"
      >
        Return to sign in
      </Link>
    </div>
  )
}
