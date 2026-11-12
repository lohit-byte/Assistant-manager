import { UNLIMITED_TEAMS } from './plans'
import { isSnowflake } from './format'

/**
 * Pure helpers behind the Server setup page. Everything here is dependency-free (no Supabase,
 * no React) so `scripts/check-setup.cjs` can compile and assert it offline, the same way
 * `scripts/check-rating.cjs` checks `lib/rating.ts`.
 *
 * The guild row stores four optional snowflakes the bot reads:
 *   leader_role_id / colead_role_id / staff_role_id  -> bot/database.py get_staff_role_ids
 *   maze_channel_id                                  -> maze discount pings
 * Empty means "not set", never the string `''`.
 */

export type GuildSetupField =
  | 'leader_role_id'
  | 'colead_role_id'
  | 'staff_role_id'
  | 'maze_channel_id'

export interface GuildSetupValues {
  leader_role_id: string
  colead_role_id: string
  staff_role_id: string
  maze_channel_id: string
}

/** Validated values ready for `from('guilds').update(...)`; null means "not set". */
export type GuildSetupUpdate = Record<GuildSetupField, string | null>

export type GuildSetupErrors = Partial<Record<GuildSetupField, string>>

export interface GuildSetupValidation {
  ok: boolean
  errors: GuildSetupErrors
  /** Only meaningful when `ok`; invalid fields come back null. */
  update: GuildSetupUpdate
}

export const GUILD_SETUP_FIELDS: GuildSetupField[] = [
  'leader_role_id',
  'colead_role_id',
  'staff_role_id',
  'maze_channel_id',
]

export const GUILD_SETUP_LABELS: Record<GuildSetupField, string> = {
  leader_role_id: 'Leader role ID',
  colead_role_id: 'Helper staff role ID',
  staff_role_id: 'Staff role ID',
  maze_channel_id: 'Maze channel ID',
}

/**
 * A team's captains are its staff on the bot. The game allows one alliance leader plus
 * three co-leaders, so four staff per team is the most anybody can actually hold.
 */
export const MAX_TEAM_CAPTAINS = 4

/**
 * Why adding this player to the team's captains should be refused, or null when it is
 * fine. Re-adding someone who is already a captain is a no-op, not a limit violation.
 */
export function captainLimitError(captainIds: string[], discordId: string): string | null {
  const clean = String(discordId).replace(/\D/g, '')
  const ids = captainIds.map((id) => String(id).replace(/\D/g, ''))
  if (ids.includes(clean)) return null
  if (ids.length >= MAX_TEAM_CAPTAINS) {
    return `A team can have up to ${MAX_TEAM_CAPTAINS} staff (1 leader + 3 co-leads). Remove one before adding another.`
  }
  return null
}

/** Trimmed string, or null when the value is empty / whitespace only. */
export function normalizeId(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const clean = String(value).trim()
  return clean.length > 0 ? clean : null
}

export interface ParsedId {
  ok: boolean
  /** Trimmed id, or null when the field is empty ("not set"). */
  value: string | null
  error: string | null
}

/** Validate one optional Discord id: empty is fine (not set), otherwise 17–20 digits. */
export function parseDiscordId(
  value: string | number | null | undefined,
  label: string,
  kind: 'role' | 'channel' = 'role',
): ParsedId {
  const clean = normalizeId(value)
  if (clean === null) return { ok: true, value: null, error: null }
  if (!isSnowflake(clean)) {
    return {
      ok: false,
      value: null,
      error: `${label} must be a Discord ${kind} ID (17–20 digits), or empty.`,
    }
  }
  return { ok: true, value: clean, error: null }
}

export function parseRoleId(
  value: string | number | null | undefined,
  label = 'Role ID',
): ParsedId {
  return parseDiscordId(value, label, 'role')
}

export function parseChannelId(
  value: string | number | null | undefined,
  label = 'Channel ID',
): ParsedId {
  return parseDiscordId(value, label, 'channel')
}

/**
 * Validate the whole guild setup card at once. Callers save `update` with a single
 * `from('guilds').update(...)` so a half-valid form never writes.
 */
export function validateGuildSetup(values: GuildSetupValues): GuildSetupValidation {
  const errors: GuildSetupErrors = {}
  const update: GuildSetupUpdate = {
    leader_role_id: null,
    colead_role_id: null,
    staff_role_id: null,
    maze_channel_id: null,
  }

  for (const field of GUILD_SETUP_FIELDS) {
    const parsed =
      field === 'maze_channel_id'
        ? parseChannelId(values[field], GUILD_SETUP_LABELS[field])
        : parseRoleId(values[field], GUILD_SETUP_LABELS[field])
    update[field] = parsed.value
    if (!parsed.ok) errors[field] = parsed.error ?? 'Check this ID.'
  }

  return { ok: Object.keys(errors).length === 0, errors, update }
}

export type SetupTaskKey = 'teams' | GuildSetupField

export interface SetupTask {
  key: SetupTaskKey
  label: string
  /** Short human value: "3 of 5 teams", "Set", "Not set". */
  value: string
  configured: boolean
}

export interface SetupSummary {
  tasks: SetupTask[]
  configured: number
  total: number
  /**
   * Goal-gradient percentage. The bot is already in the server (the dashboard cannot load
   * otherwise), so setup is never a 0% state: the head start is counted as one extra step.
   */
  percent: number
  complete: boolean
  /** First unconfigured task, for the Overview CTA copy. */
  next: SetupTask | null
}

export interface SetupSummaryInput {
  teamCount: number
  maxTeams?: number | null
  leaderRoleId?: string | number | null
  coleadRoleId?: string | number | null
  staffRoleId?: string | number | null
  mazeChannelId?: string | number | null
}

/** Turn the guild row + team count into the Overview checklist. Pure, so it is easy to test. */
export function buildSetupSummary(input: SetupSummaryInput): SetupSummary {
  const teamCount = Math.max(0, Math.floor(input.teamCount || 0))
  const hasTeamLimit =
    input.maxTeams !== null && input.maxTeams !== undefined && input.maxTeams > 0
  const maxTeams = hasTeamLimit ? Math.floor(input.maxTeams as number) : 1
  const teamLimitText = maxTeams >= UNLIMITED_TEAMS ? 'Unlimited' : String(maxTeams)

  const tasks: SetupTask[] = [
    {
      key: 'teams',
      label: 'Teams',
      value: hasTeamLimit
        ? `${teamCount} of ${teamLimitText}`
        : `${teamCount} ${teamCount === 1 ? 'team' : 'teams'}`,
      configured: teamCount > 0,
    },
    {
      key: 'leader_role_id',
      label: 'Leader role',
      value: normalizeId(input.leaderRoleId) ? 'Set' : 'Not set',
      configured: Boolean(normalizeId(input.leaderRoleId)),
    },
    {
      key: 'colead_role_id',
      label: 'Helper role',
      value: normalizeId(input.coleadRoleId) ? 'Set' : 'Not set',
      configured: Boolean(normalizeId(input.coleadRoleId)),
    },
    {
      key: 'staff_role_id',
      label: 'Staff role',
      value: normalizeId(input.staffRoleId) ? 'Set' : 'Not set',
      configured: Boolean(normalizeId(input.staffRoleId)),
    },
    {
      key: 'maze_channel_id',
      label: 'Maze channel',
      value: normalizeId(input.mazeChannelId) ? 'Set' : 'Not set',
      configured: Boolean(normalizeId(input.mazeChannelId)),
    },
  ]

  const configured = tasks.filter((task) => task.configured).length
  const total = tasks.length
  // The +1 head start is the bot already being installed; see SetupSummary.percent.
  const percent = Math.round(((configured + 1) / (total + 1)) * 100)

  return {
    tasks,
    configured,
    total,
    percent,
    complete: configured === total,
    next: tasks.find((task) => !task.configured) ?? null,
  }
}
