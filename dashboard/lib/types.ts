// Inside your Guild interface:
export interface Guild {
  guild_id: Id
  is_blacklisted: boolean | null
  premium_status: PremiumStatus | string | null
  premium_ends_at: string | null // <--- NEW
  last_order_id: string | null   // <--- NEW
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
