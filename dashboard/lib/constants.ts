export const BOT_CLIENT_ID = '1567228271915962499'

export const BOT_INVITE_URL =
  `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}` +
  '&permissions=257088&integration_type=0&scope=bot'

export const SUPPORT_EMAIL = 'warbot.support@gmail.com'

export const DEFAULT_ATTACKS_REQUIRED = 6
export const MAX_ATTACKS_REQUIRED = 10
export const NODES_PER_LAP = 5

export const PERMISSION_ADMINISTRATOR = BigInt(0x8)
export const PERMISSION_MANAGE_GUILD = BigInt(0x20)

export interface MazeDiscount {
  hours: number
  minutes: number
  percent: string
}

export const MAZE_SCHEDULES: Record<'7d' | '3d', MazeDiscount[]> = {
  '7d': [
    { hours: 6 * 24 + 22, minutes: 0, percent: '20%' },
    { hours: 5 * 24 + 19, minutes: 0, percent: '10%' },
    { hours: 5 * 24 + 0, minutes: 0, percent: '30%' },
    { hours: 4 * 24 + 17, minutes: 0, percent: '10%' },
    { hours: 4 * 24 + 1, minutes: 0, percent: '10%' },
    { hours: 3 * 24 + 6, minutes: 0, percent: '10%' },
    { hours: 1 * 24 + 9, minutes: 0, percent: '10%' },
    { hours: 0 * 24 + 1, minutes: 0, percent: '20%' },
  ],
  '3d': [
    { hours: 2 * 24 + 23, minutes: 0, percent: '30%' },
    { hours: 1 * 24 + 23, minutes: 0, percent: '20%' },
    { hours: 1 * 24 + 11, minutes: 0, percent: '10%' },
    { hours: 0 * 24 + 11, minutes: 0, percent: '10%' },
  ],
}

export const MAZE_TYPE_META: Record<'7d' | '3d', { label: string; days: number }> = {
  '7d': { label: '7-day maze', days: 7 },
  '3d': { label: '3-day maze', days: 3 },
}

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
