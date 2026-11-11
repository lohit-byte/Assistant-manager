'use client'

import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { cn } from '@/lib/format'

/**
 * Zero-dependency CSS 3D for the war board.
 *
 * The product language is a physical board in an alliance war room (see DESIGN.md): matte ink
 * surface, bone paper, signal-orange tape, mono data, hairline rules. This file gives that board
 * a third dimension without a WebGL dependency: one tilted table plane with a ruled grid and tape,
 * a 48h rail and count tokens lying on the surface, and pinned evidence cards standing above it.
 *
 * Interaction is deliberately small: drag (or arrow keys, when focused) to turn the table a few
 * degrees, then it settles back home with the single board ease. There is no idle animation and
 * no requestAnimationFrame loop, so nothing runs when the tab is hidden. All motion is
 * transform/opacity only, so it never triggers layout.
 */

export type WarTableTarget = 'war' | 'race' | 'maze' | 'setup'
export type WarTablePhase = 'defence' | 'attack' | 'ended' | 'unknown'

export interface WarTableCounts {
  missing: number
  excused: number
  logged: number
}

export interface WarTableRace {
  lap: number | null
  node: number | null
  target?: number | null
}

export interface WarTableMaze {
  label: string
  detail?: string | null
}

export interface WarTable3DProps {
  /** Server id used to derive `/dashboard/<id>/{war,race,maze,setup}` links. */
  guildId?: string | null
  /** Explicit hrefs, when the derived dashboard routes are not the right target. */
  links?: Partial<Record<WarTableTarget, string>>
  /** When set, the pinned cards become buttons and call this instead of navigating. */
  onSelect?: (target: WarTableTarget) => void
  phase?: WarTablePhase
  phaseLabel?: string
  active?: boolean
  /** Pre-formatted phase countdown, e.g. "21:48:21". Never measured in here. */
  timeLeft?: string | null
  /** Pre-formatted whole-war countdown, e.g. "21h 48m". */
  warLeft?: string | null
  /** 0-100 position of the 48h rail marker. */
  progress?: number
  counts?: WarTableCounts | null
  race?: WarTableRace | null
  maze?: WarTableMaze | null
  /** Marks the scene as sample data (landing hero). */
  sample?: boolean
  label?: string
  className?: string
}

/** Home pose: turned a few degrees so the table reads as an object, not a rectangle. */
const HOME_YAW = -8
const HOME_PITCH = 10
const YAW_MIN = HOME_YAW - 18
const YAW_MAX = HOME_YAW + 18
const PITCH_MIN = HOME_PITCH - 8
const PITCH_MAX = HOME_PITCH + 10
/** Horizontal drag sensitivity, in degrees per pixel. */
const DRAG_YAW_PER_PX = 0.22
const DRAG_PITCH_PER_PX = 0.1
/** How far the pointer must travel before a drag stops being a click. */
const DRAG_THRESHOLD_PX = 7

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function safeCount(value: number | null | undefined) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function reducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Slab tokens: one pip per player in each counter, capped so a big board stays legible. */
function pips(count: number) {
  const visible = Math.min(10, count)
  if (visible === 0) return null
  return Array.from({ length: visible }, (_, index) => (
    <span className="war-table3d__token" key={index} />
  ))
}

/**
 * The 3D war table.
 *
 * Decorative 3D layers are `aria-hidden`; the pinned cards are real links (or buttons) with
 * accessible labels, and a visually hidden paragraph carries the same information as text so the
 * scene is never the only way to read the board. The wrapper is focusable: arrow keys turn the
 * table, and the cards are separate tab stops, so Enter on a focused card opens it.
 */
export function WarTable3D({
  guildId = null,
  links,
  onSelect,
  phase = 'unknown',
  phaseLabel,
  active,
  timeLeft = null,
  warLeft = null,
  progress = 0,
  counts = null,
  race = null,
  maze = null,
  sample = false,
  label = 'War table',
  className,
}: WarTable3DProps) {
  const summaryId = useId()
  const sceneRef = useRef<HTMLDivElement>(null)
  const yawRef = useRef(HOME_YAW)
  const pitchRef = useRef(HOME_PITCH)
  const dragRef = useRef<{
    pointerId: number
    x: number
    y: number
    yaw: number
    pitch: number
    moved: boolean
  } | null>(null)
  const settleFrameRef = useRef<number | null>(null)
  const suppressClickRef = useRef(false)
  const suppressTimerRef = useRef<number | null>(null)

  useEffect(() => {
    return () => {
      if (settleFrameRef.current !== null) window.cancelAnimationFrame(settleFrameRef.current)
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
    }
  }, [])

  const applyPose = () => {
    const scene = sceneRef.current
    if (!scene) return
    scene.style.setProperty('--yaw', `${yawRef.current.toFixed(2)}deg`)
    scene.style.setProperty('--pitch', `${pitchRef.current.toFixed(2)}deg`)
  }

  const settleHome = () => {
    yawRef.current = HOME_YAW
    pitchRef.current = HOME_PITCH
    if (typeof window === 'undefined') return
    // Reduced motion gets the finished state immediately: no settle animation at all.
    if (reducedMotion()) {
      applyPose()
      return
    }
    if (settleFrameRef.current !== null) window.cancelAnimationFrame(settleFrameRef.current)
    settleFrameRef.current = window.requestAnimationFrame(() => {
      settleFrameRef.current = null
      applyPose()
    })
  }

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return
    if (!event.isPrimary) return
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: yawRef.current,
      pitch: pitchRef.current,
      moved: false,
    }
    event.currentTarget.dataset.dragging = 'true'
    // No setPointerCapture here: capturing on pointerdown retargets pointerup and can swallow
    // the click on a pinned card. Touch already has implicit capture, and a mouse drag that
    // leaves the table simply ends on pointerleave.
  }

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    const dx = event.clientX - drag.x
    const dy = event.clientY - drag.y
    if (!drag.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) drag.moved = true
    if (!drag.moved) return
    yawRef.current = clamp(drag.yaw + dx * DRAG_YAW_PER_PX, YAW_MIN, YAW_MAX)
    pitchRef.current = clamp(drag.pitch + dy * DRAG_PITCH_PER_PX, PITCH_MIN, PITCH_MAX)
    applyPose()
  }

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== event.pointerId) return
    dragRef.current = null
    delete event.currentTarget.dataset.dragging

    if (drag.moved) {
      // A drag that ends over a pinned card must not also open it.
      suppressClickRef.current = true
      if (suppressTimerRef.current !== null) window.clearTimeout(suppressTimerRef.current)
      suppressTimerRef.current = window.setTimeout(() => {
        suppressClickRef.current = false
      }, 320)
      settleHome()
    }
  }

  const onClickCapture = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!suppressClickRef.current) return
    suppressClickRef.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 14 : 7
    switch (event.key) {
      case 'ArrowLeft':
        yawRef.current = clamp(yawRef.current - step, YAW_MIN, YAW_MAX)
        break
      case 'ArrowRight':
        yawRef.current = clamp(yawRef.current + step, YAW_MIN, YAW_MAX)
        break
      case 'ArrowUp':
        pitchRef.current = clamp(pitchRef.current - step / 2, PITCH_MIN, PITCH_MAX)
        break
      case 'ArrowDown':
        pitchRef.current = clamp(pitchRef.current + step / 2, PITCH_MIN, PITCH_MAX)
        break
      case 'Home':
        settleHome()
        event.preventDefault()
        return
      default:
        return
    }
    // Arrow keys turn the table instead of scrolling the page while it holds focus.
    event.preventDefault()
    applyPose()
  }

  const safeProgress = Number.isFinite(progress) ? clamp(progress, 0, 100) : 0
  const missing = safeCount(counts?.missing)
  const excused = safeCount(counts?.excused)
  const logged = safeCount(counts?.logged)

  const phaseText =
    phaseLabel ??
    (phase === 'defence'
      ? 'Defence'
      : phase === 'attack'
        ? 'Attack'
        : phase === 'ended'
          ? 'Ended'
          : 'Unknown')
  const isActive = active ?? (phase === 'defence' || phase === 'attack')
  const clockText = timeLeft ?? '--:--:--'
  const warMeta = isActive
    ? `${phaseText}${warLeft ? ` · war ${warLeft} left` : ''}`
    : phase === 'ended'
      ? 'War ended'
      : 'No war running'

  const hasRace = Boolean(race && (typeof race.lap === 'number' || typeof race.node === 'number'))
  const raceValue =
    race && typeof race.lap === 'number' && typeof race.node === 'number'
      ? `${race.lap}.${race.node}`
      : race && typeof race.lap === 'number'
        ? `${race.lap}`
        : '—'
  const raceMeta = hasRace
    ? typeof race?.target === 'number' && race.target > 0
      ? `target ${race.target} laps`
      : 'lap · node'
    : 'Open race'

  const hasMaze = Boolean(maze?.label?.trim())
  const mazeValue = hasMaze ? maze!.label.trim() : '—'
  const mazeMeta = hasMaze ? maze?.detail?.trim() || 'Next discount' : 'Open maze'

  const hrefFor = (target: WarTableTarget) =>
    links?.[target] ?? (guildId ? `/dashboard/${guildId}/${target}` : undefined)

  const card = (target: WarTableTarget, ariaLabel: string, body: ReactNode) => {
    const classes = cn('war-table3d__hot', `war-table3d__hot--${target}`)
    if (onSelect) {
      return (
        <button
          type="button"
          className={classes}
          aria-label={ariaLabel}
          onClick={() => onSelect(target)}
        >
          {body}
        </button>
      )
    }
    const href = hrefFor(target)
    if (href) {
      return (
        <Link href={href} className={classes} aria-label={ariaLabel}>
          {body}
        </Link>
      )
    }
    return (
      <div className={classes} aria-hidden>
        {body}
      </div>
    )
  }

  const cardTop = (text: string, live: boolean) => (
    <span className="war-table3d__top">
      <span className="war-table3d__tag">
        {live ? <span className="live-dot" aria-hidden /> : null}
        {text}
      </span>
      <span className="war-table3d__go" aria-hidden>
        <ArrowUpRight className="war-table3d__go-icon" />
      </span>
    </span>
  )

  const summary = [
    sample ? `Sample ${label.toLowerCase()}, illustrative data only` : label,
    isActive
      ? `${phaseText} phase, ${clockText} left in phase${warLeft ? `, war clock ${warLeft} left` : ''}`
      : phase === 'ended'
        ? 'The war has ended'
        : 'No war is running',
    `${missing} missing, ${excused} excused, ${logged} logged`,
    hasRace ? `Race on lap ${race?.lap} node ${race?.node}` : 'Race tools',
    hasMaze ? `Next maze discount ${mazeValue}` : 'Maze tools',
    'Turn the table with the left and right arrow keys. Tab to a pinned card and press Enter to open it.',
  ]
    .filter(Boolean)
    .join('. ')

  return (
    <div
      className={cn('war-table3d', className)}
      role="group"
      tabIndex={0}
      aria-label={label}
      aria-describedby={summaryId}
      data-dragging="false"
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      onClickCapture={onClickCapture}
    >
      <p id={summaryId} className="sr-only">
        {summary}
      </p>

      <div className="war-table3d__stage">
        <div ref={sceneRef} className="war-table3d__scene">
          {/* The table surface: a ruled matte plane with corner tape, carrying the 48h rail and
              the missing/excused/logged tokens. Decorative — the same data reads above it. */}
          <div className="war-table3d__slab" aria-hidden>
            <span className="war-table3d__tape war-table3d__tape--a" />
            <span className="war-table3d__tape war-table3d__tape--b" />
            <span className="war-table3d__tape war-table3d__tape--c" />
            <div
              className="war-table3d__rail"
              style={{ '--p': safeProgress } as CSSProperties}
            >
              <div className="war-table3d__rail-track">
                <span className="war-table3d__rail-seg war-table3d__rail-seg--defence" />
                <span className="war-table3d__rail-seg war-table3d__rail-seg--attack" />
                <span className="war-table3d__rail-marker" />
              </div>
            </div>
            <div className="war-table3d__tokens">
              <span className="war-table3d__token-set" data-tone="missing">
                {pips(missing)}
              </span>
              <span className="war-table3d__token-set" data-tone="excused">
                {pips(excused)}
              </span>
              <span className="war-table3d__token-set" data-tone="logged">
                {pips(logged)}
              </span>
            </div>
          </div>

          {card(
            'war',
            isActive
              ? `War room, ${phaseText.toLowerCase()} phase, ${clockText} left`
              : `War room, ${warMeta.toLowerCase()}`,
            <>
              {cardTop('War / 48h', isActive)}
              <span className="war-table3d__main">
                <strong className="war-table3d__value war-table3d__value--clock">
                  {clockText}
                </strong>
                <span className="war-table3d__meta">{warMeta}</span>
              </span>
            </>,
          )}

          {card(
            'race',
            hasRace ? `Race, lap ${race?.lap} node ${race?.node}` : 'Race',
            <>
              {cardTop('Race', false)}
              <span className="war-table3d__main">
                <strong className="war-table3d__value">{raceValue}</strong>
                <span className="war-table3d__meta">{raceMeta}</span>
              </span>
            </>,
          )}

          {card(
            'maze',
            hasMaze ? `Maze, ${mazeValue}` : 'Maze',
            <>
              {cardTop('Maze', false)}
              <span className="war-table3d__main">
                <strong className="war-table3d__value">{mazeValue}</strong>
                <span className="war-table3d__meta">{mazeMeta}</span>
              </span>
            </>,
          )}

          {card(
            'setup',
            'Server setup, teams and channels',
            <>
              {cardTop('Setup', false)}
              <span className="war-table3d__main">
                <span className="war-table3d__meta">Teams · channels</span>
              </span>
            </>,
          )}
        </div>
      </div>

      <span className="war-table3d__corner war-table3d__corner--tl" aria-hidden>
        Board / 48h
      </span>
      <span className="war-table3d__corner war-table3d__corner--tr" aria-hidden>
        {sample ? 'Sample data' : isActive ? 'Live' : 'Idle'}
      </span>
      <span className="war-table3d__corner war-table3d__corner--br" aria-hidden>
        Drag / arrows
      </span>
    </div>
  )
}

/**
 * Small 3D hover/tilt wrapper for one board card. Motion-safe only: it does nothing when the
 * visitor prefers reduced motion or has no fine pointer, and never animates on its own.
 */
export function TiltSurface({
  children,
  className,
  strength = 5,
}: {
  children: ReactNode
  className?: string
  strength?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const allowedRef = useRef(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)')
    const sync = () => {
      allowedRef.current = !reduce.matches && finePointer.matches
    }
    sync()
    reduce.addEventListener('change', sync)
    finePointer.addEventListener('change', sync)
    return () => {
      reduce.removeEventListener('change', sync)
      finePointer.removeEventListener('change', sync)
    }
  }, [])

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!allowedRef.current) return
    const element = ref.current
    if (!element) return
    const rect = element.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    element.style.setProperty('--tilt-x', `${(-py * strength).toFixed(2)}deg`)
    element.style.setProperty('--tilt-y', `${(px * (strength + 2)).toFixed(2)}deg`)
  }

  const reset = () => {
    const element = ref.current
    if (!element) return
    element.style.setProperty('--tilt-x', '0deg')
    element.style.setProperty('--tilt-y', '0deg')
  }

  return (
    <div
      ref={ref}
      className={cn('tilt-surface', className)}
      onPointerMove={onPointerMove}
      onPointerLeave={reset}
    >
      {children}
    </div>
  )
}
