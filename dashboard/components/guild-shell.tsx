'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import {
  ArrowLeft,
  ChevronRight,
  ChevronsUpDown,
  CreditCard,
  ExternalLink,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Map,
  Menu,
  RefreshCw,
  Rocket,
  Server,
  ShieldAlert,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canManageGuild, DiscordApiError, fetchDiscordGuilds, type DiscordGuild } from '@/lib/discord'
import { BOT_INVITE_URL, DISCORD_GUILD_ICON, PLAN_META, SUPPORT_EMAIL } from '@/lib/constants'
import { getGuild } from '@/lib/data'
import { cn, toDate } from '@/lib/format'
import type { Guild } from '@/lib/types'
import { Badge, Button, Card, CardBody, Spinner, buttonClass } from '@/components/ui'

interface GuildContextValue {
  guildId: string
  guild: Guild
  refresh: () => Promise<void>
}

const GuildContext = createContext<GuildContextValue | null>(null)

export function useGuild(): GuildContextValue {
  const value = useContext(GuildContext)
  if (!value) throw new Error('useGuild must be used inside GuildShell')
  return value
}

const NAV_GROUPS = [
  {
    label: 'Workspace',
    items: [{ name: 'Overview', segment: '', icon: LayoutDashboard }],
  },
  {
    label: 'Events',
    items: [
      { name: 'War', segment: '/war', icon: Swords },
      { name: 'Race', segment: '/race', icon: Trophy },
      { name: 'Maze', segment: '/maze', icon: Map },
    ],
  },
  {
    label: 'Manage',
    items: [
      { name: 'Aliases', segment: '/aliases', icon: Users },
      { name: 'Updates', segment: '/updates', icon: Rocket },
    ],
  },
  {
    label: 'Account',
    items: [
      { name: 'Pricing', segment: '/pricing', icon: Sparkles },
      { name: 'Billing', segment: '/billing', icon: CreditCard },
    ],
  },
]

type AccessError =
  | { kind: 'discord'; message: string }
  | { kind: 'forbidden'; message: string }
  | { kind: 'not-added'; message: string }
  | { kind: 'unknown'; message: string }

function planMeta(status: string | null | undefined) {
  return PLAN_META[status ?? ''] ?? PLAN_META.expired
}

function trialDaysLeft(guild: Guild): number {
  const end = toDate(guild.trial_ends_at)
  if (!end) return 0
  return Math.max(0, Math.ceil((end.getTime() - Date.now()) / 86_400_000))
}

function Logo() {
  return (
    <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-b from-indigo-400/25 to-indigo-600/10 text-indigo-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <ShieldAlert className="h-4 w-4" />
    </span>
  )
}

export default function GuildShell({
  guildId,
  children,
}: {
  guildId: string
  children: ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [guild, setGuild] = useState<Guild | null>(null)
  const [discordGuild, setDiscordGuild] = useState<DiscordGuild | null>(null)
  const [error, setError] = useState<AccessError | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [userLabel, setUserLabel] = useState('Account')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.replace('/')
        return
      }

      setUserLabel(
        (session.user.user_metadata?.full_name as string | undefined) ||
          (session.user.user_metadata?.preferred_username as string | undefined) ||
          session.user.email ||
          'Account',
      )

      if (!session.provider_token) {
        setError({
          kind: 'discord',
          message:
            'Discord access has expired. Sign out and sign in again to refresh your server permissions.',
        })
        return
      }

      const guilds = await fetchDiscordGuilds(session.provider_token)
      const match = guilds.find((item) => item.id === guildId)

      if (!match || !canManageGuild(match)) {
        setError({
          kind: 'forbidden',
          message:
            'You need the Manage Server or Administrator permission in this server to open its dashboard.',
        })
        return
      }

      setDiscordGuild(match)

      const row = await getGuild(supabase, guildId)
      if (!row) {
        setError({
          kind: 'not-added',
          message:
            'The bot is not in this server yet. Invite it first, then reload this page once it has started.',
        })
        return
      }

      setGuild(row)
    } catch (caught) {
      if (caught instanceof DiscordApiError) {
        setError({ kind: 'discord', message: caught.message })
      } else {
        setError({
          kind: 'unknown',
          message: caught instanceof Error ? caught.message : 'Could not verify access.',
        })
      }
    } finally {
      setLoading(false)
    }
  }, [guildId, router])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    setMenuOpen(false)
  }, [pathname])

  const refresh = useCallback(async () => {
    try {
      const row = await getGuild(createClient(), guildId)
      if (row) setGuild(row)
    } catch {
      // Keep the previous snapshot; the page-level error handling reports it.
    }
  }, [guildId])

  const context = useMemo<GuildContextValue | null>(
    () => (guild ? { guildId, guild, refresh } : null),
    [guild, guildId, refresh],
  )

  const signOut = async () => {
    await createClient().auth.signOut()
    router.replace('/')
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/[0.08] bg-indigo-500/10 text-indigo-300">
            <Server className="h-6 w-6" />
          </div>
          <Spinner label="Checking your permissions…" />
        </div>
      </div>
    )
  }

  if (error || !context) {
    return <AccessErrorScreen error={error} onRetry={load} />
  }

  const activeGuild = context.guild
  const meta = planMeta(activeGuild.premium_status)
  const iconUrl =
    discordGuild?.icon && discordGuild.id
      ? DISCORD_GUILD_ICON(discordGuild.id, discordGuild.icon)
      : null

  const allItems = NAV_GROUPS.flatMap((group) => group.items)
  const activeItem =
    allItems.find((item) => pathname === `/dashboard/${guildId}${item.segment}`) ?? allItems[0]
  const initials = userLabel.slice(0, 2).toUpperCase()

  return (
    <GuildContext.Provider value={context}>
      <div className="min-h-screen bg-ink-950 text-slate-100">
        <div
          className={cn(
            'fixed inset-0 z-30 bg-black/70 backdrop-blur-sm transition-opacity lg:hidden',
            menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
          )}
          onClick={() => setMenuOpen(false)}
          aria-hidden
        />

        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col border-r border-white/[0.06] bg-ink-950/90 backdrop-blur-xl transition-transform duration-200 lg:translate-x-0',
            menuOpen ? 'translate-x-0' : '-translate-x-full',
          )}
        >
          <div className="flex items-center justify-between px-5 pb-4 pt-5">
            <Link href="/" className="flex items-center gap-2.5">
              <Logo />
              <span className="text-sm font-semibold tracking-tight text-white">
                Legends Assistant
              </span>
            </Link>
            <button
              type="button"
              className="rounded-lg p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-white lg:hidden"
              onClick={() => setMenuOpen(false)}
              aria-label="Close navigation"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="px-3">
            <Link
              href="/dashboard"
              className="group flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 transition-colors hover:border-white/[0.12] hover:bg-white/[0.05]"
            >
              {iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={iconUrl}
                  alt=""
                  className="h-9 w-9 rounded-lg border border-white/[0.08] object-cover"
                />
              ) : (
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.04]">
                  <Server className="h-4 w-4 text-slate-400" />
                </span>
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-white">
                  {discordGuild?.name ?? 'Discord server'}
                </span>
                <span className="block truncate font-mono text-[11px] text-slate-500">
                  {guildId}
                </span>
              </span>
              <ChevronsUpDown className="h-4 w-4 shrink-0 text-slate-600 transition-colors group-hover:text-slate-400" />
            </Link>
          </div>

          <nav className="mt-5 flex-1 space-y-5 overflow-y-auto px-3 pb-4">
            {NAV_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-600">
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.items.map((item) => {
                    const href = `/dashboard/${guildId}${item.segment}`
                    const active = pathname === href
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.name}
                        href={href}
                        className={cn(
                          'group relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          active
                            ? 'bg-white/[0.07] text-white'
                            : 'text-slate-400 hover:bg-white/[0.04] hover:text-slate-200',
                        )}
                      >
                        {active ? (
                          <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-gradient-to-b from-indigo-300 to-violet-400" />
                        ) : null}
                        <Icon
                          className={cn(
                            'h-4 w-4 transition-colors',
                            active ? 'text-indigo-300' : 'text-slate-500 group-hover:text-slate-300',
                          )}
                        />
                        {item.name}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>

          <div className="border-t border-white/[0.06] p-3">
            {activeGuild.premium_status !== 'premium' ? (
              <Link
                href={`/dashboard/${guildId}/pricing`}
                className="mb-3 block rounded-xl border border-indigo-400/20 bg-gradient-to-br from-indigo-500/15 via-indigo-500/5 to-transparent p-3 transition-colors hover:border-indigo-400/35"
              >
                <p className="flex items-center gap-1.5 text-xs font-semibold text-indigo-200">
                  <Sparkles className="h-3.5 w-3.5" />
                  {activeGuild.premium_status === 'trial'
                    ? `${trialDaysLeft(activeGuild)} days left in trial`
                    : 'Unlock premium'}
                </p>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  Keep war, race and maze tracking running after the trial.
                </p>
              </Link>
            ) : null}

            <div className="flex items-center gap-2.5 rounded-xl px-2 py-1.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-white/[0.06] text-[11px] font-semibold text-slate-200">
                {initials}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-slate-200">
                  {userLabel}
                </span>
                <span className="block truncate text-[11px] text-slate-600">Discord account</span>
              </span>
              <button
                type="button"
                onClick={signOut}
                className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-white"
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <Link href="/dashboard" className={buttonClass('secondary', 'sm', 'flex-1')}>
                <ArrowLeft className="h-3.5 w-3.5" />
                Switch server
              </Link>
              <a
                href={BOT_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('ghost', 'sm')}
                title="Invite the bot"
                aria-label="Invite the bot"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          </div>
        </aside>

        <div className="lg:pl-[268px]">
          <header className="sticky top-0 z-20 hidden border-b border-white/[0.06] bg-ink-950/70 backdrop-blur-xl lg:block">
            <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6 xl:px-10">
              <div className="flex min-w-0 items-center gap-2 text-sm">
                <span className="truncate text-slate-500">{discordGuild?.name ?? 'Server'}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                <span className="truncate font-medium text-slate-200">{activeItem?.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge tone={meta.tone} dot>
                  {meta.label}
                </Badge>
                <a
                  href={`mailto:${SUPPORT_EMAIL}`}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-white"
                >
                  <LifeBuoy className="h-3.5 w-3.5" />
                  Support
                </a>
              </div>
            </div>
          </header>

          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.06] bg-ink-950/80 px-4 py-3 backdrop-blur-xl lg:hidden">
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              className="rounded-lg p-2 text-slate-300 hover:bg-white/[0.06]"
              aria-label="Open navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-white">
                {discordGuild?.name ?? 'Dashboard'}
              </p>
              <p className="truncate text-[11px] text-slate-500">{activeItem?.name}</p>
            </div>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </header>

          <main className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-10 lg:py-9">{children}</main>
        </div>
      </div>
    </GuildContext.Provider>
  )
}

function AccessErrorScreen({
  error,
  onRetry,
}: {
  error: AccessError | null
  onRetry: () => void
}) {
  const signOut = async () => {
    await createClient().auth.signOut()
    window.location.href = '/'
  }

  if (!error) return null

  const title =
    error.kind === 'forbidden'
      ? 'Access denied'
      : error.kind === 'not-added'
        ? 'Bot not added'
        : error.kind === 'discord'
          ? 'Reconnect Discord'
          : 'Something went wrong'

  return (
    <div className="flex min-h-screen items-center justify-center bg-ink-950 p-6">
      <Card className="w-full max-w-lg">
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-500/10 text-rose-300">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white">{title}</h1>
            <p className="mt-2 text-sm text-slate-400">{error.message}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {error.kind === 'not-added' ? (
              <a
                href={BOT_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass('primary')}
              >
                <ExternalLink className="h-4 w-4" />
                Invite the bot
              </a>
            ) : null}
            {error.kind === 'discord' ? (
              <Button onClick={signOut}>
                <LogOut className="h-4 w-4" />
                Sign in again
              </Button>
            ) : null}
            {error.kind === 'unknown' ? (
              <Button onClick={onRetry}>
                <RefreshCw className="h-4 w-4" />
                Try again
              </Button>
            ) : null}
            <Link href="/dashboard" className={buttonClass('secondary')}>
              Back to servers
            </Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} className={buttonClass('ghost')}>
              Contact support
            </a>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
