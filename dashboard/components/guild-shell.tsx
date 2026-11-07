'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { ArrowLeft, CreditCard, ExternalLink, LayoutDashboard, LogOut, Map, Menu, RefreshCw, Server, Settings, ShieldAlert, Swords, Trophy, Users, X, ChevronRight } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canManageGuild, DiscordApiError, fetchDiscordGuilds, type DiscordGuild } from '@/lib/discord'
import { BOT_CLIENT_ID, BOT_INVITE_URL, DISCORD_GUILD_ICON, PLAN_META, SUPPORT_EMAIL } from '@/lib/constants'
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

const NAV = [
  { name: 'Overview', segment: '', icon: LayoutDashboard },
  { name: 'War', segment: '/war', icon: Swords },
  { name: 'Race', segment: '/race', icon: Trophy },
  { name: 'Maze', segment: '/maze', icon: Map },
  { name: 'Aliases', segment: '/aliases', icon: Users },
  { name: 'Settings', segment: '/settings', icon: Settings },
  { name: 'Billing', segment: '/billing', icon: CreditCard },
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

export default function GuildShell({ guildId, children }: { guildId: string; children: ReactNode }) {
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
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return router.replace('/')

      setUserLabel(
        (session.user.user_metadata?.full_name as string | undefined) ||
          (session.user.user_metadata?.preferred_username as string | undefined) ||
          session.user.email || 'Account'
      )

      if (!session.provider_token) {
        return setError({ kind: 'discord', message: 'Discord access expired. Sign out and in again.' })
      }

      const guilds = await fetchDiscordGuilds(session.provider_token)
      const match = guilds.find((item) => item.id === guildId)

      if (!match || !canManageGuild(match)) {
        return setError({ kind: 'forbidden', message: 'You need Manage Server permission.' })
      }

      setDiscordGuild(match)
      const row = await getGuild(supabase, guildId)
      
      if (!row) {
        return setError({ kind: 'not-added', message: 'The bot is not in this server yet.' })
      }

      setGuild(row)
    } catch (caught) {
      if (caught instanceof DiscordApiError) setError({ kind: 'discord', message: caught.message })
      else setError({ kind: 'unknown', message: caught instanceof Error ? caught.message : 'Could not verify access.' })
    } finally {
      setLoading(false)
    }
  }, [guildId, router])

  useEffect(() => { void load() }, [load])
  useEffect(() => { setMenuOpen(false) }, [pathname])

  const refresh = useCallback(async () => {
    try {
      const row = await getGuild(createClient(), guildId)
      if (row) setGuild(row)
    } catch {}
  }, [guildId])

  const context = useMemo<GuildContextValue | null>(() => (guild ? { guildId, guild, refresh } : null), [guild, guildId, refresh])
  const signOut = async () => { await createClient().auth.signOut(); router.replace('/') }

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950"><Spinner label="Checking permissions…" /></div>
  }

  if (error || !context) {
    return <AccessErrorScreen error={error} onRetry={load} guildId={guildId} discordGuild={discordGuild} />
  }

  const meta = planMeta(guild?.premium_status)
  const iconUrl = discordGuild?.icon && discordGuild.id ? DISCORD_GUILD_ICON(discordGuild.id, discordGuild.icon) : null

  return (
    <GuildContext.Provider value={context}>
      <div className="min-h-screen bg-slate-950 text-slate-100">
        <div className={cn('fixed inset-0 z-30 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden', menuOpen ? 'opacity-100' : 'pointer-events-none opacity-0')} onClick={() => setMenuOpen(false)} />
        <aside className={cn('fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-800 bg-slate-950/95 transition-transform duration-200 lg:translate-x-0', menuOpen ? 'translate-x-0' : '-translate-x-full')}>
          <div className="flex items-center justify-between border-b border-slate-800 px-5 py-4">
            <Link href="/dashboard" className="flex items-center gap-2 text-sm font-medium text-slate-400 hover:text-white"><ArrowLeft className="h-4 w-4" /> All servers</Link>
            <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-800 lg:hidden" onClick={() => setMenuOpen(false)}><X className="h-5 w-5" /></button>
          </div>

          <div className="border-b border-slate-800 px-5 py-5">
            <div className="flex items-center gap-3">
              {iconUrl ? <img src={iconUrl} alt="" className="h-12 w-12 rounded-2xl border border-slate-700 object-cover" /> : <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800"><Server className="h-6 w-6 text-slate-400" /></div>}
              <div className="min-w-0"><p className="truncate font-semibold text-white">{discordGuild?.name ?? 'Discord server'}</p><p className="font-mono text-xs text-slate-500">{guildId}</p></div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Badge tone={meta.tone} dot>{meta.label}</Badge>
              {guild?.premium_status === 'trial' ? <span className="text-xs text-slate-500">{trialDaysLeft(guild)} days left</span> : null}
            </div>
          </div>

          <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
            {NAV.map((item) => {
              const href = `/dashboard/${guildId}${item.segment}`
              const active = pathname === href
              const Icon = item.icon
              return (
                <Link key={item.name} href={href} className={cn('flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-medium transition-colors', active ? 'bg-purple-600 text-white shadow-lg shadow-purple-950/40' : 'text-slate-400 hover:bg-slate-900 hover:text-white')}>
                  <Icon className="h-5 w-5" /> {item.name}
                </Link>
              )
            })}
          </nav>

          <div className="border-t border-slate-800 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className="min-w-0"><p className="truncate text-sm font-medium text-slate-300">{userLabel}</p><p className="text-xs text-slate-600">Signed in</p></div>
              <button onClick={signOut} className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"><LogOut className="h-4 w-4" /></button>
            </div>
          </div>
        </aside>

        <div className="lg:pl-72">
          <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur lg:hidden">
            <button onClick={() => setMenuOpen(true)} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800"><Menu className="h-5 w-5" /></button>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-white">{discordGuild?.name ?? 'Dashboard'}</p></div>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </header>
          <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10 lg:py-10">{children}</main>
        </div>
      </div>
      
      {/* ONBOARDING TOUR */}
      <OnboardingTour />
    </GuildContext.Provider>
  )
}

function AccessErrorScreen({ error, onRetry, guildId, discordGuild }: { error: AccessError | null; onRetry: () => void; guildId: string; discordGuild: DiscordGuild | null }) {
  const signOut = async () => { await createClient().auth.signOut(); window.location.href = '/' }
  if (!error) return null

  const title = error.kind === 'forbidden' ? 'Access denied' : error.kind === 'not-added' ? 'Bot not added' : error.kind === 'discord' ? 'Reconnect Discord' : 'Something went wrong'
  const specificInviteUrl = `https://discord.com/oauth2/authorize?client_id=${BOT_CLIENT_ID}&permissions=257088&scope=bot&guild_id=${guildId}&disable_guild_select=true`

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6">
      <Card className="w-full max-w-lg">
        <CardBody className="space-y-5 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-red-500/30 bg-red-500/10 text-red-300">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">{title}</h1>
            <p className="mt-2 text-sm text-slate-400">{error.message}</p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {error.kind === 'not-added' && (
              <a href={specificInviteUrl} target="_blank" rel="noopener noreferrer" className={buttonClass('primary', 'lg', 'w-full')}>
                <ExternalLink className="h-5 w-5 mr-2" /> Add Bot to {discordGuild?.name || 'Server'}
              </a>
            )}
            {error.kind === 'discord' && <Button onClick={signOut}><LogOut className="h-4 w-4 mr-2" /> Sign in again</Button>}
            {error.kind === 'unknown' && <Button onClick={onRetry}><RefreshCw className="h-4 w-4 mr-2" /> Try again</Button>}
            {error.kind !== 'not-added' && <Link href="/dashboard" className={buttonClass('secondary')}>Back to servers</Link>}
          </div>
        </CardBody>
      </Card>
    </div>
  )
}

function OnboardingTour() {
  const [step, setStep] = useState(0)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('ml_tour_seen')) setIsVisible(true)
  }, [])

  if (!isVisible) return null

  const steps = [
    { title: "Welcome to your Dashboard!", text: "This is your command center. The bot does the heavy lifting in Discord, and this website gives you a live view of your server." },
    { title: "Live War Tracking", text: "Click 'War' on the left to see your 48-hour timers, who missed attacks, and attack logs updated in real-time." },
    { title: "Race & Maze Automation", text: "Upload community JSON sheets for the Race, or schedule Maze events so the bot auto-pings your team." }
  ]

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1)
    else { localStorage.setItem('ml_tour_seen', 'true'); setIsVisible(false) }
  }

  return (
    <div className="fixed bottom-8 right-8 z-50 w-80 bg-slate-900 border border-purple-500/50 shadow-2xl rounded-2xl p-6">
      <button onClick={() => { localStorage.setItem('ml_tour_seen', 'true'); setIsVisible(false) }} className="absolute top-4 right-4 text-slate-500 hover:text-white"><X className="w-4 h-4" /></button>
      <Badge tone="purple" className="mb-3">Step {step + 1} of {steps.length}</Badge>
      <h3 className="text-lg font-bold text-white mb-2">{steps[step].title}</h3>
      <p className="text-sm text-slate-400 mb-6">{steps[step].text}</p>
      <div className="flex justify-between items-center">
        <button onClick={() => { localStorage.setItem('ml_tour_seen', 'true'); setIsVisible(false) }} className="text-xs text-slate-500 hover:text-white">Skip Tour</button>
        <Button size="sm" onClick={handleNext}>{step === steps.length - 1 ? 'Finish' : 'Next'} <ChevronRight className="w-4 h-4 ml-1" /></Button>
      </div>
    </div>
  )
}
