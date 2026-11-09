'use client'

import Link from 'next/link'
import {
  AlertTriangle,
  Check,
  CreditCard,
  HelpCircle,
  Mail,
  ShieldAlert,
  Sparkles,
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
  ProgressBar,
  Ring,
  buttonClass,
} from '@/components/ui'
import { BOT_INVITE_URL, PLAN_META, SUPPORT_EMAIL, TRIAL_DAYS } from '@/lib/constants'
import { formatDate, toDate } from '@/lib/format'
import { useNow } from '@/lib/hooks'

const FEATURES = [
  'War tracking with defence and attack timers',
  'Missing, excused and attack-count lists',
  'Race node, OFA, DYP and JE progress',
  '7-day and 3-day maze schedules with discounts',
  'Aliases and warnings shared with the bot',
  'This dashboard, live against the bot database',
]

export default function BillingPage() {
  const { guild, guildId } = useGuild()
  const now = useNow(60_000)

  const status = guild.premium_status ?? 'expired'
  const meta = PLAN_META[status] ?? PLAN_META.expired
  const trialEnd = toDate(guild.trial_ends_at)
  const trialDays = trialEnd
    ? Math.max(0, Math.ceil((trialEnd.getTime() - now.getTime()) / 86_400_000))
    : 0
  const trialExpired = status === 'trial' && trialEnd !== null && trialEnd.getTime() <= now.getTime()

  const supportHref = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(
    `Billing enquiry for server ${guildId}`,
  )}`

  return (
    <div>
      <PageHeader
        eyebrow="Plan"
        title="Billing"
        description="Your server's plan and trial status. Billing is handled manually by the team, so this page is read-only."
        actions={
          <>
            <Link href={`/dashboard/${guildId}/pricing`} className={buttonClass('secondary')}>
              <CreditCard className="h-4 w-4" />
              View plans
            </Link>
            <a href={supportHref} className={buttonClass('primary')}>
              <Mail className="h-4 w-4" />
              Contact support
            </a>
          </>
        }
      />

      {guild.is_blacklisted ? (
        <Alert tone="red" className="mb-6" title="This server is blacklisted">
          The bot will not respond in this server while the blacklist is active. Contact support if
          you believe this is a mistake.
        </Alert>
      ) : null}

      {trialExpired ? (
        <Alert tone="amber" className="mb-6" title="Your trial has ended">
          Premium features are paused for this server. Contact support to upgrade and re-enable the
          bot.
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[1.05fr_0.95fr]">
        <Card>
          <CardHeader
            title="Current plan"
            description="Status is read from the bot's guild record"
            icon={<CreditCard className="h-4 w-4" />}
            action={<Badge tone={meta.tone}>{meta.label}</Badge>}
          />
          <CardBody className="space-y-6">
            <div className="flex items-center gap-5">
              <Ring
                value={status === 'trial' ? trialDays : status === 'premium' ? 1 : 0}
                max={status === 'trial' ? TRIAL_DAYS : 1}
                tone={status === 'trial' ? (trialDays <= 2 ? 'red' : trialDays <= 4 ? 'amber' : 'green') : meta.tone}
                size={96}
                stroke={8}
              >
                <span className="text-xl font-bold tracking-tight text-white">
                  {status === 'trial' ? trialDays : status === 'premium' ? '✓' : '—'}
                </span>
                <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                  {status === 'trial' ? 'days left' : status === 'premium' ? 'active' : 'paused'}
                </span>
              </Ring>
              <div className="min-w-0">
                <p className="text-sm leading-relaxed text-slate-400">{meta.description}</p>
                <p className="mt-2 text-xs text-slate-500">
                  {status === 'trial' ? 'Trial ends' : 'Trial end'}{' '}
                  <span className="font-medium text-slate-300">{formatDate(trialEnd)}</span>
                </p>
              </div>
            </div>

            {status === 'trial' ? (
              <div>
                <ProgressBar
                  value={trialDays}
                  max={TRIAL_DAYS}
                  tone={trialDays <= 2 ? 'red' : trialDays <= 4 ? 'amber' : 'green'}
                />
                <p className="mt-2 text-xs text-slate-500">
                  The trial lasts {TRIAL_DAYS} days from the moment the bot joins. Days are rounded
                  up. It is one-time and does not restart after it ends.
                </p>
              </div>
            ) : null}

            <Divider />

            <div>
              <p className="mb-3 text-sm font-semibold text-white">Included with your plan</p>
              <ul className="space-y-2.5">
                {FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2.5 text-sm text-slate-300">
                    <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300">
                      <Check className="h-3 w-3" />
                    </span>
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {meta.tone === 'red' ? (
              <div className="rounded-xl border border-rose-400/25 bg-rose-500/10 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-rose-200">
                  <ShieldAlert className="h-4 w-4" />
                  Premium is paused
                </p>
                <p className="mt-1 text-sm text-rose-200/80">
                  Commands that require premium will not run until the plan is renewed.
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader
              title="Upgrade"
              description="Premium is activated manually"
              icon={<Sparkles className="h-4 w-4" />}
            />
            <CardBody className="space-y-4">
              <p className="text-sm leading-relaxed text-slate-400">
                Email us from the address you use for the server and include the server name and ID.
                We will confirm pricing and activate premium.
              </p>

              <div className="grid grid-cols-2 gap-2.5">
                <div className="rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">Monthly</p>
                  <p className="mt-1 text-lg font-bold tracking-tight text-white">$5</p>
                  <p className="text-[11px] text-slate-500">or ₹299 per month</p>
                </div>
                <div className="rounded-xl border border-indigo-400/25 bg-indigo-500/[0.08] p-3.5">
                  <p className="text-[11px] uppercase tracking-wider text-indigo-300">Yearly</p>
                  <p className="mt-1 text-lg font-bold tracking-tight text-white">$49</p>
                  <p className="text-[11px] text-slate-500">or ₹2499 per year</p>
                </div>
              </div>

              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">Email</p>
                  <p className="mt-1 truncate font-mono text-sm text-indigo-300">{SUPPORT_EMAIL}</p>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[11px] uppercase tracking-wider text-slate-500">Server ID</p>
                  <p className="mt-1 break-all font-mono text-sm text-slate-300">{guildId}</p>
                </div>
              </div>

              <Link
                href={`/dashboard/${guildId}/pricing`}
                className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-300 hover:text-indigo-200"
              >
                Compare plans and currencies →
              </Link>

              <a href={supportHref} className={buttonClass('primary', 'md', 'w-full')}>
                <Mail className="h-4 w-4" />
                Email support
              </a>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Need help?"
              description="Common questions"
              icon={<HelpCircle className="h-4 w-4" />}
            />
            <CardBody className="space-y-4 text-sm text-slate-400">
              <div>
                <p className="font-semibold text-slate-200">Why is my plan expired?</p>
                <p className="mt-1">
                  Trials run for {TRIAL_DAYS} days and are one-time. After that the server needs a
                  premium activation to keep using premium commands; the trial does not restart.
                </p>
              </div>
              <Divider />
              <div>
                <p className="font-semibold text-slate-200">Can I change plans?</p>
                <p className="mt-1">
                  Yes. Contact support and we will adjust the server record. Changes take effect
                  immediately for the bot and this dashboard.
                </p>
              </div>
              <Divider />
              <div>
                <p className="font-semibold text-slate-200">Is payment handled here?</p>
                <p className="mt-1">No. This page never asks for card details and cannot charge you.</p>
              </div>
            </CardBody>
          </Card>

          {meta.tone === 'red' ? (
            <Card>
              <CardBody>
                <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">
                  <AlertTriangle className="h-4 w-4" />
                  Re-add the bot after upgrading?
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  If you removed the bot while the plan was expired, invite it again after support
                  activates premium.
                </p>
                <Link
                  href={BOT_INVITE_URL}
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-indigo-300 hover:text-indigo-200"
                >
                  Invite the bot
                </Link>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  )
}
