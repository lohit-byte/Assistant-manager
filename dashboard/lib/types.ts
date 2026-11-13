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
  maze_channel_id: Id | null
  absence_channel_id: Id | null
  leader_role_id: Id | null
  colead_role_id: Id | null
  staff_role_id: Id | null
  member_role_id: Id | null
  max_teams: number | null
  plan: string | null
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
  team_role_id: Id | null
}

/** Who the automatic maze discount pings mention (`maze_schedules.ping_mention`). */
export type MazePingMention = 'here' | 'everyone' | 'role' | 'none'

/**
 * One real maze event, shared by every server: the in-game calendar predicts it
 * (`scheduled`) and the first staff member who sees the in-game countdown confirms
 * or corrects it (`confirmed`). Discount times are offsets from `event_start`.
 */
export interface MazeEvent {
  id: Id
  event_start: string
  event_end: string
  maze_type: string
  status: 'scheduled' | 'confirmed' | 'cancelled' | string
  source: 'calendar' | 'report' | string
  confirmed_by_guild: Id | null
  confirmed_by_user: Id | null
  note: string | null
  created_at: string | null
  updated_at: string | null
}

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

/**
 * A team is one war channel and owns its captains. The channel may be null (a team
 * created before its channel is known).
 */
export interface Team {
  id: number
  guild_id: Id
  name: string
  war_channel_id: Id | null
  team_role_id: Id | null
  created_at: string | null
}

/** A captain is staff for their team only (assigned by Discord user id). */
export interface TeamCaptain {
  team_id: number
  discord_id: Id
  created_at: string | null
}

/** One row per attack report: button = +1, text = delta, staff undo = negative. */
export interface WarLog {
  id: number
  guild_id: Id
  channel_id: Id
  war_start: string | null
  discord_id: Id | null
  player_name: string | null
  attacks: number
  source: string
  created_at: string | null
}
