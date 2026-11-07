import type { SupabaseClient } from '@supabase/supabase-js'
import { DEFAULT_ATTACKS_REQUIRED } from './constants'
import type {
  Alias,
  Guild,
  MazeSchedule,
  RaceState,
  War,
  WarSettings,
  Warning,
} from './types'

function throwIfError(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`)
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
