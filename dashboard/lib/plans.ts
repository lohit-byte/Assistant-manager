import { PRICING_PLANS, UNLIMITED_TEAMS, type PlanId, type PricingPlan } from './pricing'

export { UNLIMITED_TEAMS }

export const PLAN_TEAMS: Record<PlanId, number> = {
  starter_monthly: 1,
  pro_monthly: 3,
  elite_yearly: UNLIMITED_TEAMS,
}

export interface GuildPlanFields {
  plan?: string | null
  max_teams?: number | null
}

export interface GuildAccessFields extends GuildPlanFields {
  premium_status?: string | null
  premium_ends_at?: string | null
  trial_ends_at?: string | null
}

export interface SubscriptionState {
  premium_ends_at?: string | null
  last_order_id?: string | null
}

export interface SubscriptionUpdate {
  plan: PlanId
  max_teams: number
  premium_status: 'premium'
  premium_ends_at: string
  last_order_id: string
  last_renewal_ping: 0
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** A stored plan id, or null when the value is missing/unknown. */
export function planById(id: string | null | undefined): PlanId | null {
  if (!id) return null
  const plan = PRICING_PLANS.find((item) => item.id === id)
  return plan ? plan.id : null
}

/**
 * The plan a guild paid for. Legacy rows (no stored plan) are inferred from the old
 * 1/3/99 team caps; anything else stays unknown instead of guessing a capacity.
 */
export function planForGuild(guild: GuildPlanFields): PlanId | null {
  const stored = planById(guild.plan)
  if (stored) return stored

  const cap = guild.max_teams
  if (cap === null || cap === undefined) return null
  if (cap <= 1) return 'starter_monthly'
  if (cap <= 3) return 'pro_monthly'
  if (cap >= 99) return 'elite_yearly'
  return null
}

/** `premium` with no end date is a manual lifetime grant; it never expires. */
export function isPremiumActive(
  guild: { premium_status?: string | null; premium_ends_at?: string | null },
  now: Date = new Date(),
): boolean {
  if (guild.premium_status !== 'premium') return false
  if (!guild.premium_ends_at) return true
  const end = parseDate(guild.premium_ends_at)
  return end !== null && end.getTime() > now.getTime()
}

export function hasActiveAccess(guild: GuildAccessFields, now: Date = new Date()): boolean {
  if (isPremiumActive(guild, now)) return true
  if (guild.premium_status !== 'trial') return false
  const end = parseDate(guild.trial_ends_at)
  return end !== null && end.getTime() > now.getTime()
}

/** Plan capacity while access is active; an expired term falls back to the 1-team cap. */
export function effectiveTeamLimit(guild: GuildAccessFields, now: Date = new Date()): number {
  if (!hasActiveAccess(guild, now)) return 1
  const plan = planForGuild(guild)
  if (plan) return PLAN_TEAMS[plan]
  const cap = guild.max_teams
  return cap !== null && cap !== undefined && cap > 0 ? cap : 1
}

/** Cashfree order ids carry a short plan code (s/p/e); keep the map in one place. */
export const CASHFREE_PLAN_CODE: Record<PlanId, string> = {
  starter_monthly: 's',
  pro_monthly: 'p',
  elite_yearly: 'e',
}

export function planFromCashfreeCode(code: string | null | undefined): PlanId | null {
  const match = Object.entries(CASHFREE_PLAN_CODE).find(([, short]) => short === code)
  return match ? (match[0] as PlanId) : null
}

export function planLabel(guild: GuildPlanFields): string {
  const plan = planForGuild(guild)
  if (!plan) return 'Premium'
  return PRICING_PLANS.find((item) => item.id === plan)?.name ?? 'Premium'
}

export function teamLimitLabel(limit: number): string {
  return limit >= UNLIMITED_TEAMS ? 'Unlimited' : String(limit)
}

/**
 * Paddle puts the price on the transaction. Mapping that id is the only way to know what
 * the customer actually paid for; customData is client-supplied and only a fallback.
 */
export function planFromPaddleItems(
  items: Array<{ price?: { id?: string } | null }>,
  customDataPlanId?: string | null,
): PlanId | null {
  for (const item of items ?? []) {
    const priceId = item?.price?.id
    if (!priceId) continue
    const paid = PRICING_PLANS.find((plan) => plan.paddlePriceId === priceId)
    if (paid) return paid.id
  }
  return planById(customDataPlanId)
}

/** Paid terms stack from the later of "now" and an active end date. */
export function buildSubscriptionUpsert(
  existing: SubscriptionState | null,
  planId: PlanId,
  orderId: string,
  now: Date = new Date(),
): SubscriptionUpdate {
  const plan = PRICING_PLANS.find((item) => item.id === planId) as PricingPlan
  const days = plan.cadence === 'year' ? 365 : 30
  const currentEnd = parseDate(existing?.premium_ends_at)
  const base = currentEnd && currentEnd.getTime() > now.getTime() ? currentEnd : now
  const end = new Date(base.getTime() + days * 24 * 60 * 60 * 1000)

  return {
    plan: plan.id,
    max_teams: PLAN_TEAMS[plan.id],
    premium_status: 'premium',
    premium_ends_at: end.toISOString(),
    last_order_id: orderId,
    last_renewal_ping: 0,
  }
}
