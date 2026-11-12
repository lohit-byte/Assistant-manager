import type { Alias, Id, War } from './types'

export type AttendanceStatus = 'none' | 'partial' | 'done' | 'excused'

export interface AttendanceRow {
  alias: string
  discordId: Id | null
  attacks: number
  required: number
  status: AttendanceStatus
  /** True when the player is (still) on the war's missing list, by name or Discord id. */
  onMissingList: boolean
}

export interface AttendanceSummary {
  total: number
  done: number
  partial: number
  none: number
  excused: number
}

export interface AttendanceInput {
  war: War | null
  required: number
  aliases: Alias[]
  /**
   * Discord ids on the owning team's roster (`team_players`). When it has any entries, only
   * aliases of rostered players are listed; an empty roster falls back to every alias in the
   * server (single-team servers have no roster configured).
   */
  rosterIds?: readonly Id[] | null
  /** Absent-list players only count as excused when the server's `exempt_absent` is on. */
  exemptAbsent?: boolean
}

export interface AttendanceResult {
  rows: AttendanceRow[]
  summary: AttendanceSummary
}

/** Who to chase first: not reported, then partial, then done, then excused. */
const STATUS_SORT: Record<AttendanceStatus, number> = {
  none: 0,
  partial: 1,
  done: 2,
  excused: 3,
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

function hasDiscordId(discordId: Id | null | undefined): discordId is Id {
  return discordId !== null && discordId !== undefined && String(discordId).trim() !== ''
}

function readPlayerList(entries: unknown): { name: string; id: string | null } {
  if (typeof entries === 'string') return { name: entries.trim(), id: null }
  if (!entries || typeof entries !== 'object') return { name: '', id: null }
  const named = entries as { name?: unknown; id?: unknown }
  const name = typeof named.name === 'string' ? named.name.trim() : ''
  const rawId = named.id
  const id =
    rawId === null || rawId === undefined || String(rawId).trim() === ''
      ? null
      : String(rawId).trim()
  return { name, id }
}

interface PlayerAggregate {
  discordId: Id | null
  names: string[]
  attacks: number
  /** Normalized alias name → attacks reported under that alias. */
  attacksByName: Map<string, number>
}

/**
 * Pure current-war attendance. No Supabase/React: the page loads `wars`, `aliases` and the
 * team roster, and this function decides one row per player.
 *
 * The universe is every rostered player who has an alias (or every alias when the server has
 * no roster), plus name-only legacy rows from `attack_counts` / `missing_list` / `absent_list`
 * so entries made before the aliases existed do not disappear. Alias rows are folded by
 * Discord id: attacks are summed across the player's alias names and the display alias is the
 * one with reports, else the alphabetically first.
 *
 * Status precedence: excused (absent + `exempt_absent`) > done (attacks >= required) >
 * partial (0 < attacks < required) > none.
 */
export function computeAttendance(input: AttendanceInput): AttendanceResult {
  const war = input.war ?? null
  const required = Number.isFinite(input.required) ? Math.max(0, input.required) : 0
  const aliases = input.aliases ?? []
  const exemptAbsent = input.exemptAbsent ?? true

  const aliasByName = new Map<string, Alias>()
  const aliasesByDiscordId = new Map<string, Alias[]>()
  for (const alias of aliases) {
    if (!alias) continue
    const name = normalizeName(alias.alias_name)
    if (name && !aliasByName.has(name)) aliasByName.set(name, alias)
    if (hasDiscordId(alias.discord_id)) {
      const key = String(alias.discord_id).trim()
      const rows = aliasesByDiscordId.get(key) ?? []
      rows.push(alias)
      aliasesByDiscordId.set(key, rows)
    }
  }

  const roster = new Set<string>()
  for (const id of input.rosterIds ?? []) {
    if (hasDiscordId(id)) roster.add(String(id).trim())
  }
  const hasRoster = roster.size > 0

  const inRoster = (discordId: Id | null): boolean =>
    !hasRoster || (hasDiscordId(discordId) && roster.has(String(discordId).trim()))

  const players = new Map<string, PlayerAggregate>()

  const keyFor = (name: string, discordId: Id | null): string =>
    hasDiscordId(discordId) ? `id:${String(discordId).trim()}` : `name:${normalizeName(name)}`

  const ensurePlayer = (name: string, discordId: Id | null): PlayerAggregate => {
    const key = keyFor(name, discordId)
    const existing = players.get(key)
    if (existing) return existing
    const created: PlayerAggregate = {
      discordId: hasDiscordId(discordId) ? discordId : null,
      names: [],
      attacks: 0,
      attacksByName: new Map(),
    }
    players.set(key, created)
    return created
  }

  const addName = (player: PlayerAggregate, name: string): void => {
    const clean = name.trim()
    if (!clean) return
    if (player.names.some((existing) => normalizeName(existing) === normalizeName(clean))) return
    player.names.push(clean)
  }

  // Universe 1: aliased players, scoped to the roster when the team has one.
  for (const alias of aliases) {
    if (!alias) continue
    if (!hasDiscordId(alias.discord_id)) {
      // A name-only alias row cannot be matched to the roster; it is only shown in the fallback.
      if (!hasRoster) {
        const player = ensurePlayer(alias.alias_name, null)
        addName(player, alias.alias_name)
      }
      continue
    }
    if (!inRoster(alias.discord_id)) continue
    const player = ensurePlayer(alias.alias_name, alias.discord_id)
    // Fold every alias of that Discord user so one player gets one row.
    for (const row of aliasesByDiscordId.get(String(alias.discord_id).trim()) ?? []) {
      addName(player, row.alias_name)
    }
  }

  const missingNames = new Set<string>()
  const missingIds = new Set<string>()
  const absentNames = new Set<string>()
  const absentIds = new Set<string>()

  const addListEntries = (entries: unknown, names: Set<string>, ids: Set<string>): void => {
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      const { name, id } = readPlayerList(entry)
      if (id) ids.add(id)
      if (!name) continue
      names.add(normalizeName(name))
      // A name that still has an alias row is not a legacy row: the alias row covers it. The
      // same goes for an entry whose Discord id resolves to an alias (the stored name may be
      // stale after a rename), so no duplicate "ghost" row appears.
      if (aliasByName.has(normalizeName(name))) continue
      if (id !== null && aliasesByDiscordId.has(id)) continue
      const player = ensurePlayer(name, null)
      addName(player, name)
    }
  }

  // Attack counts are keyed by alias name, lower-case by contract (mixed case is tolerated).
  for (const [rawName, rawCount] of Object.entries(war?.attack_counts ?? {})) {
    const name = normalizeName(rawName)
    if (!name) continue
    const count = Number(rawCount)
    if (!Number.isFinite(count) || count <= 0) continue
    const alias = aliasByName.get(name)
    let player: PlayerAggregate | undefined
    if (alias) {
      if (!inRoster(alias.discord_id)) continue
      player = ensurePlayer(
        alias.alias_name,
        hasDiscordId(alias.discord_id) ? alias.discord_id : null,
      )
    } else {
      // Legacy count with no alias row behind it: keep the name-only row.
      player = ensurePlayer(rawName, null)
      addName(player, rawName)
    }
    player.attacks += count
    player.attacksByName.set(name, (player.attacksByName.get(name) ?? 0) + count)
  }

  addListEntries(war?.missing_list, missingNames, missingIds)
  addListEntries(war?.absent_list, absentNames, absentIds)

  const matchesList = (
    player: PlayerAggregate,
    names: Set<string>,
    ids: Set<string>,
  ): boolean => {
    if (player.discordId !== null && ids.has(String(player.discordId).trim())) return true
    return player.names.some((name) => names.has(normalizeName(name)))
  }

  const displayNameFor = (player: PlayerAggregate): string => {
    const sorted = [...player.names].sort((a, b) => a.localeCompare(b))
    const reported = sorted.find((name) => (player.attacksByName.get(normalizeName(name)) ?? 0) > 0)
    return reported ?? sorted[0] ?? ''
  }

  const rows: AttendanceRow[] = []
  for (const player of Array.from(players.values())) {
    const alias = displayNameFor(player)
    if (!alias) continue
    const excused = exemptAbsent && matchesList(player, absentNames, absentIds)
    let status: AttendanceStatus
    if (excused) status = 'excused'
    else if (required > 0 && player.attacks >= required) status = 'done'
    else if (player.attacks > 0 && player.attacks < required) status = 'partial'
    else status = 'none'
    rows.push({
      alias,
      discordId: player.discordId,
      attacks: player.attacks,
      required,
      status,
      onMissingList: matchesList(player, missingNames, missingIds),
    })
  }

  rows.sort((a, b) => STATUS_SORT[a.status] - STATUS_SORT[b.status] || a.alias.localeCompare(b.alias))

  const summary: AttendanceSummary = {
    total: rows.length,
    done: 0,
    partial: 0,
    none: 0,
    excused: 0,
  }
  for (const row of rows) summary[row.status] += 1

  return { rows, summary }
}
