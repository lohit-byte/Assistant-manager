import Link from 'next/link'

/**
 * The board mark: four tally strokes and one signal square. It is the same mark as app/icon.svg,
 * rebuilt in the DOM so it stays crisp at any size.
 */
export function BrandMark({ className = 'h-9 w-9' }: { className?: string }) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center gap-[2px] border border-white/[0.18] bg-ink-800 ${className}`}
      aria-hidden
    >
      <span className="h-3.5 w-[2px] bg-slate-200" />
      <span className="h-3.5 w-[2px] bg-slate-200" />
      <span className="h-3.5 w-[2px] bg-slate-200" />
      <span className="mb-1.5 h-[6px] w-[6px] self-end bg-accent-500" />
    </span>
  )
}

export function Wordmark({ href = '/' }: { href?: string }) {
  return (
    <Link href={href} className="group flex items-center gap-2.5">
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className="text-[13px] font-semibold tracking-tight text-slate-100">
          Legends Assistant
        </span>
        <span className="mono-label mt-1 text-[9px] text-slate-500">Alliance ops</span>
      </span>
    </Link>
  )
}
