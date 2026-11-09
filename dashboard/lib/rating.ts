import {
  RACE_ACTIVITY_TARGET,
  RACE_RATING_WEIGHT,
  WAR_RATING_WEIGHT,
} from './constants'
import type { Alias, Id, RaceLog, War, WarSettings } from './types'

export interface RatingRow {
  alias: string
  discordId: Id | null
  attacks: number
  required: number
  raceTasks: number
  score: number
  grade: string
  excused: boolean
}

export interface RatingInput {
  war: War | null
  warSettings: WarSettings
  raceLogs: RaceLog[]
  aliases: Alias[]
  /** Active war start, else seven days before the team's race window opened. */
  windowStart: string | null
  /**
   * The team's channels, when known. Used to decide which halves of the score exist so a
   * one-sided team renormalizes its weights. When omitted, the halves are inferred from the
   * war row and from whether any race logs were loaded.
   */
  warChannelId?: Id | null
  raceChannelId?: Id | null
}

/** A+ ≥ 90, A ≥ 80, B ≥ 65, C ≥ 50, else D. */
export function gradeFor(score: number): string {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  return 'D'
}

/**
 * Race action → the one task kind it counts for. A claim is not a contribution, and the
 * JE loop keeps writing `je_add` rows so the same node is only ever counted once.
 */
const RACE_TASK_KIND: Record<string, string | null> = {
  ofa_done: 'ofa',
  dyp_done: 'dyp',
  je_done: 'je',
  je_add: 'je',
  ofa_claim: null,
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

function raceTaskKind(actionType: string | null | undefined): string | null {
  if (!actionType) return null
  const kind = RACE_TASK_KIND[actionType]
  return kind === undefined ? null : kind
}

function channelPresent(channelId: Id | null | undefined): boolean {
  return channelId !== null && channelId !== undefined && String(channelId) !== ''
}

/**
 * Pure war + race activity rating. No Supabase calls: the page/component loads the rows and
 * this function decides the score, so the rules can be read and tested in one place.
 *
 * Rows are the union of war attack counts, the missing list and race loggers, sorted by score
 * (then alias). Excused players (absent list and `exempt_absent` on) are never ranked and are
 * returned after the ranked rows so the UI can list them separately.
 */
export function computeRatings(input: RatingInput): RatingRow[] {
  const required = Math.max(0, input.warSettings?.attacks_required ?? 0)
  const aliases = input.aliases ?? []

  const aliasByName = new Map<string, Alias>()
  const aliasByDiscordId = new Map<string, Alias>()
  for (const alias of aliases) {
    const name = normalizeName(alias.alias_name)
    if (name) aliasByName.set(name, alias)
    if (alias.discord_id !== null && alias.discord_id !== undefined) {
      aliasByDiscordId.set(String(alias.discord_id), alias)
    }
  }

  const rows = new Map<string, RatingRow>()

  const rowFor = (name: string, discordId: Id | null): RatingRow => {
    const key = normalizeName(name)
    const existing = rows.get(key)
    if (existing) {
      if (existing.discordId === null && discordId !== null) existing.discordId = discordId
      return existing
    }
    const created: RatingRow = {
      alias: name,
      discordId,
      attacks: 0,
      required,
      raceTasks: 0,
      score: 0,
      grade: 'D',
      excused: false,
    }
    rows.set(key, created)
    return created
  }

  const rowForIdentity = (name: string | null | undefined, discordId: Id | null): RatingRow | null => {
    const clean = (name ?? '').trim()
    const aliasFromId =
      discordId !== null && discordId !== undefined
        ? aliasByDiscordId.get(String(discordId)) ?? null
        : null
    // Prefer the alias row so a mixed-case war key and a race logger land on the same player.
    const alias = aliasFromId ?? (clean ? aliasByName.get(normalizeName(clean)) ?? null : null)
    if (alias) return rowFor(alias.alias_name, alias.discord_id)
    if (!clean) {
      if (discordId === null || discordId === undefined) return null
      return rowFor(`User ${discordId}`, discordId)
    }
    return rowFor(clean, discordId)
  }

  /* War half: attack counts are keyed by alias, the missing list carries names. */
  for (const [name, count] of Object.entries(input.war?.attack_counts ?? {})) {
    const row = rowForIdentity(name, null)
    if (!row) continue
    const value = Number(count)
    if (Number.isFinite(value) && value > row.attacks) row.attacks = Math.max(0, value)
  }

  for (const entry of input.war?.missing_list ?? []) {
    if (!entry?.name) continue
    const alias = aliasByName.get(normalizeName(entry.name))
    rowFor(
      alias?.alias_name ?? entry.name,
      alias?.discord_id ?? entry.id ?? null,
    )
  }

  // Excused players may sit only on the absent list (staff remove them from missing), but the
  // UI still lists them, so they join the union as unranked rows.
  for (const entry of input.war?.absent_list ?? []) {
    if (!entry?.name) continue
    const alias = aliasByName.get(normalizeName(entry.name))
    rowFor(
      alias?.alias_name ?? entry.name,
      alias?.discord_id ?? entry.id ?? null,
    )
  }

  /* Race half: one distinct (channel, lap, node, player, kind) per task. */
  const taskKeys = new Set<string>()
  for (const log of input.raceLogs ?? []) {
    if (!log) continue
    const kind = raceTaskKind(log.action_type)
    const aliasFromId =
      log.discord_id !== null && log.discord_id !== undefined
        ? aliasByDiscordId.get(String(log.discord_id)) ?? null
        : null
    const row = rowForIdentity(aliasFromId?.alias_name ?? log.player_name, aliasFromId?.discord_id ?? log.discord_id ?? null)
    if (!row || !kind) continue

    // Rows written before the migration have no node: they fall back to one task per row.
    const hasNode = log.lap !== null && log.lap !== undefined && log.node !== null && log.node !== undefined
    const taskKey = hasNode
      ? `${String(log.channel_id ?? '')}|${log.lap}|${log.node}|${normalizeName(row.alias)}|${kind}`
      : `row|${log.id ?? `${log.created_at}|${normalizeName(row.alias)}|${kind}`}`
    if (taskKeys.has(taskKey)) continue
    taskKeys.add(taskKey)
    row.raceTasks += 1
  }

  /* Which halves exist? Prefer the explicit team channels; fall back for legacy callers. */
  const hasWar = channelPresent(
    input.warChannelId !== undefined
      ? input.warChannelId
      : input.war?.channel_id ?? null,
  )
  const hasRace = channelPresent(
    input.raceChannelId !== undefined
      ? input.raceChannelId
      : (input.raceLogs ?? []).length > 0
        ? 'race'
        : null,
  )

  let warWeight = WAR_RATING_WEIGHT
  let raceWeight = RACE_RATING_WEIGHT
  if (hasWar && !hasRace) {
    warWeight = 1
    raceWeight = 0
  } else if (!hasWar && hasRace) {
    warWeight = 0
    raceWeight = 1
  }

  const absentNames = new Set(
    ((input.warSettings?.exempt_absent ?? false) ? input.war?.absent_list ?? [] : [])
      .map((entry) => normalizeName(entry?.name))
      .filter(Boolean),
  )

  const all = Array.from(rows.values())
  for (const row of all) {
    const warPart =
      hasWar && required > 0 ? Math.min(row.attacks / required, 1) : 0
    const racePart = hasRace
      ? Math.min(row.raceTasks / RACE_ACTIVITY_TARGET, 1)
      : 0
    row.score = Math.round(100 * (warWeight * warPart + raceWeight * racePart))
    row.grade = gradeFor(row.score)
    row.excused = absentNames.has(normalizeName(row.alias))
  }

  const ranked = all
    .filter((row) => !row.excused)
    .sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias))
  const excused = all
    .filter((row) => row.excused)
    .sort((a, b) => a.alias.localeCompare(b.alias))
  return [...ranked, ...excused]
}
