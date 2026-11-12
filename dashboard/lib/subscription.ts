import type { SupabaseClient } from '@supabase/supabase-js'
import type { SubscriptionUpdate } from './plans'

function isMissingPlanColumn(error: { code?: string; message?: string }): boolean {
  const message = error.message ?? ''
  return /plan/i.test(message) && (error.code === 'PGRST204' || /column/i.test(message))
}

/**
 * Service-role write of the subscription columns. If the dashboard is deployed before the
 * 2026-12 migration runs, the `plan` column is missing: retry once without it so a paying
 * customer is still upgraded instead of losing their payment.
 */
export async function upsertGuildSubscription(
  client: SupabaseClient,
  guildId: string,
  update: SubscriptionUpdate,
): Promise<void> {
  const first = await client
    .from('guilds')
    .upsert({ guild_id: guildId, ...update }, { onConflict: 'guild_id' })

  if (!first.error) return

  if (!isMissingPlanColumn(first.error)) throw first.error

  console.warn('guilds.plan column is missing; run the 2026-12 migration. Upgrading without it.')
  const { plan: _plan, ...legacyUpdate } = update
  const retry = await client
    .from('guilds')
    .upsert({ guild_id: guildId, ...legacyUpdate }, { onConflict: 'guild_id' })

  if (retry.error) throw retry.error
}
