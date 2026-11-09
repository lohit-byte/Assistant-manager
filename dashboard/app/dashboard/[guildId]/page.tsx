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
  ShieldCheck,
  Swords,
  Target,
  Trophy,
  Users,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
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
} from '@/components/ui'
import { getGuildSummary, type GuildSummary } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { MAZE_SCHEDULES, NODES_PER_LAP, PLAN_META, TRIAL_DAYS } from '@/lib/constants'
import {
  discountMoments,
  formatDateTime,
  formatDuration,
  formatRelative,
  getWarWindow,
  nextDiscount,
  toDate,
  warPhaseLabel,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'

function Metric({
  label,
  value,
  tone = 'text-white',
}: {
  label: string
  value: React.ReactNode
  tone?: string
}) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wider text-slate-500">{label}</p>
      <p className={`mt-1 text-base font-semibold tracking-tight ${tone}`}>{value}</p>
    </div>
  )
}

export default function OverviewPage() {
  const { guildId, guild } = useGuild()
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
  const phaseElapsed = useMemo(() => {
    if (!warWindow.active || !warWindow.start || !warWindow.phaseEnd) return null
    const attackStart = warWindow.phase === 'attack' ? warWindow.start.getTime() + 24 * 3600_000 : warWindow.start.getTime()
    return {
      value: now.getTime() - attackStart,
      max: Math.max(1, warWindow.phaseEnd.getTime() - attackStart),
    }
  }, [warWindow, now])

  const race = summary?.race
  const raceLap = race?.current_lap ?? 0
  const raceNode = race?.current_node ?? 0
  const raceTarget = race?.target_laps ?? 0
  const dypProgress = race?.dyp_progress ?? 0
  const dypTarget = race?.dyp_target ?? 0

  const maze = summary?.maze
  const mazeType = (maze?.maze_type === '3d' ? '3d' : '7d') as '7d' | '3d'
  const mazeEnd = toDate(maze?.event_end)
  const moments = useMemo(
    () => discountMoments(mazeEnd, mazeType, MAZE_SCHEDULES[mazeType], now),
    [mazeEnd, mazeType, now],
  )
  const upcoming = nextDiscount(moments)
  const upcomingChunks = useMemo(
    () => moments.filter((moment) => !moment.past).slice(0, 3),
    [moments],
  )

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

      {error ? (
        <Alert tone="red" className="mb-6" title="Could not refresh the snapshot">
          {error}
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
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
          label="War"
          value={warWindow.active ? warPhaseLabel(warWindow.phase) : 'Idle'}
          hint={
            warWindow.active && warWindow.phaseEnd ? formatRelative(warWindow.phaseEnd, now) : 'No active war'
          }
          icon={<Swords className="h-4 w-4" />}
          tone={warWindow.active ? 'amber' : 'slate'}
          footer={
            phaseElapsed ? (
              <ProgressBar value={phaseElapsed.value} max={phaseElapsed.max} tone="amber" size="sm" />
            ) : undefined
          }
        />
        <Stat
          label="Race"
          value={`Lap ${raceLap}.${raceNode}`}
          hint={raceTarget > 0 ? `Target ${raceTarget} laps` : 'No target set'}
          icon={<Trophy className="h-4 w-4" />}
          tone="green"
          footer={
            raceTarget > 0 ? (
              <ProgressBar value={raceLap} max={raceTarget} tone="green" size="sm" />
            ) : undefined
          }
        />
        <Stat
          label="Next maze discount"
          value={upcoming ? upcoming.percent : '—'}
          hint={upcoming ? formatRelative(upcoming.at, now) : 'No schedule'}
          icon={<Map className="h-4 w-4" />}
          tone="purple"
          footer={
            upcomingChunks.length > 1 ? (
              <div className="flex items-center gap-1.5">
                {upcomingChunks.map((moment) => (
                  <span
                    key={moment.at.toISOString()}
                    className="rounded-md border border-indigo-400/20 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-300"
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
        <div className="grid gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="War"
              description="Phase timer and attendance"
              icon={<Swords className="h-4 w-4" />}
              action={
                <Link
                  href={`/dashboard/${guildId}/war`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
                >
                  Manage <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardBody className="space-y-5">
              {summary?.war ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      tone={
                        warWindow.active
                          ? warWindow.phase === 'attack'
                            ? 'red'
                            : 'blue'
                          : 'slate'
                      }
                      dot
                    >
                      {warWindow.active ? warPhaseLabel(warWindow.phase) : 'Inactive'}
                    </Badge>
                    {warWindow.phaseEnd ? (
                      <span className="text-xs text-slate-500">
                        Phase ends {formatDateTime(warWindow.phaseEnd)}
                      </span>
                    ) : null}
                    {warWindow.warEnd ? (
                      <span className="text-xs text-slate-600">
                        · War ends {formatDateTime(warWindow.warEnd)}
                      </span>
                    ) : null}
                  </div>

                  {phaseElapsed ? (
                    <div>
                      <ProgressBar
                        value={phaseElapsed.value}
                        max={phaseElapsed.max}
                        tone="amber"
                        label="Phase elapsed"
                      />
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {warWindow.phaseEnd ? (
                          <span>
                            <span className="font-semibold text-slate-300">
                              {formatDuration(warWindow.phaseEnd.getTime() - now.getTime())}
                            </span>{' '}
                            left in {warPhaseLabel(warWindow.phase).toLowerCase()}
                          </span>
                        ) : (
                          <span>No timer</span>
                        )}
                        {warWindow.warEnd ? (
                          <>
                            <span className="text-slate-700">·</span>
                            <span>
                              war clock{' '}
                              <span className="font-semibold text-slate-300">
                                {formatDuration(warWindow.warEnd.getTime() - now.getTime())}
                              </span>{' '}
                              left (48h → 0h)
                            </span>
                          </>
                        ) : null}
                      </p>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-3 gap-2.5">
                    <Metric label="Missing" value={warMissing} tone="text-amber-300" />
                    <Metric label="Excused" value={warExcused} tone="text-sky-300" />
                    <Metric label="Logged" value={warLogged} />
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<Swords className="h-7 w-7" />}
                  title="No war data yet"
                  description="Start a war in Discord with !war defence ends 24h. Its state will appear here."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Race"
              description="Current node and task progress"
              icon={<Trophy className="h-4 w-4" />}
              action={
                <Link
                  href={`/dashboard/${guildId}/race`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
                >
                  Manage <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardBody className="space-y-5">
              {race ? (
                <>
                  <div className="flex items-center justify-between gap-4 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-wider text-slate-500">
                        Progress
                      </p>
                      <p className="mt-1 text-lg font-semibold tracking-tight text-white">
                        Lap {raceLap}.{raceNode}
                        <span className="ml-2 text-xs font-normal text-slate-500">
                          / {NODES_PER_LAP} nodes
                        </span>
                      </p>
                    </div>
                    <Badge tone={raceTarget > 0 ? 'green' : 'slate'}>
                      {raceTarget > 0 ? `${raceLap}/${raceTarget} laps` : 'No target'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-1.5">
                    {Array.from({ length: NODES_PER_LAP }).map((_, index) => (
                      <span
                        key={index}
                        className={`h-1.5 flex-1 rounded-full ${
                          index < raceNode
                            ? 'bg-gradient-to-r from-emerald-400 to-teal-400'
                            : 'bg-white/[0.07]'
                        }`}
                      />
                    ))}
                  </div>

                  <div>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                      Task
                    </p>
                    <p className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm text-slate-300">
                      {race.task_description || 'No active node'}
                    </p>
                  </div>

                  {dypTarget > 0 ? (
                    <ProgressBar
                      value={dypProgress}
                      max={dypTarget}
                      tone="green"
                      label={`DYP ${dypProgress}/${dypTarget}`}
                    />
                  ) : null}

                  <div className="flex flex-wrap gap-2">
                    <Badge tone={race.ofa_done ? 'green' : race.ofa_holder_id ? 'amber' : 'slate'}>
                      OFA {race.ofa_done ? 'done' : race.ofa_holder_id ? 'claimed' : 'open'}
                    </Badge>
                    <Badge tone={race.je_done ? 'green' : 'slate'}>
                      JE{' '}
                      {race.je_done ? 'done' : `${race.je_progress ?? '0'}/${race.je_target ?? '0'}`}
                    </Badge>
                    <Badge tone="slate">
                      {race.dyp_contributors?.length ?? 0} DYP contributors
                    </Badge>
                  </div>
                </>
              ) : (
                <EmptyState
                  icon={<Trophy className="h-7 w-7" />}
                  title="No race data yet"
                  description="Advance a node in Discord with !race newnode. The current node will show here."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Maze schedule"
              description="Upcoming discount moments in your local time"
              icon={<CalendarClock className="h-4 w-4" />}
              action={
                <Link
                  href={`/dashboard/${guildId}/maze`}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-300 transition-colors hover:text-indigo-200"
                >
                  Manage <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              }
            />
            <CardBody>
              {maze && mazeEnd ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="purple">{mazeType === '3d' ? '3-day' : '7-day'} maze</Badge>
                    <Badge tone={maze.ping_enabled_global ? 'green' : 'slate'}>
                      Pings {maze.ping_enabled_global ? 'on' : 'off'}
                    </Badge>
                    <span className="text-xs text-slate-500">Ends {formatDateTime(mazeEnd)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                    {moments.map((moment) => {
                      const isNext = upcoming?.at.getTime() === moment.at.getTime()
                      return (
                        <div
                          key={`${moment.percent}-${moment.at.toISOString()}`}
                          className={`rounded-xl border px-3 py-2.5 ${
                            isNext
                              ? 'border-indigo-400/30 bg-indigo-500/10'
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
                                  ? 'text-indigo-200'
                                  : 'text-slate-200'
                            }`}
                          >
                            {moment.percent}
                          </p>
                          <p className="mt-0.5 truncate text-[11px] text-slate-500">
                            {moment.past ? 'Passed' : formatDateTime(moment.at)}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ) : (
                <EmptyState
                  icon={<Map className="h-7 w-7" />}
                  title="No maze event scheduled"
                  description="Schedule the next maze in Discord with !maze start 7d <time>, or add it here."
                  action={
                    <Link
                      href={`/dashboard/${guildId}/maze`}
                      className="inline-flex items-center gap-1 text-sm font-semibold text-indigo-300 hover:text-indigo-200"
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
                  <p className="mt-1.5 text-2xl font-bold tracking-tight text-white">
                    {summary?.aliasCount ?? 0}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-300">
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
                  <p className="mt-1.5 text-2xl font-bold tracking-tight text-white">
                    {summary?.warningCount ?? 0}
                  </p>
                  <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-indigo-300">
                    Open <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
                  </p>
                </Link>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm">
                {guild.is_blacklisted ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-rose-300" />
                    <span className="text-rose-300">This server is blacklisted.</span>
                  </>
                ) : (
                  <>
                    <ShieldCheck className="h-4 w-4 text-emerald-300" />
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
