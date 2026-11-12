'use client'

import { useEffect, useRef } from 'react'
import { cn } from '@/lib/format'

const ITEM_HEIGHT = 32
const VISIBLE_ITEMS = 5

/**
 * One scrollable number column (hours, minutes, days). The selected value is the row at the
 * vertical centre; scrolling snaps it, clicking a row jumps to it, and Up/Down arrows step it.
 * Used instead of typing times so the maze start and the calendar date are one gesture.
 */
export function Wheel({
  values,
  value,
  onChange,
  label,
  suffix,
}: {
  values: number[]
  value: number
  onChange: (value: number) => void
  label: string
  suffix?: string
}) {
  const columnRef = useRef<HTMLDivElement>(null)

  // Keep the column on the selected row when the value is set from outside (e.g. a preset).
  useEffect(() => {
    const column = columnRef.current
    if (!column) return
    const index = Math.max(0, values.indexOf(value))
    const top = index * ITEM_HEIGHT
    if (Math.abs(column.scrollTop - top) > 2) column.scrollTo({ top, behavior: 'smooth' })
  }, [value, values])

  const select = (index: number) => {
    const next = values[Math.min(values.length - 1, Math.max(0, index))]
    if (next !== value) onChange(next)
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div
        ref={columnRef}
        role="listbox"
        aria-label={label}
        tabIndex={0}
        onScroll={(event) =>
          select(Math.round(event.currentTarget.scrollTop / ITEM_HEIGHT))
        }
        onKeyDown={(event) => {
          if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
          event.preventDefault()
          select(values.indexOf(value) + (event.key === 'ArrowUp' ? -1 : 1))
        }}
        className="w-16 overflow-y-auto rounded-xl border border-white/[0.10] bg-ink-950/70 text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/40 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ height: ITEM_HEIGHT * VISIBLE_ITEMS, paddingBlock: (ITEM_HEIGHT * (VISIBLE_ITEMS - 1)) / 2 }}
      >
        {values.map((option) => (
          <button
            key={option}
            type="button"
            role="option"
            aria-selected={option === value}
            tabIndex={-1}
            onClick={() => onChange(option)}
            className={cn(
              'flex w-full items-center justify-center text-sm tabular-nums transition-colors',
              option === value
                ? 'font-semibold text-accent-200'
                : 'text-slate-500 hover:text-slate-300',
            )}
            style={{ height: ITEM_HEIGHT }}
          >
            {String(option).padStart(2, '0')}
          </button>
        ))}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
        {suffix ? ` ${suffix}` : ''}
      </span>
    </div>
  )
}
