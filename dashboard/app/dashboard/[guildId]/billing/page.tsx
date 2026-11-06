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
} from '@/components/ui'
import { BOT_INVITE_URL, PLAN_META, SUPPORT_EMAIL } from '@/lib/constants'
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
          <a
            href={supportHref}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500"
          >
            <Mail className="h-4 w-4" />
            Contact support
          </a>
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

      <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader
            title="Current plan"
            description="Status is read from the bot's guild record"
            icon={<CreditCard className="h-5 w-5" />}
            action={<Badge tone={meta.tone}>{meta.label}</Badge>}
          />
          <CardBody className="space-y-6">
            <div>
              <p className="text-sm text-slate-400">{meta.description}</p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-wider text-slate-500">Status</p>
                <p className="mt-1 text-lg font-bold text-white">{meta.label}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-wider text-slate-500">
                  {status === 'trial' ? 'Trial ends' : 'Trial end'}
                </p>
                <p className="mt-1 text-lg font-bold text-white">{formatDate(trialEnd)}</p>
              </div>
            </div>

            {status === 'trial' ? (
              <div>
                <ProgressBar
                  value={trialDays}
                  max={7}
                  tone={trialDays <= 2 ? 'red' : trialDays <= 4 ? 'amber' : 'green'}
                  label={
                    trialDays > 0
                      ? `${trialDays} ${trialDays === 1 ? 'day' : 'days'} left`
                      : 'Trial ended'
                  }
                />
                <p className="mt-2 text-xs text-slate-500">
                  The trial lasts seven days from the moment the bot joins. Days are rounded up.
                </p>
              </div>
            ) : null}

            <Divider />

            <div>
              <p className="mb-3 text-sm font-semibold text-white">Included with your plan</p>
              <ul className="space-y-2">
                {FEATURES.map((feature) => (
                  <li key={feature} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    {feature}
                  </li>
                ))}
              </ul>
            </div>

            {meta.tone === 'red' ? (
              <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4">
                <p className="flex items-center gap-2 text-sm font-semibold text-red-200">
                  <ShieldAlert className="h-4 w-4" />
                  Premium is paused
                </p>
                <p className="mt-1 text-sm text-red-200/80">
                  Commands that require premium will not run until the plan is renewed.
                </p>
              </div>
            ) : null}
          </CardBody>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Upgrade"
              description="Premium is activated manually"
              icon={<Sparkles className="h-5 w-5" />}
            />
            <CardBody className="space-y-4">
              <p className="text-sm text-slate-400">
                Email us from the address you use for the server and include the server name and ID.
                We will confirm pricing and activate premium.
              </p>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-slate-500">Email</p>
                <p className="mt-1 font-mono text-sm text-purple-300">{SUPPORT_EMAIL}</p>
              </div>
              <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                <p className="text-xs uppercase tracking-wider text-slate-500">Server ID</p>
                <p className="mt-1 font-mono text-sm break-all text-slate-300">{guildId}</p>
              </div>
              <a
                href={supportHref}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-purple-600 px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-purple-500"
              >
                <Mail className="h-4 w-4" />
                Email support
              </a>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Need help?"
              description="Common questions"
              icon={<HelpCircle className="h-5 w-5" />}
            />
            <CardBody className="space-y-4 text-sm text-slate-400">
              <div>
                <p className="font-semibold text-slate-200">Why is my plan expired?</p>
                <p className="mt-1">
                  Trials run for seven days. After that the server needs a premium activation to
                  keep using premium commands.
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
                <p className="mt-1">
                  No. This page never asks for card details and cannot charge you.
                </p>
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
                  className="mt-3 inline-flex items-center gap-1 text-sm font-semibold text-purple-300 hover:text-purple-200"
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
