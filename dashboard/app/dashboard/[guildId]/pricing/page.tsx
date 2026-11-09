'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  CreditCard,
  Globe,
  Mail,
  ShieldAlert,
  Sparkles,
  Tag,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import {
  Alert,
  Badge,
  Card,
  CardBody,
  CardHeader,
  Divider,
  PageHeader,
  buttonClass,
} from '@/components/ui'
import { SUPPORT_EMAIL, TRIAL_DAYS } from '@/lib/constants'
import { getUser } from '@/lib/data'
import { getDiscordUserId } from '@/lib/discord'
import { createClient } from '@/lib/supabase/client'
import {
  CURRENCY_META,
  PLAN_FEATURES,
  PRICING_PLANS,
  detectCurrency,
  formatPrice,
  perMonthPrice,
  yearlySavings,
  type Currency,
  type PricingPlan,
} from '@/lib/pricing'
import { cn, formatDate, toDate } from '@/lib/format'
import { useNow } from '@/lib/hooks'

function upgradeHref(
  guildId: string,
  discordUserId: string | null,
  plan: PricingPlan,
  currency: Currency,
): string {
  const price = formatPrice(plan.price[currency], currency)
  const subject = `Upgrade to ${plan.name} (${price})`
  const body = [
    `Server ID: ${guildId}`,
    `Discord user ID: ${discordUserId ?? 'unknown'}`,
    `Plan: ${plan.name}`,
    `Currency: ${CURRENCY_META[currency].label}`,
    `Price: ${price} per ${plan.cadence}`,
    '',
    'Please send payment instructions and activate premium for this server.',
  ].join('\n')

  return `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export default function PricingPage() {
  const { guild, guildId } = useGuild()
  const now = useNow(60_000)
  const [currency, setCurrency] = useState<Currency>(() => detectCurrency())
  const [discordUserId, setDiscordUserId] = useState<string | null>(null)
  const [playerBlacklisted, setPlayerBlacklisted] = useState<boolean | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const supabase = createClient()
        const {
          data: { session },
        } = await supabase.auth.getSession()
        const id = getDiscordUserId(session?.user)
        if (cancelled) return
        setDiscordUserId(id)
        if (!id) return

        const row = await getUser(supabase, id)
        if (!cancelled) setPlayerBlacklisted(Boolean(row?.is_blacklisted))
      } catch {
        if (!cancelled) setPlayerBlacklisted(null)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  const status = guild.premium_status ?? 'expired'
  const isPremium = status === 'premium'
  const trialEnd = toDate(guild.trial_ends_at)
  const trialDays = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000))
    : 0
  const trialActive = status === 'trial' && trialEnd !== null && trialEnd.getTime() > now.getTime()
  const trialExpired = status === 'trial' && !trialActive
  const blocked = Boolean(guild.is_blacklisted) || playerBlacklisted === true
  const savings = useMemo(() => yearlySavings(currency), [currency])
  const monthly = PRICING_PLANS.find((plan) => plan.id === 'monthly')
  const yearly = PRICING_PLANS.find((plan) => plan.id === 'yearly')

  return (
    <div>
      <PageHeader
        eyebrow="Pricing"
        title="Plans & pricing"
        description={`Full access for this server. Prices are shown in ${CURRENCY_META[currency].label} and can be switched at any time.`}
        actions={
          <div className="inline-flex rounded-xl border border-white/[0.08] bg-white/[0.03] p-1">
            {(['INR', 'USD'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setCurrency(option)}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors',
                  currency === option
                    ? 'bg-indigo-500 text-white shadow-[0_6px_18px_-8px_rgba(99,102,241,0.9)]'
                    : 'text-slate-400 hover:text-white',
                )}
                aria-pressed={currency === option}
              >
                {CURRENCY_META[option].symbol} {CURRENCY_META[option].label}
              </button>
            ))}
          </div>
        }
      />

      {blocked ? (
        <Alert tone="red" className="mb-6" title="Trials and upgrades are unavailable">
          {guild.is_blacklisted
            ? 'This server is on the blacklist.'
            : 'Your Discord account is on the blacklist.'}{' '}
          Contact support if you believe this is a mistake.
        </Alert>
      ) : isPremium ? (
        <Alert tone="green" className="mb-6" title="Premium is active">
          This server already has full access. Contact support if you need to change or renew the
          plan.
        </Alert>
      ) : trialActive ? (
        <Alert tone="blue" className="mb-6" title={`Trial active — ${trialDays} days left`}>
          You can upgrade at any time during the trial. When the trial ends, premium stops until a
          paid plan is active. The {TRIAL_DAYS}-day trial is one-time and does not restart.
        </Alert>
      ) : trialExpired ? (
        <Alert tone="amber" className="mb-6" title="Your trial has ended">
          The {TRIAL_DAYS}-day trial is over for this server and cannot be restarted. Choose a plan
          below to restore premium access.
        </Alert>
      ) : (
        <Alert tone="amber" className="mb-6" title="No active plan">
          Choose a plan below to enable premium commands for this server.
        </Alert>
      )}

      <div className="mb-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <Globe className="h-3.5 w-3.5" />
          Region detected: {currency === 'INR' ? 'India (INR)' : 'International (USD)'}
        </span>
        {trialEnd ? (
          <>
            <span className="h-1 w-1 rounded-full bg-slate-700" />
            <span>Trial ends {formatDate(trialEnd)}</span>
          </>
        ) : null}
      </div>

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          {
            label: 'Server blacklist',
            tone: guild.is_blacklisted ? 'red' : 'green',
            text: guild.is_blacklisted ? 'Blacklisted' : 'Clear',
          },
          {
            label: 'Player blacklist',
            tone:
              playerBlacklisted === true ? 'red' : playerBlacklisted === false ? 'green' : 'slate',
            text:
              playerBlacklisted === true
                ? 'Blacklisted'
                : playerBlacklisted === false
                  ? 'Clear'
                  : 'Not checked',
          },
          {
            label: 'Trial',
            tone: isPremium ? 'purple' : trialActive ? 'blue' : 'amber',
            text: isPremium
              ? 'Premium active'
              : trialActive
                ? `${trialDays} ${trialDays === 1 ? 'day' : 'days'} left`
                : 'Ended',
          },
        ].map((item) => (
          <div
            key={item.label}
            className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              {item.label}
            </p>
            <Badge tone={item.tone as 'red' | 'green' | 'blue' | 'purple' | 'amber' | 'slate'} dot>
              {item.text}
            </Badge>
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        {PRICING_PLANS.map((plan) => {
          const price = plan.price[currency]
          const perMonth = perMonthPrice(plan, currency)
          const href = upgradeHref(guildId, discordUserId, plan, currency)
          const anchor = monthly ? monthly.price[currency] * 12 : 0
          const highlighted = Boolean(plan.highlight)

          return (
            <Card
              key={plan.id}
              className={cn(
                'relative overflow-hidden',
                highlighted && 'border-indigo-400/30 shadow-glow',
              )}
            >
              {highlighted ? (
                <div
                  className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-indigo-300/60 to-transparent"
                  aria-hidden
                />
              ) : null}
              <CardBody className="space-y-6">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-bold tracking-tight text-white">{plan.name}</h2>
                      {plan.badge ? (
                        <Badge tone="purple">
                          <Sparkles className="h-3 w-3" />
                          {plan.badge}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-2 max-w-xs text-sm leading-relaxed text-slate-400">
                      {plan.description}
                    </p>
                  </div>
                  <div className="rounded-xl border border-white/[0.08] bg-white/[0.04] p-2 text-indigo-300">
                    {plan.id === 'yearly' ? (
                      <Sparkles className="h-4 w-4" />
                    ) : (
                      <CreditCard className="h-4 w-4" />
                    )}
                  </div>
                </div>

                <div>
                  <p className="flex flex-wrap items-baseline gap-1.5">
                    <span className="text-4xl font-bold tracking-tight text-white">
                      {formatPrice(price, currency)}
                    </span>
                    <span className="text-sm text-slate-400">/ {plan.cadence}</span>
                    {highlighted && anchor > price ? (
                      <span className="ml-1 text-sm font-medium text-slate-600 line-through">
                        {formatPrice(anchor, currency)}
                      </span>
                    ) : null}
                  </p>
                  {plan.id === 'yearly' ? (
                    <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                        <Tag className="h-3.5 w-3.5" />
                        Save {savings}%
                      </span>
                      <span>
                        About {formatPrice(perMonth, currency)} per month · billed yearly
                      </span>
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      Billed monthly · switch or renew through support
                    </p>
                  )}
                </div>

                <Divider />

                <ul className="space-y-2.5">
                  {PLAN_FEATURES.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-300">
                      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                        <Check className="h-3 w-3" />
                      </span>
                      {feature}
                    </li>
                  ))}
                </ul>

                {blocked ? (
                  <span
                    className={buttonClass('secondary', 'md', 'w-full cursor-not-allowed opacity-50')}
                    aria-disabled="true"
                  >
                    <ShieldAlert className="h-4 w-4" />
                    Upgrade unavailable
                  </span>
                ) : (
                  <a
                    href={href}
                    className={buttonClass(highlighted ? 'primary' : 'secondary', 'md', 'w-full')}
                  >
                    <Mail className="h-4 w-4" />
                    {isPremium ? `Switch to ${plan.name}` : `Upgrade to ${plan.name}`}
                  </a>
                )}

                {plan.id === 'yearly' ? (
                  <p className="text-center text-xs text-slate-500">
                    Best rate for a full year of access.
                  </p>
                ) : null}
              </CardBody>
            </Card>
          )
        })}
      </div>

      <Card className="mt-5">
        <CardHeader
          title="Compare plans"
          description="Both plans unlock the same features — only the billing cadence changes"
          icon={<CreditCard className="h-4 w-4" />}
        />
        <CardBody className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/[0.06] text-[11px] uppercase tracking-wider text-slate-500">
                  <th className="px-5 py-3 font-semibold sm:px-6">Feature</th>
                  <th className="px-5 py-3 font-semibold sm:px-6">Monthly</th>
                  <th className="px-5 py-3 font-semibold sm:px-6">Yearly</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.04]">
                <tr>
                  <td className="px-5 py-3 text-slate-300 sm:px-6">Effective price per month</td>
                  <td className="px-5 py-3 font-semibold text-white sm:px-6">
                    {monthly ? formatPrice(perMonthPrice(monthly, currency), currency) : '—'}
                  </td>
                  <td className="px-5 py-3 font-semibold text-emerald-300 sm:px-6">
                    {yearly ? formatPrice(perMonthPrice(yearly, currency), currency) : '—'}
                  </td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-300 sm:px-6">Billing cadence</td>
                  <td className="px-5 py-3 text-slate-400 sm:px-6">Every month</td>
                  <td className="px-5 py-3 text-slate-400 sm:px-6">Once a year</td>
                </tr>
                <tr>
                  <td className="px-5 py-3 text-slate-300 sm:px-6">Yearly saving</td>
                  <td className="px-5 py-3 text-slate-600 sm:px-6">—</td>
                  <td className="px-5 py-3 font-semibold text-emerald-300 sm:px-6">Save {savings}%</td>
                </tr>
                {PLAN_FEATURES.map((feature) => (
                  <tr key={feature}>
                    <td className="px-5 py-3 text-slate-300 sm:px-6">{feature}</td>
                    <td className="px-5 py-3 sm:px-6">
                      <Check className="h-4 w-4 text-emerald-400" aria-label="Included" />
                    </td>
                    <td className="px-5 py-3 sm:px-6">
                      <Check className="h-4 w-4 text-emerald-400" aria-label="Included" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardBody>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader
            title="How activation works"
            description="Billing is handled manually by support"
            icon={<Mail className="h-4 w-4" />}
          />
          <CardBody className="space-y-4 text-sm text-slate-400">
            <p>
              Choose a plan and email us from the address you use for the server. Include the server
              ID shown below so we can match the request.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Support email</p>
                <p className="mt-1 break-all font-mono text-sm text-indigo-300">{SUPPORT_EMAIL}</p>
              </div>
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <p className="text-[11px] uppercase tracking-wider text-slate-500">Server ID</p>
                <p className="mt-1 break-all font-mono text-sm text-slate-300">{guildId}</p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              This page never asks for card details and cannot charge you. Support confirms the final
              amount and activates premium on the server record.
            </p>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Pricing questions"
            description="Trials, currencies and eligibility"
            icon={<AlertTriangle className="h-4 w-4" />}
          />
          <CardBody className="space-y-4 text-sm text-slate-400">
            <div>
              <p className="font-semibold text-slate-200">Can I upgrade during the trial?</p>
              <p className="mt-1">
                Yes. Upgrade at any time and the paid plan replaces the remaining trial.
              </p>
            </div>
            <Divider />
            <div>
              <p className="font-semibold text-slate-200">What happens when the trial ends?</p>
              <p className="mt-1">
                Premium commands stop until a plan is active. The {TRIAL_DAYS}-day trial is one-time
                and cannot be restarted on the same server or account.
              </p>
            </div>
            <Divider />
            <div>
              <p className="font-semibold text-slate-200">Which currency will I pay?</p>
              <p className="mt-1">
                Indian accounts see ₹ prices and everyone else sees $. You can switch the display,
                and support confirms the final amount before activation.
              </p>
            </div>
            <Divider />
            <div>
              <p className="font-semibold text-slate-200">Why can&apos;t I upgrade?</p>
              <p className="mt-1">
                Blacklisted servers and player accounts cannot start trials or upgrades. Contact
                support if you believe this is a mistake.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
