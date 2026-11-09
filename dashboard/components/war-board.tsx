'use client'

import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { sampleBoard } from '@/lib/marketing'

type Phase = 'defence' | 'attack'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const WAR_MS = 48 * HOUR
const PHASE_MS = 24 * HOUR

function pad(value: number) {
  return value.toString().padStart(2, '0')
}

function clockFromMs(ms: number) {
  const safe = Math.max(0, ms)
  const hours = Math.floor(safe / HOUR)
  const minutes = Math.floor((safe % HOUR) / MINUTE)
  const seconds = Math.floor((safe % MINUTE) / 1000)
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`
}

function shortFromMs(ms: number) {
  const safe = Math.max(0, ms)
  const hours = Math.floor(safe / HOUR)
  const minutes = Math.floor((safe % HOUR) / MINUTE)
  return `${hours}h ${pad(minutes)}m`
}

function stampFromDate(date: Date | null) {
  if (!date) return '10 Nov, 15:47'
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}

const ATTACK_LEFT = 21 * HOUR + 48 * MINUTE + 21 * 1000

/**
 * The hero sample board. It is not a screenshot: it is the real phase logic on a demo war that
 * runs from the moment the page loads. Every value is sample data and labelled as such.
 */
export function WarBoard() {
  const [phase, setPhase] = useState<Phase>('attack')
  const [anchor, setAnchor] = useState<{ start: number; end: number } | null>(null)
  const [now, setNow] = useState<number | null>(null)
  const [onScreen, setOnScreen] = useState(true)
  const figureRef = useRef<HTMLElement>(null)

  useEffect(() => {
    const t = Date.now()
    if (phase === 'attack') {
      const end = t + ATTACK_LEFT
      setAnchor({ start: end - WAR_MS, end })
    } else {
      const start = t - 12 * HOUR
      setAnchor({ start, end: start + WAR_MS })
    }
    setNow(t)
  }, [phase])

  useEffect(() => {
    const element = figureRef.current
    if (!element) return
    const observer = new IntersectionObserver(
      ([entry]) => setOnScreen(entry.isIntersecting),
      { threshold: 0 },
    )
    observer.observe(element)
    const onVisibility = () => {
      if (document.hidden) {
        setOnScreen(false)
        return
      }
      const rect = element.getBoundingClientRect()
      setOnScreen(rect.top < window.innerHeight && rect.bottom > 0)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!onScreen) return
    setNow(Date.now())
    const id = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [onScreen])

  const model = useMemo(() => {
    if (!anchor) {
      return {
        phaseLeft: ATTACK_LEFT,
        warLeft: ATTACK_LEFT,
        progress: ((WAR_MS - ATTACK_LEFT) / WAR_MS) * 100,
        phaseEnd: null as Date | null,
      }
    }
    const phaseEndMs = phase === 'defence' ? anchor.start + PHASE_MS : anchor.end
    const t = now ?? anchor.end - ATTACK_LEFT
    return {
      phaseLeft: Math.max(0, phaseEndMs - t),
      warLeft: Math.max(0, anchor.end - t),
      progress: Math.min(100, Math.max(0, ((t - anchor.start) / WAR_MS) * 100)),
      phaseEnd: new Date(phaseEndMs),
    }
  }, [anchor, now, phase])

  return (
    <figure ref={figureRef}>
      <div className="war-board">
        <div className="board-head flex-wrap px-4 py-2.5 sm:px-5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="live-dot" aria-hidden />
            <span className="mono-label whitespace-nowrap text-slate-400">War board</span>
            <span className="mono-label hidden truncate text-slate-600 sm:inline">/ {sampleBoard.serverLabel}</span>
          </div>
          <div className="board-switch" role="group" aria-label="Sample war phase">
            <button
              type="button"
              aria-pressed={phase === 'defence'}
              onClick={() => setPhase('defence')}
            >
              Defence
            </button>
            <button
              type="button"
              aria-pressed={phase === 'attack'}
              onClick={() => setPhase('attack')}
            >
              Attack
            </button>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <span className="board-phase">
                <span className="live-dot" aria-hidden />
                {phase}
              </span>
              <p className="board-clock mt-3">
                {clockFromMs(model.phaseLeft)}
                <small>left</small>
              </p>
              <p className="mono-label mt-2 text-slate-500">
                Phase ends {stampFromDate(model.phaseEnd)} / war clock {shortFromMs(model.warLeft)}{' '}
                left
              </p>
            </div>
            <div className="hidden shrink-0 text-right sm:block">
              <p className="mono-label">Attacks</p>
              <p className="mt-1 font-mono text-2xl leading-none text-slate-100">
                {sampleBoard.attacksRequired}
              </p>
              <p className="mono-label mt-1 text-slate-600">per player</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-2 flex items-center justify-between">
              <span className="mono-label text-steel-400">Defence / 24h</span>
              <span className="mono-label text-accent-400">Attack / 24h</span>
            </div>
            <div className="rail" aria-hidden>
              <span className="rail__seg rail__seg--defence" />
              <span className="rail__seg rail__seg--attack" />
              <span className="rail__marker" style={{ '--p': model.progress } as CSSProperties} />
            </div>
            <div className="mt-2 flex items-center justify-between">
              <span className="mono-label text-slate-600">48h left</span>
              <span className="mono-label text-slate-600">24h left</span>
              <span className="mono-label text-slate-600">0h</span>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-3 gap-2">
            <div className="board-count">
              <p className="mono-label text-slate-500">Missing</p>
              <p className="board-count__value mt-1">{sampleBoard.counts.missing}</p>
            </div>
            <div className="board-count">
              <p className="mono-label text-slate-500">Excused</p>
              <p className="board-count__value mt-1">{sampleBoard.counts.excused}</p>
            </div>
            <div className="board-count">
              <p className="mono-label text-slate-500">Logged</p>
              <p className="board-count__value mt-1">{sampleBoard.counts.logged}</p>
            </div>
          </div>

          <div className="mt-5">
            <div className="mb-1 flex items-center justify-between">
              <span className="mono-label text-slate-500">Attack log / sample roster</span>
              <span className="mono-label text-slate-600">Attacks</span>
            </div>
            <div className="board-log-row" style={{ borderTop: 0 }}>
              <span className="mono-label text-slate-600">Player</span>
              <span className="mono-label text-slate-600">Pips</span>
              <span className="mono-label text-slate-600">Count</span>
            </div>
            {sampleBoard.players.map((player) => (
              <div className="board-log-row" key={player.name}>
                <span className="text-slate-300">{player.name}</span>
                <span className="flex gap-1" aria-hidden>
                  {Array.from({ length: sampleBoard.attacksRequired }).map((_, index) => (
                    <span
                      key={index}
                      className="attack-pip"
                      data-on={index < player.attacks ? 'true' : 'false'}
                    />
                  ))}
                </span>
                <span className="tabular text-slate-400" aria-label={`${player.attacks} of ${sampleBoard.attacksRequired} attacks`}>
                  {player.attacks}/{sampleBoard.attacksRequired}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-white/[0.08] px-4 py-3 sm:px-5">
          <p className="mono-label text-slate-500">Sample board. The clock runs live.</p>
          <span className="mono-label text-slate-600">Switch phases above</span>
        </div>
      </div>
      <figcaption className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <span className="mono-label text-slate-500">Fig. 01 / live sample of one of six tools</span>
        <span className="mono-label text-slate-600">Sample players and counts</span>
      </figcaption>
    </figure>
  )
}
