export const BOT_CLIENT_ID = '1567228271915962499'

export const BOT_INVITE_URL =
  `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}` +
  '&permissions=257088&integration_type=0&scope=bot'

export const SUPPORT_EMAIL = 'warbot.support@gmail.com'

export const TRIAL_DAYS = 7
export const DEFAULT_ATTACKS_REQUIRED = 6
export const MAX_ATTACKS_REQUIRED = 6
export const NODES_PER_LAP = 5

/**
 * Activity rating (war attendance 60 %, race contributions 40 %). Tunable from one place:
 * `RACE_ACTIVITY_TARGET` is the number of distinct race tasks that make a full race half.
 * If a team only has a war or only a race channel, the two weights are renormalized.
 */
export const WAR_RATING_WEIGHT = 0.6
export const RACE_RATING_WEIGHT = 0.4
export const RACE_ACTIVITY_TARGET = 10

export const PERMISSION_ADMINISTRATOR = BigInt(0x8)
export const PERMISSION_MANAGE_GUILD = BigInt(0x20)

/**
 * Maze Island discount windows. Each entry is (start, end, percent) in hours after the maze
 * start, so the times move with the maze instead of being fixed clock times.
 *
 * Derived from the 5-12 Nov 2026 maze (every in-game banner countdown agrees to ~30 s):
 * 50 % for 5 h, 20 % for 8 h, then 10 % for the first 12 h of each of the three limited-time
 * paths (+24 h, +72 h, +120 h), then 20 % again for the last 4 h. There is no discount at all
 * in between, and 30 % never appears. Mirrors bot/maze_timing.py - change both together.
 */
export interface MazeWindow {
  start: number
  end: number
  percent: string
}

export const MAZE_DURATION_DAYS = 7

export const MAZE_WINDOWS: MazeWindow[] = [
  { start: 0, end: 5, percent: '50%' },
  { start: 5, end: 13, percent: '20%' },
  { start: 24, end: 36, percent: '10%' },
  { start: 72, end: 84, percent: '10%' },
  { start: 120, end: 132, percent: '10%' },
  { start: 164, end: 168, percent: '20%' },
]

/** Percentages offered by the manual ping and the schedule editor. */
export const MAZE_WINDOW_PERCENTS = ['10%', '20%', '30%', '40%', '50%']

export const MAZE_DURATION_HOURS = MAZE_DURATION_DAYS * 24

/** Discord ids of the platform owner: only they may edit the shared maze calendar. */
export const PLATFORM_ADMIN_IDS = ['704623764008075284']

export const PLAN_META: Record<
  string,
  { label: string; tone: 'green' | 'purple' | 'red' | 'slate'; description: string }
> = {
  trial: {
    label: 'Free trial',
    tone: 'green',
    description: 'All premium features are unlocked during your trial.',
  },
  premium: {
    label: 'Premium',
    tone: 'purple',
    description: 'Thank you for supporting the bot. All features are unlocked.',
  },
  expired: {
    label: 'Expired',
    tone: 'red',
    description: 'The trial has ended and the bot is paused for this server.',
  },
}

export const DISCORD_GUILD_ICON = (guildId: string, icon: string, size = 128) =>
  `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=${size}`

export const NAV_ITEMS = [
  { name: 'Overview', href: '', icon: 'overview' as const },
  { name: 'War', href: '/war', icon: 'war' as const },
  { name: 'Race', href: '/race', icon: 'race' as const },
  { name: 'Maze', href: '/maze', icon: 'maze' as const },
  { name: 'Aliases', href: '/aliases', icon: 'aliases' as const },
  { name: 'Billing', href: '/billing', icon: 'billing' as const },
]
