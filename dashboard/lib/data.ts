import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_ATTACKS_REQUIRED, MAZE_WINDOWS, type MazeWindow } from './constants'
import { captainLimitError } from './setup'
import type {
  Alias,
  Guild,
  Id,
  MazeEvent,
  MazePingMention,
  MazeSchedule,
  RaceLog,
  RaceState,
  Team,
  TeamCaptain,
  War,
  WarLog,
  WarSettings,
  Warning,
} from './types'

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`)
}

function cleanSnowflake(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null
  const clean = String(value).trim()
  return clean || null
}

/* ------------------------------------------------------------------ guild */

export async function getGuild(supabase: SupabaseClient, guildId: string): Promise<Guild | null> {
  const { data, error } = await supabase
    .from('guilds')
    .select('*')
    .eq('guild_id', guildId)
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load server')
  return (data as Guild | null) ?? null
}

/* ------------------------------------------------------------- war config */

export async function getWarSettings(
  supabase: SupabaseClient,
  guildId: string,
): Promise<WarSettings> {
  const { data, error } = await supabase
    .from('war_settings')
    .select('*')
    .eq('guild_id', guildId)
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load war settings')

  const row = data as Partial<WarSettings> | null
  return {
    guild_id: guildId,
    attacks_required: row?.attacks_required ?? DEFAULT_ATTACKS_REQUIRED,
    exempt_absent: row?.exempt_absent ?? true,
  }
}

export async function saveWarSettings(
  supabase: SupabaseClient,
  guildId: string,
  values: Pick<WarSettings, 'attacks_required' | 'exempt_absent'>,
): Promise<void> {
  const { error } = await supabase.from('war_settings').upsert(
    {
      guild_id: guildId,
      attacks_required: values.attacks_required,
      exempt_absent: values.exempt_absent,
    },
    { onConflict: 'guild_id' },
  )
  throwIfError(error, 'Could not save war settings')
}

/* -------------------------------------------------------------------- war */

export async function getWar(supabase: SupabaseClient, channelId: string): Promise<War | null> {
  const { data, error } = await supabase
    .from('wars')
    .select('*')
    .eq('channel_id', channelId)
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load the war')
  return (data as War | null) ?? null
}

export async function updateWar(
  supabase: SupabaseClient,
  channelId: string,
  patch: Partial<Omit<War, 'channel_id'>>,
): Promise<void> {
  const { error } = await supabase.from('wars').update(patch).eq('channel_id', channelId)
  throwIfError(error, 'Could not update the war')
}

export async function resetWarLists(supabase: SupabaseClient, channelId: string): Promise<void> {
  await updateWar(supabase, channelId, {
    missing_list: [],
    absent_list: [],
    attack_counts: {},
  })
}

export async function endWar(supabase: SupabaseClient, channelId: string): Promise<void> {
  await updateWar(supabase, channelId, {
    is_active: false,
    phase: 'ended',
    status_message_id: null,
  })
}

/* ------------------------------------------------------------------- race */

export async function getRaceState(
  supabase: SupabaseClient,
  channelId: string,
): Promise<RaceState | null> {
  const { data, error } = await supabase
    .from('race_state')
    .select('*')
    .eq('channel_id', channelId)
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load race state')
  return (data as RaceState | null) ?? null
}

export async function saveRaceState(
  supabase: SupabaseClient,
  channelId: string,
  guildId: string,
  patch: Partial<Omit<RaceState, 'guild_id' | 'channel_id'>>,
): Promise<void> {
  const { error } = await supabase.from('race_state').upsert(
    { channel_id: channelId, guild_id: guildId, ...patch },
    { onConflict: 'channel_id' },
  )
  throwIfError(error, 'Could not save race state')
}

/* ------------------------------------------------------------------- maze */

/** The live maze, or the next one on the shared calendar. */
export async function getActiveMazeEvent(
  supabase: SupabaseClient,
): Promise<MazeEvent | null> {
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('maze_events')
    .select('*')
    .gte('event_end', cutoff)
    .neq('status', 'cancelled')
    .order('event_start', { ascending: true })
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load the maze event')
  return (data as MazeEvent | null) ?? null
}

/** Upcoming maze events, soonest first (the platform calendar). */
export async function listMazeEvents(
  supabase: SupabaseClient,
  limit = 12,
): Promise<MazeEvent[]> {
  const cutoff = new Date(Date.now() - 6 * 3600_000).toISOString()
  const { data, error } = await supabase
    .from('maze_events')
    .select('*')
    .gte('event_end', cutoff)
    .neq('status', 'cancelled')
    .order('event_start', { ascending: true })
    .limit(limit)

  throwIfError(error, 'Could not load the maze calendar')
  return (data as MazeEvent[] | null) ?? []
}

/**
 * Add a predicted maze to the shared calendar (platform owner only in the UI).
 * Select-then-write instead of an upsert on event_start: the live database does not
 * guarantee a unique index there, and a confirmed event must not be demoted to
 * "scheduled" by re-adding the same date.
 */
export async function addMazeEvent(
  supabase: SupabaseClient,
  values: { event_start: string; event_end: string },
): Promise<void> {
  const payload = {
    event_start: values.event_start,
    event_end: values.event_end,
    maze_type: '7d',
    status: 'scheduled',
    source: 'calendar',
  }
  const { data: existing, error: readError } = await supabase
    .from('maze_events')
    .select('id,status')
    .eq('event_start', values.event_start)
    .limit(1)
    .maybeSingle()
  throwIfError(readError, 'Could not check the maze calendar')

  if (existing?.status === 'confirmed') return // already the real event, nothing to add
  if (existing) {
    const { error } = await supabase.from('maze_events').update(payload).eq('id', existing.id)
    throwIfError(error, 'Could not add the maze event')
    return
  }
  const { error } = await supabase.from('maze_events').insert(payload)
  throwIfError(error, 'Could not add the maze event')
}

export async function cancelMazeEvent(supabase: SupabaseClient, id: Id): Promise<void> {
  const { error } = await supabase
    .from('maze_events')
    .update({ status: 'cancelled', updated_at: new Date().toISOString() })
    .eq('id', id)
  throwIfError(error, 'Could not remove the maze event')
}

/**
 * Confirm (or correct) the shared maze from the in-game countdown. Any server's
 * staff does this from the dashboard; the bot re-arms every server afterwards.
 */
export async function confirmMazeEvent(
  supabase: SupabaseClient,
  guildId: string,
  discordId: string | null,
  values: { event_start: string; event_end: string; existing: MazeEvent | null },
): Promise<void> {
  const payload = {
    event_start: values.event_start,
    event_end: values.event_end,
    status: 'confirmed',
    source: 'report',
    confirmed_by_guild: guildId,
    confirmed_by_user: discordId,
    updated_at: new Date().toISOString(),
  }
  if (values.existing) {
    const { error } = await supabase
      .from('maze_events')
      .update(payload)
      .eq('id', values.existing.id)
    throwIfError(error, 'Could not confirm the maze')
    return
  }
  const { error } = await supabase.from('maze_events').insert({ ...payload, maze_type: '7d' })
  throwIfError(error, 'Could not confirm the maze')
}

/**
 * The editable discount ladder. `windows` is null when the built-in table
 * (`MAZE_WINDOWS`, mirrored in bot/maze_timing.py) is in use.
 */
export interface MazeSettings {
  windows: MazeWindow[] | null
  updated_by: Id | null
  updated_at: string | null
}

function readWindows(raw: unknown): MazeWindow[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const windows: MazeWindow[] = []
  for (const item of raw) {
    if (!Array.isArray(item) || item.length !== 3) return null
    const [start, end, percent] = item
    if (typeof start !== 'number' || typeof end !== 'number' || typeof percent !== 'string') {
      return null
    }
    windows.push({ start, end, percent })
  }
  return windows
}

export async function getMazeSettings(supabase: SupabaseClient): Promise<MazeSettings> {
  const { data, error } = await supabase
    .from('maze_settings')
    .select('windows,updated_by,updated_at')
    .eq('id', 1)
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load the maze settings')
  return {
    windows: readWindows(data?.windows),
    updated_by: (data?.updated_by as Id | null) ?? null,
    updated_at: (data?.updated_at as string | null) ?? null,
  }
}

/** Save an edited ladder (`null` restores the built-in table). */
export async function saveMazeWindows(
  supabase: SupabaseClient,
  windows: MazeWindow[] | null,
  discordId: string | null,
): Promise<void> {
  const { error } = await supabase.from('maze_settings').upsert(
    {
      id: 1,
      windows: windows ? windows.map((window) => [window.start, window.end, window.percent]) : null,
      updated_by: discordId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' },
  )
  throwIfError(error, 'Could not save the maze schedule')
}

/** Queue a "ping now" request; the bot drains it within ~20 seconds. */
export async function requestMazePing(
  supabase: SupabaseClient,
  guildId: string,
  percent: string,
  discordId: string | null,
): Promise<void> {
  const { error } = await supabase.from('maze_pings').insert({
    guild_id: guildId,
    percent,
    requested_by: discordId,
  })
  throwIfError(error, 'Could not queue the maze ping')
}

/** The per-server alert subscription (channel, mention mode, on/off). */
export async function getMazeSchedule(
  supabase: SupabaseClient,
  guildId: string,
): Promise<MazeSchedule | null> {
  const { data, error } = await supabase
    .from('maze_schedules')
    .select('*')
    .eq('guild_id', guildId)
    .limit(1)
    .maybeSingle()

  throwIfError(error, 'Could not load the maze alerts')
  return (data as MazeSchedule | null) ?? null
}

export async function saveMazeSchedule(
  supabase: SupabaseClient,
  guildId: string,
  values: {
    /** Never null: maze_schedules.channel_id is NOT NULL in the live database. */
    channel_id: string
    ping_enabled_global: boolean
    ping_mention: MazePingMention
    ping_role_id: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('maze_schedules').upsert(
    {
      guild_id: guildId,
      channel_id: values.channel_id,
      ping_enabled_global: values.ping_enabled_global,
      ping_mention: values.ping_mention,
      // The role is only meaningful while the mention mode is 'role'; clear it otherwise.
      ping_role_id: values.ping_mention === 'role' ? values.ping_role_id : null,
    },
    { onConflict: 'guild_id' },
  )
  throwIfError(error, 'Could not save the maze alerts')
}

export async function deleteMazeSchedule(
  supabase: SupabaseClient,
  guildId: string,
): Promise<void> {
  const { error } = await supabase.from('maze_schedules').delete().eq('guild_id', guildId)
  throwIfError(error, 'Could not turn maze alerts off')
}

/* ---------------------------------------------------------------- aliases */

/**
 * True when this Discord user has an alias row for the guild. Staff create those rows
 * with `!alias add`, so the dashboard uses this as the membership proof that lets a
 * regular member view a premium server read-only.
 */
export async function isAliasMember(
  supabase: SupabaseClient,
  guildId: string,
  discordId: string,
): Promise<boolean> {
  const cleanId = discordId.replace(/\D/g, '')
  if (!cleanId) return false

  const { data, error } = await supabase
    .from('aliases')
    .select('id')
    .eq('guild_id', guildId)
    .eq('discord_id', cleanId)
    .limit(1)
    .maybeSingle()

  // A failed lookup means "no membership" rather than a broken dashboard.
  if (error) return false
  return Boolean(data)
}

export async function listAliases(supabase: SupabaseClient, guildId: string): Promise<Alias[]> {
  const { data, error } = await supabase
    .from('aliases')
    .select('*')
    .eq('guild_id', guildId)
    .order('alias_name', { ascending: true })

  throwIfError(error, 'Could not load aliases')
  return (data as Alias[] | null) ?? []
}

export async function addAlias(
  supabase: SupabaseClient,
  guildId: string,
  discordId: string,
  aliasName: string,
): Promise<void> {
  const cleanId = discordId.replace(/\D/g, '')
  const cleanAlias = aliasName.trim().toLowerCase()

  await supabase
    .from('users')
    .upsert({ discord_id: cleanId }, { onConflict: 'discord_id', ignoreDuplicates: true })

  const { error } = await supabase.from('aliases').upsert(
    { guild_id: guildId, discord_id: cleanId, alias_name: cleanAlias },
    { onConflict: 'guild_id,alias_name' },
  )
  throwIfError(error, 'Could not add alias')
}

export async function deleteAlias(supabase: SupabaseClient, id: number): Promise<void> {
  const { error } = await supabase.from('aliases').delete().eq('id', id)
  throwIfError(error, 'Could not delete alias')
}

/**
 * Rename an alias in place and migrate the guild's live war data, so a rename during an active
 * war does not lose the player's attack counts or create a ghost missing entry.
 * Throws a user-facing message when the new name is taken.
 */
export async function renameAlias(
  supabase: SupabaseClient,
  guildId: string,
  alias: Alias,
  newName: string,
): Promise<void> {
  const oldName = alias.alias_name.trim().toLowerCase()
  const cleanName = newName.trim().toLowerCase()
  if (!cleanName) throw new Error('Enter a new alias name.')
  // Renaming to the current name is the same user mistake as renaming onto another alias.
  if (cleanName === oldName) throw new Error(`“${cleanName}” already exists.`)

  // Aliases are stored lower-case; compare in JS so mixed-case rows are caught too.
  const aliases = await listAliases(supabase, guildId)
  const duplicate = aliases.find(
    (item) => item.id !== alias.id && item.alias_name.trim().toLowerCase() === cleanName,
  )
  if (duplicate) throw new Error(`“${cleanName}” already exists.`)

  const { error } = await supabase
    .from('aliases')
    .update({ alias_name: cleanName })
    .eq('id', alias.id)
  throwIfError(error, 'Could not rename the alias')

  const { data, error: warsError } = await supabase
    .from('wars')
    .select('channel_id,attack_counts,missing_list,absent_list')
    .eq('guild_id', guildId)
  if (warsError) {
    throw new Error(
      `Alias renamed, but the live war data could not be migrated: ${warsError.message}`,
    )
  }

  /**
   * Mirrors the bot's `_rename_entries`: rewrites `{ "name": ... }` entries and also the
   * legacy plain-string entries old war rows may still hold.
   */
  const renameEntries = (raw: unknown): { entries: unknown[] | null; changed: boolean } => {
    if (raw === null || raw === undefined) return { entries: null, changed: false }
    if (!Array.isArray(raw)) return { entries: null, changed: false }
    let changed = false
    const next = raw.map((entry: unknown) => {
      if (typeof entry === 'string') {
        if (entry.trim().toLowerCase() === oldName) {
          changed = true
          return cleanName
        }
        return entry
      }
      if (entry && typeof entry === 'object') {
        const name = (entry as { name?: unknown }).name
        if (typeof name === 'string' && name.trim().toLowerCase() === oldName) {
          changed = true
          return { ...(entry as Record<string, unknown>), name: cleanName }
        }
      }
      return entry
    })
    return { entries: next, changed }
  }

  for (const war of (data ?? []) as Pick<War, 'channel_id' | 'attack_counts' | 'missing_list' | 'absent_list'>[]) {
    const counts: Record<string, number> = {}
    let changed = false
    for (const [name, value] of Object.entries(war.attack_counts ?? {})) {
      if (name.trim().toLowerCase() === oldName) {
        counts[cleanName] = value
        changed = true
      } else {
        counts[name] = value
      }
    }
    const missing = renameEntries(war.missing_list)
    const absent = renameEntries(war.absent_list)
    if (!changed && !missing.changed && !absent.changed) continue

    const { error: updateError } = await supabase
      .from('wars')
      .update({
        attack_counts: counts,
        missing_list: missing.entries ?? [],
        absent_list: absent.entries ?? [],
      })
      .eq('channel_id', war.channel_id)
    throwIfError(updateError, 'Alias renamed, but a war could not be updated')
  }
}

/* -------------------------------------------------------------------- teams */

export interface TeamValues {
  name: string
  war_channel_id: string | null
  race_channel_id: string | null
  team_role_id: string | null
}

type WriteError = { message: string; code?: string; details?: string | null } | null

/** Friendly message for Postgres unique-violation (23505) writes on teams. */
function throwTeamWriteError(error: WriteError, context: string): void {
  if (!error) return
  if (error.code === '23505') {
    const text = `${error.message ?? ''} ${error.details ?? ''}`
    if (/war_channel/i.test(text)) {
      throw new Error('That war channel is already linked to another team.')
    }
    if (/race_channel/i.test(text)) {
      throw new Error('That race channel is already linked to another team.')
    }
    if (/name/i.test(text)) {
      throw new Error('A team with that name already exists.')
    }
    throw new Error('That team already exists.')
  }
  throw new Error(`${context}: ${error.message}`)
}

/** Friendly message for Postgres unique-violation (23505) writes on team captains. */
function throwCaptainWriteError(error: WriteError, context: string): void {
  if (!error) return
  if (error.code === '23505') {
    throw new Error('That user is already a captain of this team.')
  }
  throw new Error(`${context}: ${error.message}`)
}

/**
 * The bot still reads `wars.team_role_id` for announcements, so every team-role edit is
 * mirrored onto the team's war row when that row exists. A no-op when no war row exists.
 */
async function mirrorTeamRoleToWar(
  supabase: SupabaseClient,
  warChannelId: string | null,
  teamRoleId: string | null,
): Promise<void> {
  if (!warChannelId) return
  const { error } = await supabase
    .from('wars')
    .update({ team_role_id: teamRoleId })
    .eq('channel_id', warChannelId)
  if (error) {
    throw new Error(`Team saved, but the war role could not be synced: ${error.message}`)
  }
}

export async function listTeams(supabase: SupabaseClient, guildId: string): Promise<Team[]> {
  const { data, error } = await supabase
    .from('teams')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: true })

  throwIfError(error, 'Could not load teams')
  return (data as Team[] | null) ?? []
}

export async function createTeam(
  supabase: SupabaseClient,
  guildId: string,
  values: TeamValues,
): Promise<void> {
  const name = values.name.trim()
  if (!name) throw new Error('Enter a team name.')

  const warChannelId = cleanSnowflake(values.war_channel_id)
  const teamRoleId = cleanSnowflake(values.team_role_id)

  const { error } = await supabase.from('teams').insert({
    guild_id: guildId,
    name,
    war_channel_id: warChannelId,
    race_channel_id: cleanSnowflake(values.race_channel_id),
    team_role_id: teamRoleId,
  })
  throwTeamWriteError(error, 'Could not create the team')

  // A role picked while creating the team must reach the bot too. Leaving it empty keeps any
  // existing `wars.team_role_id` (the bot's own role still wins until the team sets one).
  if (teamRoleId) await mirrorTeamRoleToWar(supabase, warChannelId, teamRoleId)
}

/**
 * Save a team and keep the bot's announcement role in sync: the bot still reads
 * `wars.team_role_id`, so mirror `teams.team_role_id` onto the team's war row when it exists.
 */
export async function saveTeam(
  supabase: SupabaseClient,
  team: Team,
  values: TeamValues,
): Promise<void> {
  const name = values.name.trim()
  if (!name) throw new Error('Enter a team name.')

  const warChannelId = cleanSnowflake(values.war_channel_id)
  const teamRoleId = cleanSnowflake(values.team_role_id)

  const { error } = await supabase
    .from('teams')
    .update({
      name,
      war_channel_id: warChannelId,
      race_channel_id: cleanSnowflake(values.race_channel_id),
      team_role_id: teamRoleId,
    })
    .eq('id', team.id)
  throwTeamWriteError(error, 'Could not save the team')

  await mirrorTeamRoleToWar(supabase, warChannelId, teamRoleId)
}

/**
 * The War page's "Save Team Role" control. It writes the war row the bot reads and mirrors the
 * value onto the owning team row, so `teams.team_role_id` stays the single source of truth.
 */
export async function saveWarTeamRole(
  supabase: SupabaseClient,
  channelId: string,
  teamId: number | null,
  teamRoleId: string | null,
): Promise<void> {
  const cleanRole = cleanSnowflake(teamRoleId)
  const { error } = await supabase
    .from('wars')
    .update({ team_role_id: cleanRole })
    .eq('channel_id', channelId)
  throwIfError(error, 'Could not save the team role')

  if (teamId !== null) {
    const { error: teamError } = await supabase
      .from('teams')
      .update({ team_role_id: cleanRole })
      .eq('id', teamId)
    if (teamError) {
      throw new Error(`Team role saved to the war, but the team could not be updated: ${teamError.message}`)
    }
  }
}

export async function deleteTeam(supabase: SupabaseClient, teamId: number): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', teamId)
  throwIfError(error, 'Could not delete the team')
}

export interface TeamPlayer {
  team_id: number
  discord_id: Id
}

/**
 * One team's roster (`team_players`). A missing table (a deploy before the migration) or a
 * failed read means "no roster recorded": callers fall back to every alias instead of the War
 * page breaking.
 */
export async function listTeamPlayers(
  supabase: SupabaseClient,
  teamIds: number[],
): Promise<TeamPlayer[]> {
  if (teamIds.length === 0) return []
  const { data, error } = await supabase
    .from('team_players')
    .select('*')
    .in('team_id', teamIds)

  if (error) return []
  return (data as TeamPlayer[] | null) ?? []
}

export async function listTeamCaptains(
  supabase: SupabaseClient,
  teamIds: number[],
): Promise<TeamCaptain[]> {
  if (teamIds.length === 0) return []
  const { data, error } = await supabase
    .from('team_captains')
    .select('*')
    .in('team_id', teamIds)

  throwIfError(error, 'Could not load team captains')
  return (data as TeamCaptain[] | null) ?? []
}

export async function addTeamCaptain(
  supabase: SupabaseClient,
  guildId: string,
  teamId: number,
  discordId: string,
): Promise<void> {
  const cleanId = discordId.replace(/\D/g, '')
  if (cleanId.length < 17) throw new Error('Enter a valid Discord user ID (17–20 digits).')

  // A team's captains are its staff; the game allows 1 leader + 3 co-leads, so four.
  const existing = await supabase
    .from('team_captains')
    .select('discord_id')
    .eq('team_id', teamId)
  throwIfError(existing.error, 'Could not check the team captains')
  const limitError = captainLimitError(
    (existing.data ?? []).map((row) => String((row as { discord_id: number }).discord_id)),
    cleanId,
  )
  if (limitError) throw new Error(limitError)

  // `team_captains.discord_id` references `users`, exactly like an alias row does.
  await supabase
    .from('users')
    .upsert({ discord_id: cleanId }, { onConflict: 'discord_id', ignoreDuplicates: true })

  const { error } = await supabase
    .from('team_captains')
    .upsert(
      { team_id: teamId, discord_id: cleanId },
      { onConflict: 'team_id,discord_id', ignoreDuplicates: true },
    )
  throwCaptainWriteError(error, 'Could not add the captain')
}

export async function removeTeamCaptain(
  supabase: SupabaseClient,
  teamId: number,
  discordId: string,
): Promise<void> {
  const { error } = await supabase
    .from('team_captains')
    .delete()
    .eq('team_id', teamId)
    .eq('discord_id', String(discordId).replace(/\D/g, ''))
  throwIfError(error, 'Could not remove the captain')
}

/**
 * Every team this Discord user captains, across servers. A `team_captains` row is an access
 * grant on any plan, so the server picker uses this to list captain servers. Lookup failures
 * (table missing before the migration, network) mean "no captain teams", never a broken page.
 */
export async function listCaptainTeams(
  supabase: SupabaseClient,
  discordId: string,
): Promise<Team[]> {
  const cleanId = discordId.replace(/\D/g, '')
  if (!cleanId) return []

  const { data, error } = await supabase
    .from('team_captains')
    .select('team_id')
    .eq('discord_id', cleanId)
  if (error) return []

  const teamIds = Array.from(
    new Set(
      (data ?? [])
        .map((row) => Number((row as { team_id: number }).team_id))
        .filter((id) => Number.isFinite(id)),
    ),
  )
  if (teamIds.length === 0) return []

  const { data: teams, error: teamsError } = await supabase
    .from('teams')
    .select('*')
    .in('id', teamIds)
  if (teamsError) return []
  return (teams as Team[] | null) ?? []
}

/* -------------------------------------------------------------- activity logs */

export async function listWarLogs(
  supabase: SupabaseClient,
  channelId: string,
  sinceIso: string | null,
  limit = 25,
): Promise<WarLog[]> {
  let query = supabase
    .from('war_logs')
    .select('*')
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (sinceIso) query = query.gte('created_at', sinceIso)

  const { data, error } = await query
  throwIfError(error, 'Could not load the attack log')
  return (data as WarLog[] | null) ?? []
}

export async function listRaceLogs(
  supabase: SupabaseClient,
  guildId: string,
  channelId: string,
  sinceIso: string | null,
): Promise<RaceLog[]> {
  let query = supabase
    .from('race_logs')
    .select('*')
    .eq('guild_id', guildId)
    .eq('channel_id', channelId)
    .order('created_at', { ascending: false })
    .limit(500)
  if (sinceIso) query = query.gte('created_at', sinceIso)

  const { data, error } = await query
  throwIfError(error, 'Could not load race activity')
  return (data as RaceLog[] | null) ?? []
}

/* ------------------------------------------------------------- teams overview */

export interface TeamSnapshot {
  team: Team
  captains: TeamCaptain[]
  war: War | null
  race: RaceState | null
  /**
   * Newest `war_logs` row only, used for the "last attack" label. Raw log rows stay on the
   * staff/captain War page; the Overview never ships the whole log to members.
   */
  lastWarLog: WarLog | null
  raceLogs: RaceLog[]
}

export interface TeamsOverview {
  teams: TeamSnapshot[]
  /** War channels the bot knows about that no team owns yet (Setup can import them). */
  detectedWarChannels: string[]
  /** Race channels the bot knows about that no team owns yet. */
  detectedRaceChannels: string[]
  warSettings: WarSettings
  aliases: Alias[]
}

/**
 * Everything the one-stop Overview needs: the guild's teams with their war/race rows, captains
 * and activity logs, plus channels the bot already tracks that are not in a team yet.
 * Team queries tolerate a missing `teams` table so a pre-migration deploy still renders.
 */
export async function getTeamsOverview(
  supabase: SupabaseClient,
  guildId: string,
): Promise<TeamsOverview> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000).toISOString()

  const [settingsResult, aliasesResult, warsResult, raceResult, teamsResult] =
    await Promise.allSettled([
      getWarSettings(supabase, guildId),
      listAliases(supabase, guildId),
      supabase.from('wars').select('*').eq('guild_id', guildId),
      supabase.from('race_state').select('*').eq('guild_id', guildId),
      listTeams(supabase, guildId),
    ])

  const warSettings: WarSettings =
    settingsResult.status === 'fulfilled'
      ? settingsResult.value
      : { guild_id: guildId, attacks_required: DEFAULT_ATTACKS_REQUIRED, exempt_absent: true }
  const aliases = aliasesResult.status === 'fulfilled' ? aliasesResult.value : []
  const wars =
    warsResult.status === 'fulfilled' && !warsResult.value.error
      ? ((warsResult.value.data as War[] | null) ?? [])
      : []
  const races =
    raceResult.status === 'fulfilled' && !raceResult.value.error
      ? ((raceResult.value.data as RaceState[] | null) ?? [])
      : []
  const teams = teamsResult.status === 'fulfilled' ? teamsResult.value : []

  const warByChannel = new Map(wars.map((war) => [String(war.channel_id), war]))
  const raceByChannel = new Map(races.map((race) => [String(race.channel_id), race]))

  const captains =
    teams.length > 0
      ? await listTeamCaptains(supabase, teams.map((team) => team.id)).catch(() => [])
      : []

  const snapshots = await Promise.all(
    teams.map(async (team): Promise<TeamSnapshot> => {
      const warChannel = team.war_channel_id !== null ? String(team.war_channel_id) : null
      const raceChannel = team.race_channel_id !== null ? String(team.race_channel_id) : null
      const war = warChannel ? warByChannel.get(warChannel) ?? null : null
      const race = raceChannel ? raceByChannel.get(raceChannel) ?? null : null
      // The race half of the rating looks at the active war's window; without an active war
      // it falls back to the last seven days.
      const windowStart = war?.is_active ? war.war_start ?? sevenDaysAgo : sevenDaysAgo

      const [lastWarLog, raceLogs] = await Promise.all([
        warChannel
          ? listWarLogs(supabase, warChannel, war?.war_start ?? null, 1)
              .then((rows) => rows[0] ?? null)
              .catch(() => null)
          : Promise.resolve<WarLog | null>(null),
        raceChannel
          ? listRaceLogs(supabase, guildId, raceChannel, windowStart).catch(() => [])
          : Promise.resolve<RaceLog[]>([]),
      ])

      return {
        team,
        war,
        race,
        lastWarLog,
        raceLogs,
        captains: captains.filter((captain) => Number(captain.team_id) === Number(team.id)),
      }
    }),
  )

  const teamWarChannels = new Set(
    teams
      .filter((team) => team.war_channel_id !== null)
      .map((team) => String(team.war_channel_id)),
  )
  const teamRaceChannels = new Set(
    teams
      .filter((team) => team.race_channel_id !== null)
      .map((team) => String(team.race_channel_id)),
  )

  const detectedWarChannels = wars
    .map((war) => String(war.channel_id))
    .filter((channelId) => !teamWarChannels.has(channelId))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const detectedRaceChannels = races
    .map((race) => String(race.channel_id))
    .filter((channelId) => !teamRaceChannels.has(channelId))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))

  return {
    teams: snapshots,
    detectedWarChannels,
    detectedRaceChannels,
    warSettings,
    aliases,
  }
}

/* --------------------------------------------------------------- warnings */

export async function listWarnings(
  supabase: SupabaseClient,
  guildId: string,
): Promise<Warning[]> {
  const { data, error } = await supabase
    .from('warnings')
    .select('*')
    .eq('guild_id', guildId)
    .order('created_at', { ascending: false })
    .limit(50)

  throwIfError(error, 'Could not load warnings')
  return (data as Warning[] | null) ?? []
}

export async function addWarning(
  supabase: SupabaseClient,
  guildId: string,
  discordId: string,
  reason: string,
  issuedBy: string | null,
): Promise<void> {
  const { error } = await supabase.from('warnings').insert({
    guild_id: guildId,
    discord_id: discordId.replace(/\D/g, ''),
    reason: reason.trim() || 'No reason provided',
    issued_by: issuedBy,
  })
  throwIfError(error, 'Could not add warning')
}

export async function deleteWarning(
  supabase: SupabaseClient,
  guildId: string,
  id: number,
): Promise<void> {
  const { error } = await supabase
    .from('warnings')
    .delete()
    .eq('id', id)
    .eq('guild_id', guildId)
  throwIfError(error, 'Could not delete warning')
}

/* ---------------------------------------------------------------- summary */

export interface GuildSummary {
  war: War | null
  race: RaceState | null
  maze: MazeSchedule | null
  mazeEvent: MazeEvent | null
  mazeWindows: MazeWindow[] | null
  aliasCount: number
  warningCount: number
}

export async function getGuildSummary(
  supabase: SupabaseClient,
  guildId: string,
  channelId?: string | null
): Promise<GuildSummary> {
  // If a channel is selected, fetch its specific war and race. Otherwise, fetch the first available.
  const warPromise = channelId 
    ? getWar(supabase, channelId)
    : supabase.from('wars').select('*').eq('guild_id', guildId).eq('is_active', true).limit(1).maybeSingle().then(res => res.data as War);

  const racePromise = channelId
    ? getRaceState(supabase, channelId)
    : supabase.from('race_state').select('*').eq('guild_id', guildId).limit(1).maybeSingle().then(res => res.data as RaceState);

  const [war, race, maze, mazeEvent, mazeSettings, aliases, warnings] = await Promise.allSettled([
    warPromise,
    racePromise,
    getMazeSchedule(supabase, guildId),
    getActiveMazeEvent(supabase),
    getMazeSettings(supabase),
    supabase.from('aliases').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
    supabase.from('warnings').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
  ])

  return {
    war: war.status === 'fulfilled' ? war.value : null,
    race: race.status === 'fulfilled' ? race.value : null,
    maze: maze.status === 'fulfilled' ? maze.value : null,
    mazeEvent: mazeEvent.status === 'fulfilled' ? mazeEvent.value : null,
    mazeWindows:
      mazeSettings.status === 'fulfilled' ? mazeSettings.value.windows ?? null : null,
    aliasCount: aliases.status === 'fulfilled' ? aliases.value.count ?? 0 : 0,
    warningCount: warnings.status === 'fulfilled' ? warnings.value.count ?? 0 : 0,
  }
}
