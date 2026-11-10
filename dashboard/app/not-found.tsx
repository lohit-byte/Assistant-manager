import Link from 'next/link'
import { BrandMark } from '@/components/brand'

export default function NotFound() {
  return (
    <main id="main" className="relative flex min-h-screen flex-col bg-ink-950">
      <div className="frame flex flex-1 flex-col justify-center py-20">
        <BrandMark className="h-10 w-10" />
        <p className="mono-label mt-12 text-accent-400">404 / Sheet missing</p>
        <h1 className="display mt-4 max-w-[14ch] text-[clamp(3rem,10vw,8rem)] text-slate-50">
          Not on the board.
        </h1>
        <p className="mt-5 max-w-[48ch] text-[15px] leading-relaxed text-slate-400">
          This page is not in the war room. It may have moved, or it was never pinned. The board
          is still where you left it.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/"
            className="inline-flex items-center gap-2 border border-accent-500 bg-accent-500 px-5 py-3 text-sm font-semibold text-accent-ink transition-[color,background-color,border-color,transform] hover:-translate-y-0.5 hover:border-slate-200 hover:bg-slate-200"
          >
            Back to the board
          </Link>
          <Link
            href="/dashboard"
            className="inline-flex items-center gap-2 border border-white/[0.16] px-5 py-3 text-sm font-semibold text-slate-200 transition-[color,background-color,border-color,transform] hover:-translate-y-0.5 hover:border-accent-500/60 hover:text-slate-50"
          >
            Open dashboard
          </Link>
        </div>
      </div>
    </main>
  )
}
