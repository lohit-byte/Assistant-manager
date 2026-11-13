'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  Clock,
  CreditCard,
  Map,
  RefreshCw,
  ServerCog,
  ShieldCheck,
  Target,
  Users,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { effectiveTeamLimit } from '@/lib/plans'
import { WarSpine } from '@/components/war-spine'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  ProgressBar,
  Spinner,
  Stat,
  buttonClass,
} from '@/components/ui'
import { getGuildSummary, type GuildSummary } from '@/lib/data'
import { buildSetupSummary } from '@/lib/setup'
import { createClient } from '@/lib/supabase/client'
import { PLAN_META, TRIAL_DAYS } from '@/lib/constants'
import {
  currentMazeMoment,
  formatDateTime,
  formatRelative,
  getWarWindow,
  mazeMoments,
  nextMazeMoment,
  toDate,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'

export default function OverviewPage() {
  const { guildId, guild, teams, isStaff } = useGuild()
  const now = useNow()
  const [summary, setSummary] = useState<GuildSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      setError(null)

      try {
        setSummary(await getGuildSummary(createClient(), guildId))
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load the overview.')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const plan = PLAN_META[guild.premium_status ?? ''] ?? PLAN_META.expired
  const trialDays = useMemo(() => {
    const end = toDate(guild.trial_ends_at)
    if (!end) return 0
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000))
  }, [guild.trial_ends_at, now])

  const warWindow = getWarWindow(summary?.war ?? null)
  const warMissing = summary?.war?.missing_list?.length ?? 0
  const warExcused = summary?.war?.absent_list?.length ?? 0
  const warLogged = Object.keys(summary?.war?.attack_counts ?? {}).length

  const maze = summary?.maze
  const mazeEvent = summary?.mazeEvent
  const mazeStart = toDate(mazeEvent?.event_start)
  const mazeEnd = toDate(mazeEvent?.event_end)
  const mazeWindows = summary?.mazeWindows ?? undefined
  const moments = useMemo(
    () => mazeMoments(mazeStart, now, mazeWindows),
    [mazeStart, now, mazeWindows],
  )
  const liveMoment = currentMazeMoment(moments)
  const upcoming = nextMazeMoment(moments)
  const upcomingChunks = useMemo(() => moments.filter((moment) => !moment.past), [moments])

  // Server setup checklist. Goal-gradient framing: the bot is already in this server (otherwise
  // the dashboard could not load it), so setup is never a 0% state. Everything is edited on the
  // Server setup page, which the nav, this card and Settings all point at.
  const setup = buildSetupSummary({
    teamCount: teams.length,
    maxTeams: effectiveTeamLimit(guild),
    leaderRoleId: guild.leader_role_id,
    coleadRoleId: guild.colead_role_id,
    staffRoleId: guild.staff_role_id,
    mazeChannelId: guild.maze_channel_id,
  })

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Server snapshot"
        description="A live look at the bot state for this server. Data is read directly from the same tables the bot uses."
        actions={
          <Button variant="secondary" onClick={() => load('refresh')} loading={refreshing}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      <WarSpine
        guildId={guildId}
        war={warWindow}
        counts={{ missing: warMissing, excused: warExcused, logged: warLogged }}
      />

      {isStaff ? (
        <Card className="mb-6">
          <CardBody className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <p className="mono-label text-accent-400">
                Server setup / {setup.configured} of {setup.total} configured
              </p>
              <p className="mt-1.5 text-sm font-semibold text-slate-100">
                {setup.complete
                  ? 'All set. The bot has its staff roles, a subteam and a maze channel.'
                  : `${setup.percent}% set up. The bot is already in the server — finish the rest in Server setup.`}
              </p>
              <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-400">
                Each subteam is one war channel. Captains and the Leader,
                Helper (co-lead) and Staff roles the bot treats as staff are all configured there.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {setup.tasks.map((task) => (
                  <Badge key={task.key} tone={task.configured ? 'green' : 'slate'} dot>
                    {task.label} {task.value}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href={`/dashboard/${guildId}/setup`} className={buttonClass('primary', 'sm')}>
                <ServerCog className="h-3.5 w-3.5" />
                Open server setup
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          </CardBody>
        </Card>
      ) : null}

      {error ? (
        <Alert tone="red" className="mb-6" title="Could not refresh the snapshot">
          {error}
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2">
        <Stat
          label="Plan"
          value={plan.label}
          hint={
            guild.premium_status === 'trial'
              ? `${trialDays} of ${TRIAL_DAYS} trial days left`
              : plan.description
          }
          icon={<CreditCard className="h-4 w-4" />}
          tone={plan.tone}
          footer={
            guild.premium_status === 'trial' ? (
              <ProgressBar value={trialDays} max={TRIAL_DAYS} tone={plan.tone} size="sm" />
            ) : undefined
          }
        />
        <Stat
          label="Next maze discount"
          value={liveMoment ? `${liveMoment.percent} live` : upcoming ? upcoming.percent : '—'}
          hint={
            liveMoment
              ? `Ends ${formatRelative(liveMoment.end, now)}`
              : upcoming
                ? formatRelative(upcoming.start, now)
                : 'No schedule'
          }
          icon={<Map className="h-4 w-4" />}
          tone="purple"
          footer={
            upcomingChunks.length > 1 ? (
              <div className="flex items-center gap-1.5">
                {upcomingChunks.slice(0, 3).map((moment) => (
                  <span
                    key={moment.start.toISOString()}
                    className="rounded-md border border-accent-400/20 bg-accent-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent-300"
                  >
                    {moment.percent}
                  </span>
                ))}
              </div>
            ) : undefined
          }
        />
      </div>

      {loading ? (
        <Spinner label="Loading server data…" />
      ) : (
        <div className="grid gap-5 sm:grid-cols-2">
          <Card>
            <CardHeader
              title="Maze schedule"
              description="Upcoming discount moments in your local time"
              icon={<CalendarClock className="h-4 w-4" />}
              action={
                <Link
                  href={`/dashboard/${guildId}/maze`}
                  className="-my-1 inline-flex items-center gap-1 py-1.5 text-xs font-semibold text-accent-300 transition-colors hover:text-accent-200"
                >
                  Manage <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardBody>
              {mazeEvent && mazeEnd ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={mazeEvent.status === 'confirmed' ? 'green' : 'amber'}>
                      {mazeEvent.status === 'confirmed' ? 'Confirmed' : 'Predicted'}
                    </Badge>
                    <Badge tone={maze && maze.ping_enabled_global ? 'green' : 'slate'}>
                      Pings {maze && maze.ping_enabled_global ? 'on' : 'off'}
                    </Badge>
                    <span className="text-xs text-slate-500">Ends {formatDateTime(mazeEnd)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {moments.map((moment) => {
                      const isNext =
                        liveMoment?.start.getTime() === moment.start.getTime() ||
                        upcoming?.start.getTime() === moment.start.getTime()
                      return (
                        <div
                          key={`${moment.percent}-${moment.start.toISOString()}`}
                          className={`rounded-xl border px-3 py-2.5 ${
                            isNext
                              ? 'border-accent-400/30 bg-accent-500/10'
                              : moment.past
                                ? 'border-white/[0.04] bg-white/[0.01]'
                                : 'border-white/[0.06] bg-white/[0.02]'
                          }`}
                        >
                          <p
                            className={`text-sm font-semibold ${
                              moment.past
                                ? 'text-slate-600'
                                : isNext
                                  ? 'text-accent-200'
                                  : 'text-slate-200'
                            }`}
                          >
                            {moment.percent}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">
                            {moment.past ? 'Passed' : formatDateTime(moment.start)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Map className="h-7 w-7" />}
                  title="No maze on the shared calendar"
                  description="Add the maze week from the in-game calendar, or paste the countdown once the maze appears."
                  action={
                    <Link
                      href={`/dashboard/${guildId}/maze`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-accent-300 hover:text-accent-200"
                    >
                      Open maze settings <ArrowRight className="h-4 w-4" />
                    </Link>
                  }
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Roster & discipline"
              description="Aliases and warnings recorded for this server"
              icon={<Users className="h-4 w-4" />}
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-2.5">
                <Link
                  href={`/dashboard/${guildId}/aliases`}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
                >
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                    <Users className="h-3.5 w-3.5" /> Aliases
                  </p>
                  <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-50">
                    {summary?.aliasCount ?? 0}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent-300">
                    Manage <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </p>
                </Link>
                <Link
                  href={`/dashboard/${guildId}/war`}
                  className="group rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 transition-colors hover:border-white/[0.12] hover:bg-white/[0.04]"
                >
                  <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-slate-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> Warnings
                  </p>
                  <p className="mt-1.5 text-2xl font-bold tracking-tight text-slate-50">
                    {summary?.warningCount ?? 0}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-accent-300">
                    Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </p>
                </Link>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm">
                {guild.is_blacklisted ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-danger-300" />
                    <span className="text-danger-300">This server is blacklisted.</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 text-sage-400" />
                    <span className="text-slate-400">
                      Plan: <span className="font-semibold text-slate-200">{plan.label}</span>
                    </span>
                  </>
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <Target className="h-3.5 w-3.5" /> Guild ID <span className="font-mono">{guildId}</span>
        </span>
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Times shown in your local timezone
        </span>
      </div>
    </div>
  )
}
