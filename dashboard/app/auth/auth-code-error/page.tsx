import Link from 'next/link'
import type { Metadata } from 'next'
import { ShieldAlert } from 'lucide-react'

export const metadata: Metadata = {
  title: 'Discord sign-in failed',
  description: 'The Discord sign-in did not complete. Return to the board and try again.',
  robots: { index: false, follow: false },
}

export default function AuthErrorPage() {
  return (
    <main
      id="main"
      className="flex min-h-screen flex-col items-center justify-center gap-4 bg-ink-950 px-6 text-center"
    >
      <div className="flex h-12 w-12 items-center justify-center border border-danger-500/40 bg-danger-500/[0.08] text-danger-400">
        <ShieldAlert className="h-6 w-6" />
      </div>
      <p className="mono-label text-danger-400">Auth / failed</p>
      <h1 className="display text-3xl text-slate-50">Authentication failed</h1>
      <p className="max-w-md text-sm leading-relaxed text-slate-400">
        Discord sign-in did not complete. This usually means the login was cancelled or the OAuth
        redirect is not configured for this deployment.
      </p>
      <Link
        href="/"
        className="mt-2 inline-flex items-center border border-accent-500 bg-accent-500 px-4 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:border-slate-200 hover:bg-slate-200"
      >
        Return to sign in
      </Link>
    </main>
  )
}
