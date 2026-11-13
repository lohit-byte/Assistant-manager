'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  LogOut,
  Mail,
  Monitor,
  Moon,
  Palette,
  Server,
  ServerCog,
  ShieldCheck,
  Sun,
  UserRound,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { useToast } from '@/lib/toast'
import { useTheme, type ThemePreference } from '@/lib/theme'
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  PageHeader,
  buttonClass,
} from '@/components/ui'
import { createClient, signOutToHome } from '@/lib/supabase/client'
import { PLAN_META, SUPPORT_EMAIL, TRIAL_DAYS } from '@/lib/constants'
import { toDate } from '@/lib/format'

const THEME_ICONS = {
  light: Sun,
  dark: Moon,
  system: Monitor,
} as const

const THEME_LABELS: Record<ThemePreference, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match device',
}

const THEME_CONFIRMATION: Record<ThemePreference, string> = {
  light: 'Light mode on.',
  dark: 'Dark mode on.',
  system: 'Following your device appearance.',
}

export default function SettingsPage() {
  const { guildId, guild, isStaff, readOnly, captainTeamIds } = useGuild()
  const { preference, resolved, setTheme } = useTheme()
  const toast = useToast()
  const [accountName, setAccountName] = useState<string>('Discord account')
  const isCaptain = !isStaff && captainTeamIds.length > 0

  useEffect(() => {
    let active = true
    const supabase = createClient()
    void supabase.auth.getUser().then(({ data }) => {
      if (!active) return
      const user = data.user
      if (!user) return
      setAccountName(
        (user.user_metadata?.full_name as string | undefined) ||
          (user.user_metadata?.preferred_username as string | undefined) ||
          user.email ||
          'Discord account',
      )
    })
    return () => {
      active = false
    }
  }, [])

  const plan = PLAN_META[guild.premium_status ?? ''] ?? PLAN_META.expired
  const trialDaysLeft = useMemo(() => {
    if (guild.premium_status !== 'trial') return null
    const end = toDate(guild.trial_ends_at)
    if (!end) return 0
    return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000))
  }, [guild.premium_status, guild.trial_ends_at])

  const chooseTheme = (next: ThemePreference) => {
    if (next === preference) return
    setTheme(next)
    toast.success(
      THEME_CONFIRMATION[next],
      'Saved for this browser. Other staff still see their own setting.',
    )
  }

  return (
    <div className="max-w-4xl">
      <PageHeader
        eyebrow="Account"
        title="Settings"
        description="Personal preferences for this browser and a summary of this server. Server configuration — subteam channels, captains and staff roles — lives in Server setup."
      />

      <div className="space-y-6">
        {/* Appearance ------------------------------------------------------ */}
        <Card>
          <CardHeader
            title="Appearance"
            description="Choose how the dashboard looks on this device. The preference is saved in this browser."
            icon={<Palette className="h-5 w-5" />}
            action={<Badge tone="purple">{resolved === 'light' ? 'Light now' : 'Dark now'}</Badge>}
          />
          <CardBody className="space-y-5">
            <fieldset>
              <legend className="sr-only">Dashboard appearance</legend>
              <div className="grid gap-2 sm:grid-cols-3">
                {(['light', 'dark', 'system'] as const).map((value) => {
                  const Icon = THEME_ICONS[value]
                  const checked = preference === value
                  return (
                    <label
                      key={value}
                      className={`flex cursor-pointer items-start gap-3 border px-4 py-3 text-left transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent-500 has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-ink-950 ${
                        checked
                          ? 'border-accent-500/70 bg-accent-500/[0.08]'
                          : 'border-white/[0.14] hover:border-white/[0.24] hover:bg-white/[0.03]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="dashboard-appearance"
                        value={value}
                        checked={checked}
                        onChange={() => chooseTheme(value)}
                        className="sr-only"
                      />
                      <span
                        className={`mt-0.5 border p-1.5 ${
                          checked
                            ? 'border-accent-500/50 bg-accent-500/10 text-accent-300'
                            : 'border-white/[0.12] text-slate-400'
                        }`}
                      >
                        <Icon className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold text-slate-100">{THEME_LABELS[value]}</span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-slate-500">
                          {value === 'light'
                            ? 'Warm paper background, dark text.'
                            : value === 'dark'
                              ? 'The original matte war board.'
                              : 'Follows this device’s light or dark setting.'}
                        </span>
                      </span>
                    </label>
                  )
                })}
              </div>
            </fieldset>

            <div className="space-y-1.5 border-t border-white/[0.08] pt-4 text-xs leading-relaxed text-slate-500">
              <p>
                Light mode keeps the same warm palette and orange accent as the dark board, with
                darker text on a paper background. It is easier to read in a bright room.
              </p>
              <p>
                <span className="font-semibold text-slate-400">Match device</span> follows your
                phone or computer setting and updates automatically when that setting changes.
              </p>
              <p>
                This only changes the dashboard colours. It does not change the bot, your trial,
                billing, or what other staff and captains see.
              </p>
            </div>
          </CardBody>
        </Card>

        {/* Account --------------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Your account"
            description="You signed in with Discord. Staff access comes from your Discord permissions, not from this page."
            icon={<UserRound className="h-5 w-5" />}
          />
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 border border-white/[0.08] bg-white/[0.02] px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-slate-100">{accountName}</p>
                <p className="mt-0.5 break-all font-mono text-[11px] text-slate-500">{guildId}</p>
              </div>
              <Badge tone={isStaff ? 'green' : readOnly ? 'blue' : 'amber'}>
                {isStaff ? 'Staff access' : readOnly ? 'Read-only member' : isCaptain ? 'Team captain' : 'Member'}
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-slate-500">
              To change servers, use the server card at the top of the sidebar or the switch
              button below. Signing out only affects this browser — the bot keeps running.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Link href="/dashboard" className={buttonClass('secondary', 'sm')}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Switch server
              </Link>
              <Button variant="ghost" size="sm" onClick={signOutToHome}>
                <LogOut className="h-4 w-4" />
                Sign out
              </Button>
            </div>
          </CardBody>
        </Card>

        {/* Server (staff only) --------------------------------------------- */}
        {isStaff ? (
          <Card>
            <CardHeader
              title="This server"
              description="Plan and trial are server-wide: they apply to everyone here, not just you."
              icon={<Server className="h-5 w-5" />}
              action={
                <Badge tone={plan.tone} dot>
                  {plan.label}
                </Badge>
              }
            />
            <CardBody className="space-y-4">
              <dl className="grid gap-3 sm:grid-cols-3">
                <div className="border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                  <dt className="mono-label">Server ID</dt>
                  <dd className="mt-1 break-all font-mono text-xs text-slate-300">{guildId}</dd>
                </div>
                <div className="border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                  <dt className="mono-label">Plan</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-100">{plan.label}</dd>
                </div>
                <div className="border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                  <dt className="mono-label">Trial</dt>
                  <dd className="mt-1 text-sm font-semibold text-slate-100">
                    {trialDaysLeft !== null ? `${trialDaysLeft} of ${TRIAL_DAYS} days left` : 'Not on a trial'}
                  </dd>
                </div>
              </dl>
              <p className="text-xs leading-relaxed text-slate-500">{plan.description}</p>
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/dashboard/${guildId}/billing`} className={buttonClass('secondary', 'sm')}>
                  <CreditCard className="h-3.5 w-3.5" />
                  Open billing
                </Link>
                <p className="text-xs text-slate-500">
                  Upgrades, renewals and receipts are handled there.
                </p>
              </div>
            </CardBody>
          </Card>
        ) : null}

        {/* Server setup (staff only) --------------------------------------- */}
        {isStaff ? (
          <Card>
            <CardHeader
              title="Server setup"
              description="Subteam war channels, captains, and the staff roles the bot reads."
              icon={<ServerCog className="h-5 w-5" />}
            />
            <CardBody className="flex flex-wrap items-center justify-between gap-4">
              <p className="max-w-xl text-xs leading-relaxed text-slate-500">
                Each subteam is one war channel. The Leader, Helper
                (co-lead) and Staff role IDs there all count as staff to the bot — use them to
                split who gets its staff commands.
              </p>
              <Link href={`/dashboard/${guildId}/setup`} className={buttonClass('primary', 'sm')}>
                <ServerCog className="h-3.5 w-3.5" />
                Open server setup
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </CardBody>
          </Card>
        ) : null}

        {/* Support --------------------------------------------------------- */}
        <Card>
          <CardHeader
            title="Need help?"
            description="Support answers billing questions, permission problems and anything the dashboard gets wrong."
            icon={<ShieldCheck className="h-5 w-5" />}
          />
          <CardBody className="space-y-4">
            <p className="text-sm leading-relaxed text-slate-400">
              Email{' '}
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Dashboard%20help%20for%20server%20${guildId}`}
                className="font-semibold text-accent-300 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-200"
              >
                {SUPPORT_EMAIL}
              </a>{' '}
              and include your server ID so we can find the right account.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`mailto:${SUPPORT_EMAIL}?subject=Dashboard%20help%20for%20server%20${guildId}`}
                className={buttonClass('secondary', 'sm')}
              >
                <Mail className="h-3.5 w-3.5" />
                Email support
              </a>
              <Link href="/legal" className={buttonClass('ghost', 'sm')}>
                Read the terms
                <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
