export type Currency = 'USD' | 'INR'
export type PlanId = 'starter_monthly' | 'pro_monthly' | 'elite_yearly'

export interface PricingPlan {
  id: PlanId
  name: string
  cadence: string
  description: string
  price: Record<Currency, number>
  max_teams: number
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
  },
  {
    id: 'elite_yearly',
    name: 'Elite Yearly',
    cadence: 'year',
    description: 'Full access for a full year at the best rate, with Unlimited teams and Priority support.',
    price: { USD: 84, INR: 7999 },
    max_teams: 99, // <--- FIXED COMMA
    badge: 'Save 30%',
  },
  {
    id: 'dev_test',
    name: 'Developer Test (₹1)',
    cadence: 'month',
    description: 'Do not buy. Internal testing only.',
    price: { USD: 1, INR: 1 },
    max_teams: 1,
  },
]

export const PLAN_FEATURES = [
  'War tracking with defence and attack timers',
  'Missing, excused and attack-count lists',
  'Race node, OFA, DYP and JE progress',
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

// FIXED: Now properly checks for the yearly plan
export function perMonthPrice(plan: PricingPlan, currency: Currency): number {
  const value = plan.cadence === 'year' ? plan.price[currency] / 12 : plan.price[currency]
  return Math.round(value * 100) / 100
}

// FIXED: Now compares your yearly plan against the Pro Monthly plan
export function yearlySavings(currency: Currency): number {
  const monthly = PRICING_PLANS.find((plan) => plan.id === 'pro_monthly') // Comparing against Pro
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
