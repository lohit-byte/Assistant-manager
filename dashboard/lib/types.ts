export type Id = string | number

export type PremiumStatus = 'trial' | 'premium' | 'expired'

export interface Guild {
  guild_id: Id
  is_blacklisted: boolean | null
  premium_status: PremiumStatus | string | null
  premium_ends_at: string | null
  last_order_id: string | null
  trial_ends_at: string | null
  required_attacks: number | null
  war_channel_id: Id | null
  race_channel_id: Id | null
  maze_channel_id: Id | null
  absence_channel_id: Id | null
  leader_role_id: Id | null
  colead_role_id: Id | null
  staff_role_id: Id | null
  member_role_id: Id | null
  max_teams: number | null
  created_at: string | null
}

export interface WarSettings {
  guild_id: Id
  attacks_required: number
  exempt_absent: boolean
}

export interface WarEntry {
  name: string
  id?: Id
}

export interface War {
  guild_id: Id
  channel_id: Id
  war_start: string | null
  phase: 'defence' | 'defense' | 'attack' | 'ended' | string | null
  missing_list: WarEntry[] | null
  absent_list: WarEntry[] | null
  attack_counts: Record<string, number> | null
  is_active: boolean | null
  status_message_id: Id | null
}

export interface RaceState {
  guild_id: Id
  channel_id: Id
  target_laps: number | null
  current_lap: number | null
  current_node: number | null
  task_description: string | null
  ofa_holder_id: Id | null
  ofa_target: string | null
  ofa_done: boolean | null
  dyp_progress: number | null
  dyp_target: number | null
  dyp_contributors: string[] | null
  je_progress: string | null
  je_target: string | null
  je_done: boolean | null
  pending_ofa_message_id: Id | null
  pending_ofa_user_id: Id | null
  is_event_active: boolean | null
  active_race_sheet: string | null
}

/** Who the automatic maze discount pings mention (`maze_schedules.ping_mention`). */
export type MazePingMention = 'here' | 'everyone' | 'role' | 'none'

export interface MazeSchedule {
  id: Id
  guild_id: Id
  event_start: string | null
  event_end: string | null
  maze_type: '7d' | '3d' | string | null
  channel_id: Id | null
  ping_enabled_global: boolean | null
  ping_mention: MazePingMention | string | null
  ping_role_id: Id | null
  discount_schedule?: unknown
}

export interface Alias {
  id: number
  guild_id: Id
  discord_id: Id
  alias_name: string
}

export interface Warning {
  id: number
  guild_id: Id
  discord_id: Id
  reason: string | null
  issued_by: Id | null
  created_at: string | null
}
