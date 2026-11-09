import type { MazeDiscount } from './constants'
import type { War } from './types'

export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}

export function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return 'Not set'
  return date.toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return 'Not set'
  return date.toLocaleDateString(undefined, { dateStyle: 'medium' })
}

export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return 'Not set'
  return date.toLocaleTimeString(undefined, { timeStyle: 'short' })
}

/** Value for <input type="datetime-local"> in the viewer's timezone. */
export function toDateTimeLocal(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  return `${year}-${month}-${day}T${hours}:${minutes}`
}

/** Convert a datetime-local input value to an ISO timestamp. */
export function fromDateTimeLocal(value: string): string | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0m'
  const totalMinutes = Math.floor(ms / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60
  const parts: string[] = []
  if (days) parts.push(`${days}d`)
  if (hours) parts.push(`${hours}h`)
  if (!days && minutes) parts.push(`${minutes}m`)
  return parts.length ? parts.join(' ') : '<1m'
}

export function formatRelative(target: Date | null, now = new Date()): string {
  if (!target) return 'Not set'
  const diff = target.getTime() - now.getTime()
  if (diff <= 0) return 'Ended'
  return `${formatDuration(diff)} left`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function percent(current: number, total: number): number {
  if (!total || total <= 0) return 0
  return clamp((current / total) * 100, 0, 100)
}

export interface WarWindow {
  start: Date | null
  phaseEnd: Date | null // End of current phase (24h)
  warEnd: Date | null   // End of entire war (48h)
  phase: 'defence' | 'attack' | 'ended' | 'unknown'
  active: boolean
}

/**
 * Mirrors bot/cogs/war.py: a war starts at war_start, defence lasts 24h and
 * attack lasts until war_start + 48h.
 */
export function getWarWindow(war: War | null): WarWindow {
  if (!war) return { start: null, phaseEnd: null, warEnd: null, phase: 'unknown', active: false }

  const start = toDate(war.war_start)
  if (!start) {
    // Rows written before war_start was stored can only fall back to the saved phase.
    const raw = (war.phase || '').toLowerCase()
    const phase = raw === 'attack' ? 'attack' : raw === 'ended' ? 'ended' : 'unknown'
    return { start: null, phaseEnd: null, warEnd: null, phase, active: false }
  }

  // The timeline is fixed: defence for the first 24h, attack for the last 24h.
  // Deriving the phase from war_start keeps the dashboard honest even when the
  // bot was offline during the switch or the stored phase is stale.
  const defenceEnd = new Date(start.getTime() + 24 * 3600_000)
  const warEnd = new Date(start.getTime() + 48 * 3600_000)
  const now = Date.now()

  const phase =
    !war.is_active || now >= warEnd.getTime()
      ? 'ended'
      : now >= defenceEnd.getTime()
        ? 'attack'
        : 'defence'

  return {
    start,
    phaseEnd: phase === 'defence' ? defenceEnd : warEnd,
    warEnd,
    phase,
    active: Boolean(war.is_active) && phase !== 'ended',
  }
}

export function warPhaseLabel(phase: WarWindow['phase']): string {
  switch (phase) {
    case 'defence':
      return 'Defence'
    case 'attack':
      return 'Attack'
    case 'ended':
      return 'Ended'
    default:
      return 'Unknown'
  }
}

export interface DiscountMoment {
  percent: string
  at: Date
  past: boolean
}

/** Mirrors the countdown offsets used in bot/cogs/maze.py. */
export function discountMoments(
  end: Date | null,
  type: '7d' | '3d',
  schedule: MazeDiscount[],
  now = new Date(),
): DiscountMoment[] {
  if (!end) return []
  return schedule
    .map((item) => {
      const at = new Date(end.getTime() - (item.hours * 60 + item.minutes) * 60_000)
      return { percent: item.percent, at, past: at.getTime() <= now.getTime() }
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime())
}

export function nextDiscount(moments: DiscountMoment[]): DiscountMoment | null {
  return moments.find((moment) => !moment.past) ?? null
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`
}

export function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value.trim())
}

export function maskId(id: string | number | null | undefined): string {
  if (id === null || id === undefined) return '—'
  const value = String(id)
  if (value.length <= 8) return value
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}
