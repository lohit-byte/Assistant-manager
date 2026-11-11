'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  Crown,
  ExternalLink,
  Eye,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Map,
  Menu,
  RefreshCw,
  Server,
  ServerCog,
  Settings,
  ShieldAlert,
  Sparkles,
  Swords,
  Trophy,
  Users,
  X,
} from 'lucide-react'
import { createClient, signOutToHome } from '@/lib/supabase/client'
import { canManageGuild, DiscordApiError, discordIdFromSession, fetchDiscordGuilds, type DiscordGuild } from '@/lib/discord'
import { BOT_INVITE_URL, DISCORD_GUILD_ICON, PLAN_META, SUPPORT_EMAIL } from '@/lib/constants'
import { getGuild, isAliasMember, listTeamCaptains, listTeams } from '@/lib/data'
import { cn, toDate } from '@/lib/format'
import type { Guild, Team } from '@/lib/types'
import { Badge, Button, Card, CardBody, Spinner, buttonClass } from '@/components/ui'
import { BrandMark } from '@/components/brand'
import { ToastProvider } from '@/lib/toast'

interface GuildContextValue {
  guildId: string
  guild: Guild
  /** True when the viewer has Discord Manage Server/Administrator here. */
  isStaff: boolean
  /**
   * True when the viewer can edit nothing (no staff, no captain teams): a premium server's
   * alias member, or a captain of nothing. Captains get write on their own team channels only,
   * so they are not read-only; `canManageChannel` decides each control.
   */
  readOnly: boolean
  /** The guild's teams, loaded once so every page can scope edits and links. */
  teams: Team[]
  /** Ids of the teams this viewer captains (empty for staff). */
  captainTeamIds: number[]
  /** Staff everywhere, captains on their team's war/race channels. */
  canManageChannel(channelId: string | null | undefined): boolean
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
    items: [
      {
        name: 'Overview',
        segment: '',
        icon: LayoutDashboard,
        hint: 'The live war/race snapshot and a setup checklist',
      },
    ],
  },
  {
    label: 'Events',
    items: [
      { name: 'War', segment: '/war', icon: Swords, hint: 'War clock, missing attacks, warnings and rating' },
      { name: 'Race', segment: '/race', icon: Trophy, hint: 'Race nodes, targets and node sheets' },
      { name: 'Maze', segment: '/maze', icon: Map, hint: 'Maze schedule and automatic discount pings' },
    ],
  },
  {
    label: 'Manage',
    items: [
      {
        name: 'Server setup',
        segment: '/setup',
        icon: ServerCog,
        hint: 'Each subteam’s war and race channels, captains, and the staff roles the bot reads',
      },
      { name: 'Aliases', segment: '/aliases', icon: Users, hint: 'Map in-game names to Discord users' },
    ],
  },
  {
    label: 'Account',
    items: [
      {
        name: 'Settings',
        segment: '/settings',
        icon: Settings,
        hint: 'Appearance, account and this server’s plan',
      },
      { name: 'Billing', segment: '/billing', icon: CreditCard, hint: 'Trial, plan and payments' },
    ],
  },
]

// Pages that change server state. Read-only members never see these in the nav and
// render a "Staff only" panel if they open the URL directly.
const STAFF_ONLY_SEGMENTS = new Set(['/aliases', '/billing', '/setup'])

// Captains can only act on their own team's channels. Settings stays available because the
// appearance preference is personal, not server configuration.
const CAPTAIN_SEGMENTS = new Set(['', '/war', '/race', '/settings'])

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
  return <BrandMark className="h-9 w-9" />
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
  const [isStaff, setIsStaff] = useState(false)
  const [readOnly, setReadOnly] = useState(false)
  const [teams, setTeams] = useState<Team[]>([])
  const [captainTeamIds, setCaptainTeamIds] = useState<number[]>([])
  const [discordGuild, setDiscordGuild] = useState<DiscordGuild | null>(null)
  const [error, setError] = useState<AccessError | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isDesktop, setIsDesktop] = useState(false)
  const [userLabel, setUserLabel] = useState('Account')
  const asideRef = useRef<HTMLElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  /** Discord id of the viewer, kept so `refresh` can re-check captain rows. */
  const discordIdRef = useRef<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setIsStaff(false)
    setReadOnly(false)
    setTeams([])
    setCaptainTeamIds([])
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

      // Load the guild row first: without it there is no dashboard at all, so the
      // "bot not added" state must win before we reason about Discord permissions.
      const row = await getGuild(supabase, guildId)
      if (!row) {
        setError({
          kind: 'not-added',
          message:
            'The bot is not in this server yet. Invite it first, then reload this page once it has started.',
        })
        return
      }

      const discordId = discordIdFromSession(session.user)
      discordIdRef.current = discordId

      // Teams and captains are additive: if the migration has not been run (or the lookup
      // fails) the dashboard must still open with no teams, exactly as before.
      let guildTeams: Team[] = []
      try {
        guildTeams = await listTeams(supabase, guildId)
      } catch {
        guildTeams = []
      }

      const guildTeamIds = new Set(guildTeams.map((team) => Number(team.id)))
      let myCaptainTeamIds: number[] = []
      if (discordId && guildTeams.length > 0) {
        try {
          const captainRows = await listTeamCaptains(supabase, guildTeams.map((team) => team.id))
          myCaptainTeamIds = Array.from(
            new Set(
              captainRows
                .filter(
                  (captain) =>
                    String(captain.discord_id) === discordId &&
                    guildTeamIds.has(Number(captain.team_id)),
                )
                .map((captain) => Number(captain.team_id)),
            ),
          )
        } catch {
          myCaptainTeamIds = []
        }
      }
      // A `team_captains` row is an access grant on any plan, with no alias row required.
      const isCaptain = myCaptainTeamIds.length > 0

      const enter = (staff: boolean, readOnlyAccess: boolean) => {
        setGuild(row)
        setTeams(guildTeams)
        setCaptainTeamIds(myCaptainTeamIds)
        setIsStaff(staff)
        setReadOnly(readOnlyAccess)
      }

      // A premium server's alias members may view its dashboard read-only. This is
      // also the fallback when the Discord guild list cannot be loaded (expired token).
      const allowReadOnly = async (): Promise<boolean> => {
        if (row.premium_status !== 'premium' || !discordId) return false
        return isAliasMember(supabase, guildId, discordId)
      }

      if (!session.provider_token) {
        if (isCaptain) {
          enter(false, false)
          return
        }
        if (await allowReadOnly()) {
          enter(false, true)
          return
        }
        setError({
          kind: 'discord',
          message:
            'Discord access has expired. Sign out and sign in again to refresh your server permissions.',
        })
        return
      }

      let guilds: DiscordGuild[]
      try {
        guilds = await fetchDiscordGuilds(session.provider_token)
      } catch (caught) {
        // Discord being unreachable must not lock out captains or premium alias members.
        if (isCaptain) {
          enter(false, false)
          return
        }
        if (await allowReadOnly()) {
          enter(false, true)
          return
        }
        throw caught
      }

      const match = guilds.find((item) => item.id === guildId) ?? null
      setDiscordGuild(match)

      if (match && canManageGuild(match)) {
        enter(true, false)
        return
      }

      if (isCaptain) {
        enter(false, false)
        return
      }

      if (await allowReadOnly()) {
        enter(false, true)
        return
      }

      setError({
        kind: 'forbidden',
        message:
          'You need the Manage Server or Administrator permission in this server to open its dashboard.',
      })
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

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)')
    const update = () => setIsDesktop(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  useEffect(() => {
    if (asideRef.current) asideRef.current.inert = !isDesktop && !menuOpen
  }, [isDesktop, menuOpen])

  useEffect(() => {
    if (!menuOpen) return
    const previous = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeButtonRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab' || !asideRef.current) return
      const nodes = asideRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      )
      if (nodes.length === 0) return
      const list = Array.from(nodes)
      const first = list[0]
      const last = list[list.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [menuOpen])

  const refresh = useCallback(async () => {
    const supabase = createClient()
    try {
      const row = await getGuild(supabase, guildId)
      if (row) setGuild(row)
    } catch {
      // Keep the previous snapshot; the page-level error handling reports it.
    }

    // Teams and captain rows are edited from the Overview setup card; reload them so a
    // session that just created a team can manage its channels without a full page reload.
    let nextTeams: Team[] = []
    try {
      nextTeams = await listTeams(supabase, guildId)
    } catch {
      nextTeams = []
    }
    setTeams(nextTeams)

    const viewerId = discordIdRef.current
    if (viewerId && nextTeams.length > 0) {
      try {
        const captainRows = await listTeamCaptains(
          supabase,
          nextTeams.map((team) => team.id),
        )
        const teamIds = new Set(nextTeams.map((team) => Number(team.id)))
        setCaptainTeamIds(
          Array.from(
            new Set(
              captainRows
                .filter(
                  (captain) =>
                    String(captain.discord_id) === viewerId && teamIds.has(Number(captain.team_id)),
                )
                .map((captain) => Number(captain.team_id)),
            ),
          ),
        )
      } catch {
        setCaptainTeamIds([])
      }
    } else {
      setCaptainTeamIds([])
    }
  }, [guildId])

  const canManageChannel = useCallback(
    (channelId: string | null | undefined): boolean => {
      if (!channelId) return false
      if (isStaff) return true
      const id = String(channelId)
      return teams.some(
        (team) =>
          captainTeamIds.includes(Number(team.id)) &&
          (String(team.war_channel_id) === id || String(team.race_channel_id) === id),
      )
    },
    [captainTeamIds, isStaff, teams],
  )

  const context = useMemo<GuildContextValue | null>(
    () =>
      guild
        ? {
            guildId,
            guild,
            isStaff,
            readOnly,
            teams,
            captainTeamIds,
            canManageChannel,
            refresh,
          }
        : null,
    [canManageChannel, captainTeamIds, guild, guildId, isStaff, readOnly, refresh, teams],
  )

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950">
        <div className="flex flex-col items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center border border-white/[0.12] bg-white/[0.02] text-accent-400">
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
  const isCaptain = !context.isStaff && context.captainTeamIds.length > 0
  // Staff see everything; captains only Overview/War/Race; read-only alias members lose the
  // staff-only pages but keep their read-only Maze view.
  const navGroups = context.isStaff
    ? NAV_GROUPS
    : NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          isCaptain
            ? CAPTAIN_SEGMENTS.has(item.segment)
            : !STAFF_ONLY_SEGMENTS.has(item.segment),
        ),
      })).filter((group) => group.items.length > 0)
  const initials = userLabel.slice(0, 2).toUpperCase()

  return (
    <ToastProvider>
      <GuildContext.Provider value={context}>
        <div className="min-h-screen bg-ink-950 text-slate-100">
          <div
            className={cn(
              'fixed inset-0 z-30 bg-black/75 transition-opacity lg:hidden',
              menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0',
            )}
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />

          <aside
            ref={asideRef}
            className={cn(
              'fixed inset-y-0 left-0 z-40 flex w-[268px] flex-col border-r border-white/[0.12] bg-ink-950 transition-transform duration-200 lg:translate-x-0',
              menuOpen ? 'translate-x-0' : '-translate-x-full',
            )}
          >
            <div className="flex items-center justify-between px-5 pb-4 pt-5">
              <Link href="/" className="flex items-center gap-2.5">
                <Logo />
                <span className="flex flex-col leading-none">
                  <span className="text-[13px] font-semibold tracking-tight text-slate-100">
                    Legends Assistant
                  </span>
                  <span className="mono-label mt-1 text-[9px] text-slate-500">Alliance ops</span>
                </span>
              </Link>
              <button
                type="button"
                ref={closeButtonRef}
                className="p-1.5 text-slate-400 hover:bg-white/[0.06] hover:text-slate-50 lg:hidden"
                onClick={() => setMenuOpen(false)}
                aria-label="Close navigation"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="px-3">
              <Link
                href="/dashboard"
                className="group flex items-center gap-3 rounded-sm border border-white/[0.12] bg-white/[0.02] px-3 py-2.5 transition-colors hover:border-accent-500/50 hover:bg-white/[0.04]"
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
                  <span className="block truncate text-sm font-semibold text-slate-50">
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
              {navGroups.map((group) => (
                <div key={group.label}>
                  <p className="mono-label mb-1.5 px-3 text-[10px] text-slate-600">
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
                          title={item.hint}
                          className={cn(
                            'group relative flex items-center gap-3 rounded-sm border border-transparent px-3 py-2 text-sm font-medium transition-colors',
                            active
                              ? 'border-white/[0.08] bg-white/[0.04] text-slate-50'
                              : 'text-slate-400 hover:bg-white/[0.03] hover:text-slate-100',
                          )}
                        >
                          {active ? (
                            <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 bg-accent-500" />
                          ) : null}
                          <Icon
                            className={cn(
                              'h-4 w-4 transition-colors',
                              active ? 'text-accent-400' : 'text-slate-500 group-hover:text-slate-300',
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
              {context.isStaff && activeGuild.premium_status !== 'premium' ? (
                <Link
                  href={`/dashboard/${guildId}/billing`}
                  className="mb-3 block rounded-sm border border-accent-500/30 bg-accent-500/[0.05] p-3 transition-colors hover:border-accent-500/60"
                >
                  <p className="flex items-center gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.1em] text-accent-300">
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
                  onClick={signOutToHome}
                  className="rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-white/[0.06] hover:text-slate-50"
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
            <header className="sticky top-0 z-20 hidden border-b border-white/[0.1] bg-ink-950 lg:block">
              <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-4 px-6 xl:px-10">
                <div className="flex min-w-0 items-center gap-2 text-sm">
                  <span className="mono-label truncate text-slate-500">{discordGuild?.name ?? 'Server'}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0 text-slate-700" />
                  <span className="truncate font-mono text-[11px] uppercase tracking-[0.12em] text-slate-200">
                    {activeItem?.name}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  {context.readOnly ? (
                    <Badge tone="blue" dot>
                      Read-only member access
                    </Badge>
                  ) : isCaptain ? (
                    <Badge tone="blue" dot>
                      Team captain
                    </Badge>
                  ) : null}
                  <Badge tone={meta.tone} dot>
                    {meta.label}
                  </Badge>
                  <a
                    href={`mailto:${SUPPORT_EMAIL}`}
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-400 transition-colors hover:bg-white/[0.06] hover:text-slate-50"
                  >
                    <LifeBuoy className="h-3.5 w-3.5" />
                    Support
                  </a>
                </div>
              </div>
            </header>

            <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/[0.1] bg-ink-950 px-4 py-3 lg:hidden">
              <button
                type="button"
                onClick={() => setMenuOpen(true)}
                className="rounded-lg p-2 text-slate-300 hover:bg-white/[0.06]"
                aria-label="Open navigation"
              >
                <Menu className="h-5 w-5" />
              </button>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-slate-50">
                  {discordGuild?.name ?? 'Dashboard'}
                </p>
                <p className="mono-label truncate text-slate-500">{activeItem?.name}</p>
              </div>
              <Badge tone={meta.tone}>{meta.label}</Badge>
            </header>

            <main id="main" className="mx-auto max-w-7xl px-4 py-7 sm:px-6 lg:px-10 lg:py-9">
              {context.readOnly ? (
                <div className="mb-6 flex items-start gap-2.5 rounded-sm border border-steel-500/30 bg-steel-500/[0.06] px-4 py-3">
                  <Eye className="mt-0.5 h-4 w-4 shrink-0 text-steel-300" aria-hidden />
                  <div>
                    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-steel-300">
                      Read-only member access
                    </p>
                    <p className="mt-0.5 text-sm text-slate-400">
                      Staff added an alias for you on this premium server, so you can view its
                      dashboard. Editing is limited to staff.
                    </p>
                  </div>
                </div>
              ) : isCaptain ? (
                <div className="mb-6 flex items-start gap-2.5 rounded-sm border border-steel-500/30 bg-steel-500/[0.06] px-4 py-3">
                  <Crown className="mt-0.5 h-4 w-4 shrink-0 text-steel-300" aria-hidden />
                  <div>
                    <p className="font-mono text-[10px] font-medium uppercase tracking-[0.12em] text-steel-300">
                      Team captain access
                    </p>
                    <p className="mt-0.5 text-sm text-slate-400">
                      You can manage your own team&apos;s war and race channels. Server settings,
                      aliases, maze and other teams stay staff-only.
                    </p>
                  </div>
                </div>
              ) : null}
              {children}
            </main>
          </div>
        </div>
      </GuildContext.Provider>
    </ToastProvider>
  )
}

function AccessErrorScreen({
  error,
  onRetry,
}: {
  error: AccessError | null
  onRetry: () => void
}) {
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
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-danger-500/25 bg-danger-500/10 text-danger-300">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-slate-50">{title}</h1>
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
              <Button onClick={signOutToHome}>
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
