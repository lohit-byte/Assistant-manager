'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { formatDateTime, formatDuration, warPhaseLabel, type WarWindow } from '@/lib/format'

const HOUR = 3_600_000

function pad(value: number) {
  return value.toString().padStart(2, '0')
}

function clockFromMs(ms: number) {
  const safe = Math.max(0, ms)
  const hours = Math.floor(safe / HOUR)
  const minutes = Math.floor((safe % HOUR) / 60_000)
  const seconds = Math.floor((safe % 60_000) / 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

/**
 * The war board, as the overview's spine. Same surface, rail and counters as the sample board on
 * the landing page, but driven by this server's real war row. The clock ticks once a second; the
 * rail uses the whole 48h window so it agrees with the war page's total progress bar.
 */
export function WarSpine({
  guildId,
  war,
  counts,
}: {
  guildId: string
  war: WarWindow
  counts: { missing: number; excused: number; logged: number }
}) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])

  const phaseEnd = war.phaseEnd
  const warEnd = war.warEnd
  const start = war.start
  const active = war.active && phaseEnd !== null && warEnd !== null
  const phaseLeft = active && phaseEnd !== null && now !== null ? phaseEnd.getTime() - now : null
  const warLeft = active && warEnd !== null && now !== null ? warEnd.getTime() - now : null

  let progress = 0
  if (start && warEnd && now !== null) {
    const total = warEnd.getTime() - start.getTime()
    progress = total > 0 ? Math.min(100, Math.max(0, ((now - start.getTime()) / total) * 100)) : 0
  }

  return (
    <section className="war-board mb-6" aria-label="War clock">
      <div className="board-head flex-wrap px-4 py-2.5 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <span className={active ? 'live-dot' : 'live-dot opacity-40'} aria-hidden />
          <span className="mono-label whitespace-nowrap text-slate-400">War board</span>
          <span className="mono-label hidden truncate text-slate-600 sm:inline">
            / 48h alliance war
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="board-phase">{active ? warPhaseLabel(war.phase) : 'Idle'}</span>
          <Link
            href={`/dashboard/${guildId}/war`}
            className="mono-label inline-flex items-center gap-1 text-accent-400 transition-colors hover:text-accent-300"
          >
            War room
            <ArrowUpRight className="h-3 w-3" aria-hidden />
          </Link>
        </div>
      </div>

      <div className="grid gap-5 p-4 sm:p-5 lg:grid-cols-[1fr_auto] lg:items-center">
        <div className="min-w-0">
          <p className="board-clock board-clock--page mt-3">
            {phaseLeft !== null ? clockFromMs(phaseLeft) : '--:--:--'}
            {active ? <small>left</small> : null}
          </p>
          <p className="mono-label mt-2 text-slate-500">
            {active && phaseEnd
              ? `Phase ends ${formatDateTime(phaseEnd)}`
              : 'No war running — start one in Discord'}
            {warLeft !== null && warLeft > 0
              ? ` / war clock ${formatDuration(warLeft)} left`
              : ''}
          </p>

          <div className="mt-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="mono-label text-steel-400">Defence / 24h</span>
              <span className="mono-label text-accent-400">Attack / 24h</span>
            </div>
            <div className="rail" aria-hidden>
              <span className="rail__seg rail__seg--defence" />
              <span className="rail__seg rail__seg--attack" />
              <span className="rail__marker" style={{ '--p': progress } as CSSProperties} />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="mono-label text-slate-600">48h left</span>
              <span className="mono-label text-slate-600">24h left</span>
              <span className="mono-label text-slate-600">0h</span>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 lg:w-[300px]">
          <div className="board-count">
            <p className="mono-label text-slate-500">Missing</p>
            <p className="board-count__value mt-1 text-warn-300">{counts.missing}</p>
          </div>
          <div className="board-count">
            <p className="mono-label text-slate-500">Excused</p>
            <p className="board-count__value mt-1 text-steel-400">{counts.excused}</p>
          </div>
          <div className="board-count">
            <p className="mono-label text-slate-500">Logged</p>
            <p className="board-count__value mt-1">{counts.logged}</p>
          </div>
        </div>
      </div>
    </section>
  )
}
