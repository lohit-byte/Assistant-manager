export type Currency = 'USD' | 'INR'
export type PlanId = 'starter_monthly' | 'pro_monthly' | 'elite_yearly'

/** Elite is sold as unlimited teams; the numeric sentinel keeps capacity checks simple. */
export const UNLIMITED_TEAMS = 1_000_000

export interface PricingPlan {
  id: PlanId
  name: string
  cadence: string
  description: string
  price: Record<Currency, number>
  max_teams: number
  paddlePriceId: string
  badge?: string
  highlight?: boolean
}

export const CURRENCY_META: Record<Currency, { symbol: string; label: string; locale: string }> = {
  USD: { symbol: '$', label: 'USD', locale: 'en-US' },
  INR: { symbol: '₹', label: 'INR', locale: 'en-IN' },
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'starter_monthly',
    name: 'Starter Monthly',
    cadence: 'month',
    description: 'Full access with a simple month-to-month plan. Perfect for single-team alliances.',
    price: { USD: 10, INR: 999 },
    max_teams: 1,
    paddlePriceId: 'pri_01m6wykr8dysxvzrzpnmjm9p58',
  },
  {
    id: 'pro_monthly',
    name: 'Pro Monthly',
    cadence: 'month',
    description: 'Track up to 3 teams individually.',
    price: { USD: 12, INR: 1299 },
    max_teams: 3,
    badge: 'Best Value',
    highlight: true,
    paddlePriceId: 'pri_01m6wyj4hnawz0ty059h9dx6y8',
  },
  {
    id: 'elite_yearly',
    name: 'Elite Yearly',
    cadence: 'year',
    description: 'Full access for a full year at the best rate, with Unlimited teams and Priority support.',
    price: { USD: 84, INR: 7999 },
    max_teams: UNLIMITED_TEAMS,
    badge: 'Save 30%',
    paddlePriceId: 'pri_01m6wyn8zyn445fawgtzttagxe',
  },
]

export const PLAN_FEATURES = [
  'War tracking with defence and attack timers',
  'Missing, excused and attack-count lists',
  '7-day and 3-day maze schedules with discounts',
  'Aliases and warnings shared with the bot',
  'Full dashboard access for this server',
]

export function formatPrice(amount: number, currency: Currency): string {
  const meta = CURRENCY_META[currency]
  return `${meta.symbol}${amount.toLocaleString(meta.locale, {
    maximumFractionDigits: 2,
  })}`
}

export function perMonthPrice(plan: PricingPlan, currency: Currency): number {
  const value = plan.cadence === 'year' ? plan.price[currency] / 12 : plan.price[currency]
  return Math.round(value * 100) / 100
}

export function yearlySavings(currency: Currency): number {
  const monthly = PRICING_PLANS.find((plan) => plan.id === 'pro_monthly')
  const yearly = PRICING_PLANS.find((plan) => plan.id === 'elite_yearly')
  if (!monthly || !yearly) return 0
  const fullPrice = monthly.price[currency] * 12
  if (!fullPrice) return 0
  return Math.round((1 - yearly.price[currency] / fullPrice) * 100)
}

export function detectCurrency(): Currency {
  if (typeof navigator === 'undefined') return 'USD'

  const languages = [navigator.language, ...(navigator.languages ?? [])]
    .filter(Boolean)
    .map((language) => language.toLowerCase())

  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

  if (
    languages.some(
      (language) =>
        language === 'in' ||
        language === 'hi' ||
        language.endsWith('-in') ||
        language.startsWith('hi-'),
    ) ||
    timeZone === 'Asia/Kolkata' ||
    timeZone === 'Asia/Calcutta'
  ) {
    return 'INR'
  }

  return 'USD'
}
