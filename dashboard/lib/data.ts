import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_ATTACKS_REQUIRED } from './constants'
import type {
  Alias,
  Guild,
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

  throwIfError(error, 'Could not load the maze schedule')
  return (data as MazeSchedule | null) ?? null
}

export async function saveMazeSchedule(
  supabase: SupabaseClient,
  guildId: string,
  values: {
    event_start: string
    event_end: string
    maze_type: '7d' | '3d'
    channel_id: string | null
    ping_enabled_global: boolean
    ping_mention: MazePingMention
    ping_role_id: string | null
  },
): Promise<void> {
  const { error } = await supabase.from('maze_schedules').upsert(
    {
      guild_id: guildId,
      event_start: values.event_start,
      event_end: values.event_end,
      maze_type: values.maze_type,
      channel_id: values.channel_id,
      ping_enabled_global: values.ping_enabled_global,
      ping_mention: values.ping_mention,
      // The role is only meaningful while the mention mode is 'role'; clear it otherwise.
      ping_role_id: values.ping_mention === 'role' ? values.ping_role_id : null,
    },
    { onConflict: 'guild_id' },
  )
  throwIfError(error, 'Could not save the maze schedule')
}

export async function deleteMazeSchedule(
  supabase: SupabaseClient,
  guildId: string,
): Promise<void> {
  const { error } = await supabase.from('maze_schedules').delete().eq('guild_id', guildId)
  throwIfError(error, 'Could not delete the maze schedule')
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
  if (cleanName === oldName) return

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

  const renameEntries = (
    entries: War['missing_list'],
  ): { entries: War['missing_list']; changed: boolean } => {
    if (!entries) return { entries, changed: false }
    let changed = false
    const next = entries.map((entry) => {
      if (entry?.name && entry.name.trim().toLowerCase() === oldName) {
        changed = true
        return { ...entry, name: cleanName }
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

  const { error } = await supabase.from('teams').insert({
    guild_id: guildId,
    name,
    war_channel_id: cleanSnowflake(values.war_channel_id),
    race_channel_id: cleanSnowflake(values.race_channel_id),
    team_role_id: cleanSnowflake(values.team_role_id),
  })
  throwIfError(error, 'Could not create the team')
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
  throwIfError(error, 'Could not save the team')

  if (warChannelId) {
    const { error: warError } = await supabase
      .from('wars')
      .update({ team_role_id: teamRoleId })
      .eq('channel_id', warChannelId)
    if (warError) {
      throw new Error(`Team saved, but the war role could not be synced: ${warError.message}`)
    }
  }
}

export async function deleteTeam(supabase: SupabaseClient, teamId: number): Promise<void> {
  const { error } = await supabase.from('teams').delete().eq('id', teamId)
  throwIfError(error, 'Could not delete the team')
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
  throwIfError(error, 'Could not add the captain')
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
  warLogs: WarLog[]
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
      const windowStart = war?.war_start ?? sevenDaysAgo

      const [warLogs, raceLogs] = await Promise.all([
        warChannel
          ? listWarLogs(supabase, warChannel, war?.war_start ?? null, 50).catch(() => [])
          : Promise.resolve<WarLog[]>([]),
        raceChannel
          ? listRaceLogs(supabase, guildId, raceChannel, windowStart).catch(() => [])
          : Promise.resolve<RaceLog[]>([]),
      ])

      return {
        team,
        war,
        race,
        warLogs,
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

  const [war, race, maze, aliases, warnings] = await Promise.allSettled([
    warPromise,
    racePromise,
    getMazeSchedule(supabase, guildId),
    supabase.from('aliases').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
    supabase.from('warnings').select('id', { count: 'exact', head: true }).eq('guild_id', guildId),
  ])

  return {
    war: war.status === 'fulfilled' ? war.value : null,
    race: race.status === 'fulfilled' ? race.value : null,
    maze: maze.status === 'fulfilled' ? maze.value : null,
    aliasCount: aliases.status === 'fulfilled' ? aliases.value.count ?? 0 : 0,
    warningCount: warnings.status === 'fulfilled' ? warnings.value.count ?? 0 : 0,
  }
}
