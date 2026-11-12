'use client'

import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { cn } from '@/lib/format'
import {
  indexAtOffset,
  indexForValue,
  recenterTarget,
  valueAtIndex,
  valueFromTyped,
} from '@/lib/wheel-math'

const ROW_HEIGHT = 44 // >= 44 px touch target
const VISIBLE_ROWS = 5
const COPIES = 5 // rendered repeats; the centred row is kept in the middle copy
const SETTLE_MS = 140
const TYPING_MS = 700
const COLUMN_WIDTH = 64
const UNIT_WIDTH = 22
const WHEEL_HEIGHT = ROW_HEIGHT * VISIBLE_ROWS
const PADDING = ((VISIBLE_ROWS - 1) * ROW_HEIGHT) / 2
const MAX_TILT = 24 // degrees at the edge of the drum

const FADE_MASK =
  'linear-gradient(to bottom, transparent 0%, black 18%, black 82%, transparent 100%)'

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

/** A short tick per value change; returns false when the device cannot vibrate. */
function hapticTick(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false
  try {
    navigator.vibrate(5)
    return true
  } catch {
    return false
  }
}

export interface WheelProps {
  /** Ordered values, e.g. 0..59. The wheel loops through them. */
  values: number[]
  /** Controlled value. */
  value: number
  onChange: (value: number) => void
  /** Spoken label, e.g. "Minutes". */
  label: string
  /** Short unit shown next to the centred value, e.g. "m". */
  unit: string
  disabled?: boolean
  className?: string
}

/**
 * One iOS-style infinite number wheel: native scroll-snap, a fixed highlight band, a 3D drum
 * curve and a fade mask. The list is rendered COPIES times and silently recentred after the
 * scroll settles, so the user never reaches an end. Used for every column of both maze pickers.
 */
export const Wheel = memo(function Wheel({
  values,
  value,
  onChange,
  label,
  unit,
  disabled = false,
  className,
}: WheelProps) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const bandRef = useRef<HTMLDivElement>(null)
  const indexRef = useRef(0)
  const valueRef = useRef(value)
  const paintedRef = useRef({ first: -1, last: -1 })
  const rafRef = useRef(0)
  const settleRef = useRef<number | undefined>(undefined)
  const typingRef = useRef<number | undefined>(undefined)
  const typedRef = useRef('')
  const dragRef = useRef<{ startY: number; startTop: number; moved: boolean } | null>(null)
  const suppressClickRef = useRef(false)
  const reduced = usePrefersReducedMotion()
  const length = values.length

  const rows = useMemo(
    () => Array.from({ length: COPIES * length }, (_, absolute) => values[absolute % length]),
    [values, length],
  )

  // The row elements never change once built: per-frame styling is written straight to the DOM
  // so scrolling does not re-render React.
  const rowElements = useMemo(
    () =>
      rows.map((rowValue, absolute) => (
        <div
          key={absolute}
          data-index={absolute}
          role="presentation"
          className={cn(
            'flex snap-center items-center justify-center text-2xl font-medium tabular-nums text-slate-500',
            'transition-colors duration-100 data-[selected=true]:font-bold data-[selected=true]:text-accent-200',
          )}
          style={{
            height: ROW_HEIGHT,
            backfaceVisibility: 'hidden',
            transformOrigin: 'center center',
          }}
        >
          {pad(rowValue)}
        </div>
      )),
    [rows],
  )

  /** Write opacity / drum transforms / selected flag for the rows around the centre. */
  const paint = useCallback(
    (scrollTop: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const children = scroller.children
      const centre = scrollTop / ROW_HEIGHT
      const first = Math.max(0, Math.floor(centre) - 3)
      const last = Math.min(children.length - 1, Math.ceil(centre) + 3)

      for (let position = first; position <= last; position += 1) {
        const node = children[position] as HTMLElement | undefined
        if (!node) continue
        const distance = position - centre
        const magnitude = Math.min(Math.abs(distance), 3)
        node.style.opacity = String(1 - (magnitude / 3) * 0.85)
        if (reduced) {
          node.style.transform = ''
        } else {
          const tilt = Math.max(-MAX_TILT, Math.min(MAX_TILT, -distance * 12))
          node.style.transform = `rotateX(${tilt.toFixed(2)}deg) scale(${(1 - magnitude * 0.06).toFixed(3)})`
        }
        node.dataset.selected = magnitude < 0.5 ? 'true' : 'false'
      }

      const previous = paintedRef.current
      for (let position = previous.first; position >= 0 && position <= previous.last; position += 1) {
        if (position >= first && position <= last) continue
        const node = children[position] as HTMLElement | undefined
        if (!node) continue
        node.style.opacity = ''
        node.style.transform = ''
        delete node.dataset.selected
      }
      paintedRef.current = { first, last }
    },
    [reduced],
  )

  const flashBand = useCallback(() => {
    const band = bandRef.current
    if (!band || reduced) return
    band.style.opacity = '0.75'
    window.setTimeout(() => {
      band.style.opacity = ''
    }, 90)
  }, [reduced])

  const commitIndex = useCallback(
    (absolute: number) => {
      indexRef.current = absolute
      const nextValue = valueAtIndex(values, absolute)
      if (nextValue === null || nextValue === valueRef.current) return
      valueRef.current = nextValue
      onChange(nextValue)
      if (!hapticTick()) flashBand()
    },
    [flashBand, onChange, values],
  )

  const handleScroll = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = window.requestAnimationFrame(() => {
      rafRef.current = 0
      const scroller = scrollerRef.current
      if (!scroller) return
      const absolute = indexAtOffset(scroller.scrollTop, ROW_HEIGHT, scroller.children.length)
      commitIndex(absolute)
      paint(scroller.scrollTop)

      // Re-centre only once the wheel has settled: jumping to an equal copy is invisible.
      window.clearTimeout(settleRef.current)
      settleRef.current = window.setTimeout(() => {
        const current = scrollerRef.current
        if (!current) return
        const settled = indexAtOffset(current.scrollTop, ROW_HEIGHT, current.children.length)
        const target = recenterTarget(settled, length, COPIES)
        if (target === null) return
        const previousBehaviour = current.style.scrollBehavior
        current.style.scrollBehavior = 'auto'
        current.scrollTop = target * ROW_HEIGHT
        current.style.scrollBehavior = previousBehaviour
        indexRef.current = target
        paint(current.scrollTop)
      }, SETTLE_MS)
    })
  }, [commitIndex, length, paint])

  const goToIndex = useCallback(
    (target: number) => {
      const scroller = scrollerRef.current
      if (!scroller) return
      const clamped = Math.min(scroller.children.length - 1, Math.max(0, target))
      indexRef.current = clamped
      scroller.scrollTo({ top: clamped * ROW_HEIGHT, behavior: reduced ? 'auto' : 'smooth' })
    },
    [reduced],
  )

  // Position the controlled value once on mount.
  useIsoLayoutEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const target = indexForValue(values, value, COPIES)
    scroller.scrollTop = target * ROW_HEIGHT
    indexRef.current = target
    valueRef.current = value
    paint(scroller.scrollTop)
    // Mount only: the value is controlled afterwards by the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Follow a value set from outside (presets, resets).
  useEffect(() => {
    if (value === valueRef.current) return
    const scroller = scrollerRef.current
    if (!scroller) return
    valueRef.current = value
    const target = indexForValue(values, value, COPIES)
    indexRef.current = target
    scroller.scrollTo({ top: target * ROW_HEIGHT, behavior: reduced ? 'auto' : 'smooth' })
  }, [value, values, reduced])

  // Repaint when the reduced-motion preference flips (drop or restore the drum curve).
  useEffect(() => {
    const scroller = scrollerRef.current
    if (scroller) paint(scroller.scrollTop)
  }, [paint])

  useEffect(
    () => () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      window.clearTimeout(settleRef.current)
      window.clearTimeout(typingRef.current)
    },
    [],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (disabled) return
      const step = (delta: number) => {
        event.preventDefault()
        goToIndex(indexRef.current + delta)
      }
      switch (event.key) {
        case 'ArrowUp':
          return step(-1)
        case 'ArrowDown':
          return step(1)
        case 'PageUp':
          return step(-VISIBLE_ROWS)
        case 'PageDown':
          return step(VISIBLE_ROWS)
        case 'Home':
          event.preventDefault()
          return goToIndex(indexForValue(values, values[0], COPIES))
        case 'End':
          event.preventDefault()
          return goToIndex(indexForValue(values, values[values.length - 1], COPIES))
        default:
          break
      }
      if (!/^\d$/.test(event.key)) return
      typedRef.current += event.key
      window.clearTimeout(typingRef.current)
      typingRef.current = window.setTimeout(() => {
        typedRef.current = ''
      }, TYPING_MS)
      const typedValue = valueFromTyped(values, typedRef.current)
      if (typedValue !== null) goToIndex(indexForValue(values, typedValue, COPIES))
    },
    [disabled, goToIndex, values],
  )

  // Mouse click-and-drag (touch keeps the native momentum scrolling).
  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (disabled || event.pointerType !== 'mouse' || event.button !== 0) return
      const scroller = scrollerRef.current
      if (!scroller) return
      suppressClickRef.current = false
      dragRef.current = { startY: event.clientY, startTop: scroller.scrollTop, moved: false }
      scroller.setPointerCapture(event.pointerId)
      scroller.style.cursor = 'grabbing'
      scroller.style.scrollSnapType = 'none'
    },
    [disabled],
  )

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller) return
    const delta = event.clientY - drag.startY
    if (Math.abs(delta) > 3) drag.moved = true
    scroller.scrollTop = drag.startTop - delta
  }, [])

  const endDrag = useCallback(() => {
    const drag = dragRef.current
    const scroller = scrollerRef.current
    if (!drag || !scroller) return
    dragRef.current = null
    suppressClickRef.current = drag.moved
    scroller.style.cursor = ''
    // Restore the inline snap value (the style prop will not re-apply it by itself).
    scroller.style.scrollSnapType = 'y mandatory'
    if (drag.moved) {
      goToIndex(indexAtOffset(scroller.scrollTop, ROW_HEIGHT, scroller.children.length))
    }
  }, [goToIndex])

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (disabled) return
      if (suppressClickRef.current) {
        suppressClickRef.current = false
        return
      }
      const target = (event.target as HTMLElement | null)?.closest('[data-index]')
      if (!target) return
      const absolute = Number((target as HTMLElement).dataset.index)
      if (Number.isFinite(absolute)) goToIndex(absolute)
    },
    [disabled, goToIndex],
  )

  if (length === 0) return null

  return (
    <div
      className={cn('relative select-none', className)}
      style={{ width: COLUMN_WIDTH + UNIT_WIDTH, height: WHEEL_HEIGHT }}
    >
      <div
        aria-hidden="true"
        ref={bandRef}
        className="pointer-events-none absolute left-0 top-1/2 z-10 -translate-y-1/2 rounded-xl border border-accent-500/35 bg-accent-500/[0.08] transition-opacity duration-100"
        style={{ width: COLUMN_WIDTH, height: ROW_HEIGHT }}
      />

      <div
        ref={scrollerRef}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={values[0]}
        aria-valuemax={values[values.length - 1]}
        aria-valuenow={value}
        aria-valuetext={`${value} ${label.toLowerCase()}`}
        aria-disabled={disabled || undefined}
        tabIndex={disabled ? -1 : 0}
        onScroll={handleScroll}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClick={handleClick}
        className={cn(
          'relative touch-pan-y overflow-y-auto overscroll-contain outline-none',
          'cursor-grab focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-500/50',
          '[scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        )}
        style={{
          width: COLUMN_WIDTH,
          height: WHEEL_HEIGHT,
          paddingBlock: PADDING,
          scrollSnapType: 'y mandatory',
          perspective: reduced ? undefined : '700px',
          maskImage: FADE_MASK,
          WebkitMaskImage: FADE_MASK,
          WebkitOverflowScrolling: 'touch',
        }}
      >
        {rowElements}
      </div>

      <span
        aria-hidden="true"
        className="pointer-events-none absolute z-10 text-xs font-semibold text-slate-400"
        style={{ left: COLUMN_WIDTH + 4, top: '50%', transform: 'translateY(-50%)' }}
      >
        {unit}
      </span>
    </div>
  )
})
