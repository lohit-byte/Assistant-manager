export type Currency = 'USD' | 'INR'
export type PlanId = 'monthly' | 'yearly'

export interface PricingPlan {
  id: PlanId
  name: string
  cadence: string
  description: string
  price: Record<Currency, number>
  badge?: string
  highlight?: boolean
}

export const CURRENCY_META: Record<Currency, { symbol: string; label: string; locale: string }> = {
  USD: { symbol: '$', label: 'USD', locale: 'en-US' },
  INR: { symbol: '₹', label: 'INR', locale: 'en-IN' },
}

export const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'monthly',
    name: 'Monthly',
    cadence: 'month',
    description: 'Full access with a simple month-to-month plan.',
    price: { USD: 5, INR: 299 },
  },
  {
    id: 'yearly',
    name: 'Yearly',
    cadence: 'year',
    description: 'The same full access for a full year at the best rate.',
    price: { USD: 49, INR: 2499 },
    badge: 'Best value',
    highlight: true,
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

export function perMonthPrice(plan: PricingPlan, currency: Currency): number {
  const value = plan.id === 'yearly' ? plan.price[currency] / 12 : plan.price[currency]
  return Math.round(value * 100) / 100
}

export function yearlySavings(currency: Currency): number {
  const monthly = PRICING_PLANS.find((plan) => plan.id === 'monthly')
  const yearly = PRICING_PLANS.find((plan) => plan.id === 'yearly')
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
