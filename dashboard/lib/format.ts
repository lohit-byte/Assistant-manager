import { MAZE_WINDOWS, type MazeWindow } from './constants'
import type { Alias, Id, War } from './types'

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

export interface MazeMoment {
  percent: string
  start: Date
  end: Date
  /** True while the discount is live. */
  active: boolean
  /** True once the window has closed. */
  past: boolean
}

/** The discount windows of the maze that starts at `eventStart`, in local time. */
export function mazeMoments(
  eventStart: Date | null,
  now = new Date(),
  windows: MazeWindow[] = MAZE_WINDOWS,
): MazeMoment[] {
  if (!eventStart) return []
  return windows.map((window) => {
    const start = new Date(eventStart.getTime() + window.start * 3600_000)
    const end = new Date(eventStart.getTime() + window.end * 3600_000)
    return {
      percent: window.percent,
      start,
      end,
      active: start.getTime() <= now.getTime() && now.getTime() < end.getTime(),
      past: end.getTime() <= now.getTime(),
    }
  })
}

/** The discount that is live right now, if any (there are gaps between windows). */
export function currentMazeMoment(moments: MazeMoment[]): MazeMoment | null {
  return moments.find((moment) => moment.active) ?? null
}

/** The next window that has not started yet. */
export function nextMazeMoment(moments: MazeMoment[]): MazeMoment | null {
  return moments.find((moment) => !moment.past && !moment.active) ?? null
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

/** The words shown for a player the dashboard cannot name. Never a Discord id. */
export const NO_ALIAS_LABEL = 'No alias'

/** First alias name for a Discord user (a player with several aliases keeps the first row). */
export function aliasForDiscordId(
  aliases: ReadonlyArray<Pick<Alias, 'discord_id' | 'alias_name'>> | null | undefined,
  discordId: Id | null | undefined,
): string | null {
  if (discordId === null || discordId === undefined) return null
  const wanted = String(discordId).trim()
  if (!wanted) return null
  for (const alias of aliases ?? []) {
    if (alias.discord_id === null || alias.discord_id === undefined) continue
    if (String(alias.discord_id).trim() !== wanted) continue
    const name = (alias.alias_name ?? '').trim()
    if (name) return name
  }
  return null
}

/** A stored name that is really a raw snowflake or a `<@id>` / `<@!id>` mention. */
function isIdLikeName(name: string): boolean {
  return /^\d{17,20}$/.test(name) || /^<@!?\d{17,20}>$/.test(name)
}

/**
 * Display label for a player. Precedence: the stored real name (trimmed; never a raw snowflake
 * or a stored mention), then the alias for the Discord id, then `No alias`.
 */
export function playerLabel(
  name: string | null | undefined,
  aliases: ReadonlyArray<Pick<Alias, 'discord_id' | 'alias_name'>> | null | undefined,
  discordId: Id | null | undefined,
): string {
  const stored = (name ?? '').trim()
  if (stored && !isIdLikeName(stored)) return stored
  return aliasForDiscordId(aliases, discordId) ?? NO_ALIAS_LABEL
}
