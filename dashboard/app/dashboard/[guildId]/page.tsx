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
import {
  MAZE_SCHEDULES,
  NODES_PER_LAP,
  PLAN_META,
} from '@/lib/constants'
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

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Plan"
          value={plan.label}
          hint={
            guild.premium_status === 'trial'
              ? `${trialDays} ${trialDays === 1 ? 'day' : 'days'} remaining`
              : plan.description
          }
          icon={<CreditCard className="h-4 w-4" />}
          tone={plan.tone}
        />
        <Stat
          label="War"
          value={warWindow.active ? warPhaseLabel(warWindow.phase) : 'Idle'}
          hint={
            warWindow.active && warWindow.warEnd // <--- CHANGED THIS
              ? formatRelative(warWindow.warEnd, now)
              : 'No active war'
          }
          icon={<Swords className="h-4 w-4" />}
          tone={warWindow.active ? 'amber' : 'slate'}
        />
        <Stat
          label="Race"
          value={`Lap ${raceLap}.${raceNode}`}
          hint={raceTarget > 0 ? `Target ${raceTarget} laps` : 'No target set'}
          icon={<Trophy className="h-4 w-4" />}
          tone="green"
        />
        <Stat
          label="Next maze discount"
          value={upcoming ? upcoming.percent : '—'}
          hint={upcoming ? formatRelative(upcoming.at, now) : 'No schedule'}
          icon={<Map className="h-4 w-4" />}
          tone="purple"
        />
      </div>

      {loading ? (
        <Spinner label="Loading server data…" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader
              title="War"
              description="Phase timer and attendance"
              icon={<Swords className="h-5 w-5" />}
              action={
                <Link href={`/dashboard/${guildId}/war`} className="text-xs font-semibold text-purple-300 hover:text-purple-200">
                  Manage →
                </Link>
              }
            />
            <CardBody className="space-y-5">
              {summary?.war ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={warWindow.active ? (warWindow.phase === 'attack' ? 'red' : 'blue') : 'slate'} dot>
                      {warWindow.active ? warPhaseLabel(warWindow.phase) : 'Inactive'}
                    </Badge>
                    {warWindow.end ? (
                      <span className="text-xs text-slate-500">
                        Ends {formatDateTime(warWindow.end)}
                      </span>
                    ) : null}
                  </div>

                  {warWindow.active && warWindow.start && warWindow.end ? (
                    <div>
                      <ProgressBar
                        value={
                          now.getTime() -
                          (warWindow.phase === 'attack'
                            ? warWindow.start.getTime() + 24 * 3600_000
                            : warWindow.start.getTime())
                        }
                        max={
                          warWindow.end.getTime() -
                          (warWindow.phase === 'attack'
                            ? warWindow.start.getTime() + 24 * 3600_000
                            : warWindow.start.getTime())
                        }
                        tone="amber"
                        label="Phase elapsed"
                      />
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                        <Clock className="h-3.5 w-3.5" />
                        {formatDuration(warWindow.end.getTime() - now.getTime())} remaining
                      </p>
                    </div>
                  ) : null}

                  <div className="grid grid-cols-3 gap-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Missing</p>
                      <p className="mt-1 text-lg font-bold text-amber-300">{warMissing}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Excused</p>
                      <p className="mt-1 text-lg font-bold text-sky-300">{warExcused}</p>
                    </div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                      <p className="text-xs text-slate-500">Logged</p>
                      <p className="mt-1 text-lg font-bold text-white">
                        {Object.keys(summary.war.attack_counts ?? {}).length}
                      </p>
                    </div>
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
              icon={<Trophy className="h-5 w-5" />}
              action={
                <Link href={`/dashboard/${guildId}/race`} className="text-xs font-semibold text-purple-300 hover:text-purple-200">
                  Manage →
                </Link>
              }
            />
            <CardBody className="space-y-5">
              {race ? (
                <>
                  <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-slate-500">Progress</p>
                      <p className="mt-0.5 text-lg font-bold text-white">
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

                  <div>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
                      Tasks
                    </p>
                    <p className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm text-slate-300">
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
                      JE {race.je_done ? 'done' : `${race.je_progress ?? '0'}/${race.je_target ?? '0'}`}
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
              icon={<CalendarClock className="h-5 w-5" />}
              action={
                <Link href={`/dashboard/${guildId}/maze`} className="text-xs font-semibold text-purple-300 hover:text-purple-200">
                  Manage →
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
                  <div className="space-y-2">
                    {moments.slice(0, 4).map((moment) => (
                      <div
                        key={`${moment.percent}-${moment.at.toISOString()}`}
                        className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-sm"
                      >
                        <span className={moment.past ? 'text-slate-500' : 'font-semibold text-purple-300'}>
                          {moment.percent} discount
                        </span>
                        <span className={moment.past ? 'text-xs text-slate-600' : 'text-xs text-slate-400'}>
                          {moment.past ? 'Passed' : formatDateTime(moment.at)}
                        </span>
                      </div>
                    ))}
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
                      className="inline-flex items-center gap-1 text-sm font-semibold text-purple-300 hover:text-purple-200"
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
              icon={<Users className="h-5 w-5" />}
            />
            <CardBody className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Users className="h-3.5 w-3.5" /> Aliases
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{summary?.aliasCount ?? 0}</p>
                  <Link
                    href={`/dashboard/${guildId}/aliases`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-purple-300 hover:text-purple-200"
                  >
                    Manage aliases <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-4">
                  <p className="flex items-center gap-1.5 text-xs text-slate-500">
                    <AlertTriangle className="h-3.5 w-3.5" /> Warnings
                  </p>
                  <p className="mt-1 text-2xl font-bold text-white">{summary?.warningCount ?? 0}</p>
                  <Link
                    href={`/dashboard/${guildId}/war`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-purple-300 hover:text-purple-200"
                  >
                    Open warnings <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              </div>

              <div className="flex items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
                {guild.is_blacklisted ? (
                  <>
                    <ShieldCheck className="h-4 w-4 text-red-300" />
                    <span className="text-red-300">This server is blacklisted.</span>
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

      <div className="mt-6 flex flex-wrap gap-3 text-xs text-slate-600">
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
