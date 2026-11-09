import type { Session } from '@supabase/supabase-js'
import { PERMISSION_ADMINISTRATOR, PERMISSION_MANAGE_GUILD } from './constants'
import { isSnowflake } from './format'

export interface DiscordGuild {
  id: string
  name: string
  icon: string | null
  owner?: boolean
  permissions: string
}

export class DiscordApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'DiscordApiError'
    this.status = status
  }
}

export async function fetchDiscordGuilds(providerToken: string): Promise<DiscordGuild[]> {
  const response = await fetch('https://discord.com/api/users/@me/guilds', {
    headers: { Authorization: `Bearer ${providerToken}` },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new DiscordApiError(
      response.status,
      response.status === 401
        ? 'The Discord session has expired. Please sign in again.'
        : `Discord returned ${response.status}.`,
    )
  }

  const data = (await response.json()) as DiscordGuild[]
  return Array.isArray(data) ? data : []
}

export function canManageGuild(guild: DiscordGuild): boolean {
  if (guild.owner) return true
  try {
    const permissions = BigInt(guild.permissions || '0')
    return (
      (permissions & PERMISSION_ADMINISTRATOR) === PERMISSION_ADMINISTRATOR ||
      (permissions & PERMISSION_MANAGE_GUILD) === PERMISSION_MANAGE_GUILD
    )
  } catch {
    return false
  }
}

/**
 * The Discord user id behind the Supabase session. GoTrue exposes it as
 * `user_metadata.provider_id` (and `sub`); older sessions only carry it on the
 * provider identity, so fall back to the Discord identity id.
 */
export function discordIdFromSession(user: Session['user'] | null | undefined): string | null {
  if (!user) return null
  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>
  const identityId = user.identities?.find((identity) => identity.provider === 'discord')?.id
  const candidates: unknown[] = [metadata.provider_id, metadata.sub, identityId, user.identities?.[0]?.id]

  for (const candidate of candidates) {
    const value = typeof candidate === 'number' ? String(candidate) : candidate
    if (typeof value === 'string' && isSnowflake(value)) return value.trim()
  }
  return null
}
