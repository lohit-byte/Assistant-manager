import { NO_ALIAS_LABEL } from './format'
import type { Alias, Id, War, WarSettings } from './types'

export interface RatingRow {
  alias: string
  discordId: Id | null
  attacks: number
  required: number
  score: number
  grade: string
  excused: boolean
}

export interface RatingInput {
  war: War | null
  warSettings: WarSettings
  aliases: Alias[]
}

/** A+ ≥ 90, A ≥ 80, B ≥ 65, C ≥ 50, else D. */
export function gradeFor(score: number): string {
  if (score >= 90) return 'A+'
  if (score >= 80) return 'A'
  if (score >= 65) return 'B'
  if (score >= 50) return 'C'
  return 'D'
}

function normalizeName(name: string | null | undefined): string {
  return (name ?? '').trim().toLowerCase()
}

function hasDiscordId(discordId: Id | null | undefined): discordId is Id {
  return discordId !== null && discordId !== undefined && String(discordId).trim() !== ''
}

/**
 * Pure war attack rating. No Supabase calls: the page/component loads the rows and
 * this function decides the score, so the rules can be read and tested in one place.
 *
 * Rows are the union of war attack counts, the missing list and the absent list,
 * sorted by score (then alias). Rows are folded by Discord user id when it is known, so a player
 * with two alias rows cannot appear twice with half a score. Excused players (absent list and
 * `exempt_absent` on) are never ranked and are returned after the ranked rows so the UI can list
 * them separately.
 */
export function computeRatings(input: RatingInput): RatingRow[] {
  const required = Math.max(0, input.warSettings?.attacks_required ?? 0)
  const aliases = input.aliases ?? []

  const aliasByName = new Map<string, Alias>()
  const aliasByDiscordId = new Map<string, Alias>()
  for (const alias of aliases) {
    const name = normalizeName(alias.alias_name)
    if (name) aliasByName.set(name, alias)
    if (hasDiscordId(alias.discord_id)) {
      // The first alias row wins as the display name for a player with several aliases.
      if (!aliasByDiscordId.has(String(alias.discord_id))) {
        aliasByDiscordId.set(String(alias.discord_id), alias)
      }
    }
  }

  const rows = new Map<string, RatingRow>()

  /** One row per Discord user when known, else per alias name. */
  const rowKeyFor = (name: string, discordId: Id | null): string =>
    hasDiscordId(discordId) ? `id:${String(discordId)}` : `name:${normalizeName(name)}`

  const rowFor = (name: string, discordId: Id | null): RatingRow => {
    const key = rowKeyFor(name, discordId)
    const existing = rows.get(key)
    if (existing) {
      if (!hasDiscordId(existing.discordId) && hasDiscordId(discordId)) {
        existing.discordId = discordId
      }
      return existing
    }
    const created: RatingRow = {
      alias: name,
      discordId,
      attacks: 0,
      required,
      score: 0,
      grade: 'D',
      excused: false,
    }
    rows.set(key, created)
    return created
  }

  const rowForIdentity = (name: string | null | undefined, discordId: Id | null): RatingRow | null => {
    const clean = (name ?? '').trim()
    const aliasFromId = hasDiscordId(discordId)
      ? aliasByDiscordId.get(String(discordId)) ?? null
      : null
    // Prefer the alias row so a mixed-case war key and a list entry land on the same player.
    const alias = aliasFromId ?? (clean ? aliasByName.get(normalizeName(clean)) ?? null : null)
    if (alias) return rowFor(alias.alias_name, alias.discord_id)
    if (!clean) {
      if (!hasDiscordId(discordId)) return null
      return rowFor(NO_ALIAS_LABEL, discordId)
    }
    return rowFor(clean, discordId)
  }

  /* Attack counts are keyed by alias, the lists carry names (or legacy strings). */
  for (const [name, count] of Object.entries(input.war?.attack_counts ?? {})) {
    const row = rowForIdentity(name, null)
    if (!row) continue
    const value = Number(count)
    // Sum so two alias rows for the same Discord user add up; the score caps at `required`.
    if (Number.isFinite(value) && value > 0) row.attacks += value
  }

  const addListRows = (entries: unknown): void => {
    if (!Array.isArray(entries)) return
    for (const entry of entries) {
      if (typeof entry === 'string') {
        if (entry.trim()) rowForIdentity(entry, null)
        continue
      }
      if (!entry || typeof entry !== 'object') continue
      const named = entry as { name?: unknown; id?: Id | null }
      const name = typeof named.name === 'string' ? named.name : null
      const id = hasDiscordId(named.id) ? named.id : null
      if (name && name.trim()) {
        const alias = aliasByName.get(normalizeName(name))
        rowFor(alias?.alias_name ?? name, alias?.discord_id ?? id)
      } else if (id) {
        rowForIdentity(null, id)
      }
    }
  }

  addListRows(input.war?.missing_list)
  // Excused players may sit only on the absent list (staff remove them from missing), but the
  // UI still lists them, so they join the union as unranked rows.
  addListRows(input.war?.absent_list)

  const absentNames = new Set<string>()
  const absentIds = new Set<string>()
  const absentEntries = input.warSettings?.exempt_absent ? input.war?.absent_list ?? [] : []
  for (const entry of absentEntries) {
    if (typeof entry === 'string') {
      const name = normalizeName(entry)
      if (name) {
        absentNames.add(name)
        const alias = aliasByName.get(name)
        if (alias && hasDiscordId(alias.discord_id)) absentIds.add(String(alias.discord_id))
      }
      continue
    }
    if (!entry || typeof entry !== 'object') continue
    const named = entry as { name?: unknown; id?: Id | null }
    const name = normalizeName(typeof named.name === 'string' ? named.name : null)
    if (name) {
      absentNames.add(name)
      const alias = aliasByName.get(name)
      if (alias && hasDiscordId(alias.discord_id)) absentIds.add(String(alias.discord_id))
    }
    if (hasDiscordId(named.id)) absentIds.add(String(named.id))
  }

  const all = Array.from(rows.values())
  for (const row of all) {
    row.score = required > 0 ? Math.round(100 * Math.min(row.attacks / required, 1)) : 0
    row.grade = gradeFor(row.score)
    row.excused =
      (hasDiscordId(row.discordId) && absentIds.has(String(row.discordId))) ||
      absentNames.has(normalizeName(row.alias))
  }

  const ranked = all
    .filter((row) => !row.excused)
    .sort((a, b) => b.score - a.score || a.alias.localeCompare(b.alias))
  const excused = all
    .filter((row) => row.excused)
    .sort((a, b) => a.alias.localeCompare(b.alias))
  return [...ranked, ...excused]
}
