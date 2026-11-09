'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  ArrowRight,
  CalendarClock,
  Clock,
  CreditCard,
  Map,
  RefreshCw,
  Swords,
  Trophy,
  Users,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { TeamSetup } from '@/components/team-setup'
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
  type Tone,
} from '@/components/ui'
import {
  getMazeSchedule,
  getTeamsOverview,
  type TeamSnapshot,
  type TeamsOverview,
} from '@/lib/data'
import { computeRatings, type RatingRow } from '@/lib/rating'
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
import type { MazeSchedule, TeamCaptain } from '@/lib/types'

function gradeTone(grade: string): Tone {
  switch (grade) {
    case 'A+':
    case 'A':
      return 'green'
    case 'B':
      return 'blue'
    case 'C':
      return 'amber'
    default:
      return 'red'
  }
}

function formatAgo(value: string | null | undefined, now: Date): string {
  const date = toDate(value)
  if (!date) return '—'
  const diff = now.getTime() - date.getTime()
  if (diff < 60_000) return 'just now'
  return `${formatDuration(diff)} ago`
}

function Metric({
  label,
  value,
  tone = 'text-slate-50',
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

function TeamCard({
  snapshot,
  ratings,
  now,
  guildId,
  canManageChannel,
}: {
  snapshot: TeamSnapshot
  ratings: RatingRow[]
  now: Date
  guildId: string
  canManageChannel: (channelId: string | null | undefined) => boolean
}) {
  const { team, war, race, warLogs } = snapshot
  const warWindow = getWarWindow(war)
  const missing = war?.missing_list?.length ?? 0
  const excused = war?.absent_list?.length ?? 0
  const attacksLogged = warLogs.reduce(
    (total, log) => total + Math.max(0, Number(log.attacks) || 0),
    0,
  )
  const lastAttack = warLogs[0]?.created_at ?? null
  const ranked = ratings.filter((row) => !row.excused)
  const excusedRows = ratings.filter((row) => row.excused)
  const warHref = team.war_channel_id
    ? `/dashboard/${guildId}/war?channel=${team.war_channel_id}`
    : null
  const raceHref = team.race_channel_id
    ? `/dashboard/${guildId}/race?channel=${team.race_channel_id}`
    : null

  const halfDescription = [
    team.war_channel_id ? 'War channel linked' : 'No war channel',
    team.race_channel_id ? 'Race channel linked' : 'No race channel',
  ].join(' · ')

  return (
    <Card>
      <CardHeader
        title={team.name}
        description={halfDescription}
        icon={<Users className="h-4 w-4" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {warHref ? (
              <Link href={warHref} className={buttonClass('secondary', 'sm')}>
                {canManageChannel(String(team.war_channel_id)) ? 'Manage war' : 'War'}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
            {raceHref ? (
              <Link href={raceHref} className={buttonClass('secondary', 'sm')}>
                {canManageChannel(String(team.race_channel_id)) ? 'Manage race' : 'Race'}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            ) : null}
          </div>
        }
      />
      <CardBody className="space-y-5">
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="mono-label text-slate-500">War</p>
            {!team.war_channel_id ? (
              <p className="mt-2 text-sm text-slate-500">
                No war channel linked. A staff member can add one in Setup.
              </p>
            ) : !war ? (
              <p className="mt-2 text-sm text-slate-500">
                No war data yet. Start one in Discord with{' '}
                <span className="font-mono text-slate-300">!war defence ends 24h</span>.
              </p>
            ) : (
              <div className="mt-2 space-y-3">
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
                  {warWindow.warEnd ? (
                    <span className="text-xs text-slate-500">
                      War ends {formatRelative(warWindow.warEnd, now)}
                    </span>
                  ) : null}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Metric label="Missing" value={missing} tone="text-warn-300" />
                  <Metric label="Excused" value={excused} tone="text-steel-400" />
                  <Metric label="Attacks logged" value={attacksLogged} />
                  <Metric label="Last attack" value={formatAgo(lastAttack, now)} />
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
            <p className="mono-label text-slate-500">Race</p>
            {!team.race_channel_id ? (
              <p className="mt-2 text-sm text-slate-500">
                No race channel linked. A staff member can add one in Setup.
              </p>
            ) : !race ? (
              <p className="mt-2 text-sm text-slate-500">
                No race data yet. Advance a node in Discord with{' '}
                <span className="font-mono text-slate-300">!race newnode</span>.
              </p>
            ) : (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-lg font-semibold tracking-tight text-slate-50">
                    Lap {race.current_lap ?? 0}.{race.current_node ?? 0}
                  </span>
                  <span className="text-xs text-slate-500">/ {NODES_PER_LAP} nodes</span>
                  {(race.target_laps ?? 0) > 0 ? (
                    <Badge tone="green">
                      {race.current_lap ?? 0}/{race.target_laps} laps
                    </Badge>
                  ) : null}
                </div>
                <p className="truncate text-sm text-slate-300" title={race.task_description ?? ''}>
                  {race.task_description || 'No active node'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Badge tone={race.ofa_done ? 'green' : race.ofa_holder_id ? 'amber' : 'slate'}>
                    OFA {race.ofa_done ? 'done' : race.ofa_holder_id ? 'claimed' : 'open'}
                  </Badge>
                  <Badge tone={race.je_done ? 'green' : 'slate'}>
                    JE {race.je_done ? 'done' : `${race.je_progress ?? '0'}/${race.je_target ?? '0'}`}
                  </Badge>
                  <Badge tone="slate">
                    DYP {race.dyp_progress ?? 0}/{race.dyp_target ?? 0}
                  </Badge>
                </div>
              </div>
            )}
          </div>
        </div>

        <div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="mono-label text-slate-500">Activity rating</p>
            <span className="text-[11px] text-slate-600">
              {team.war_channel_id && team.race_channel_id
                ? 'War 60% / Race 40%'
                : team.war_channel_id
                  ? 'War only'
                  : team.race_channel_id
                    ? 'Race only'
                    : 'No channels'}
            </span>
          </div>

          {ratings.length === 0 ? (
            <p className="mt-2 text-sm text-slate-500">
              No activity recorded yet. Attack counts and race tasks appear here after the bot
              logs them.
            </p>
          ) : (
            <>
              <table className="mt-2 w-full text-left text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                    <th className="px-2 py-1.5 font-medium">#</th>
                    <th className="px-2 py-1.5 font-medium">Player</th>
                    <th className="px-2 py-1.5 font-medium">Score</th>
                    <th className="px-2 py-1.5 text-right font-medium">War</th>
                    <th className="px-2 py-1.5 text-right font-medium">Race</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/[0.06]">
                  {ranked.slice(0, 5).map((row, index) => (
                    <tr key={row.alias}>
                      <td className="px-2 py-1.5 font-mono text-xs text-slate-600">{index + 1}</td>
                      <td className="px-2 py-1.5 text-slate-200">{row.alias}</td>
                      <td className="px-2 py-1.5">
                        <span className="font-semibold text-slate-100">{row.score}</span>{' '}
                        <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-400">
                        {team.war_channel_id ? `${row.attacks}/${row.required}` : '—'}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-xs text-slate-400">
                        {team.race_channel_id ? row.raceTasks : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {excusedRows.length > 0 ? (
                <div className="mt-3">
                  <p className="mono-label text-steel-400">Excused ({excusedRows.length})</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {excusedRows.map((row) => (
                      <Badge key={row.alias} tone="blue">
                        {row.alias} · {row.raceTasks} race
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1.5 text-[11px] text-slate-600">
                    Excused players are not ranked and do not receive a grade.
                  </p>
                </div>
              ) : null}

              {ranked.length > 5 ? (
                <p className="mt-2 text-[11px] text-slate-600">
                  Showing the top 5 of {ranked.length}. Open the War page for per-player detail.
                </p>
              ) : null}
            </>
          )}
        </div>
      </CardBody>
    </Card>
  )
}

export default function OverviewPage() {
  const { guildId, guild, isStaff, canManageChannel, refresh } = useGuild()
  const now = useNow(15000)
  const [overview, setOverview] = useState<TeamsOverview | null>(null)
  const [maze, setMaze] = useState<MazeSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      setError(null)

      try {
        const supabase = createClient()
        const [nextOverview, nextMaze] = await Promise.all([
          getTeamsOverview(supabase, guildId),
          getMazeSchedule(supabase, guildId).catch(() => null),
        ])
        setOverview(nextOverview)
        setMaze(nextMaze)
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

  const handleChanged = useCallback(async () => {
    await refresh()
    await load('refresh')
  }, [load, refresh])

  const plan = PLAN_META[guild.premium_status ?? ''] ?? PLAN_META.expired
  const trialDays = useMemo(() => {
    const end = toDate(guild.trial_ends_at)
    if (!end) return 0
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86_400_000))
  }, [guild.trial_ends_at, now])

  const mazeType = (maze?.maze_type === '3d' ? '3d' : '7d') as '7d' | '3d'
  const mazeEnd = toDate(maze?.event_end)
  const upcoming = useMemo(() => {
    const moments = discountMoments(mazeEnd, mazeType, MAZE_SCHEDULES[mazeType], now)
    return nextDiscount(moments)
  }, [mazeEnd, mazeType, now])
  const upcomingChunks = useMemo(() => {
    const moments = discountMoments(mazeEnd, mazeType, MAZE_SCHEDULES[mazeType], now)
    return moments.filter((moment) => !moment.past).slice(0, 3)
  }, [mazeEnd, mazeType, now])

  const captainsByTeam = useMemo<Record<number, TeamCaptain[]>>(() => {
    const map: Record<number, TeamCaptain[]> = {}
    for (const snapshot of overview?.teams ?? []) map[snapshot.team.id] = snapshot.captains
    return map
  }, [overview])

  const teamCards = useMemo(() => {
    if (!overview) return []
    return overview.teams.map((snapshot) => {
      const windowStart =
        snapshot.war?.war_start ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
      return {
        snapshot,
        ratings: computeRatings({
          war: snapshot.war,
          warSettings: overview.warSettings,
          raceLogs: snapshot.raceLogs,
          aliases: overview.aliases,
          windowStart,
          warChannelId: snapshot.team.war_channel_id,
          raceChannelId: snapshot.team.race_channel_id,
        }),
      }
    })
  }, [overview])

  return (
    <div>
      <PageHeader
        eyebrow="Overview"
        title="Server overview"
        description="Set up every team in one place and watch its war and race activity. Data is read from the same tables the bot writes."
        actions={
          <Button variant="secondary" onClick={() => load('refresh')} loading={refreshing}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert tone="red" className="mb-6" title="Could not refresh the overview">
          {error}
        </Alert>
      ) : null}

      {isStaff && overview ? (
        <TeamSetup
          guild={guild}
          teams={overview.teams.map((snapshot) => snapshot.team)}
          captainsByTeam={captainsByTeam}
          aliases={overview.aliases}
          detectedWarChannels={overview.detectedWarChannels}
          detectedRaceChannels={overview.detectedRaceChannels}
          onChanged={handleChanged}
        />
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
          value={upcoming ? upcoming.percent : '—'}
          hint={upcoming ? formatRelative(upcoming.at, now) : 'No maze schedule set'}
          icon={<Map className="h-4 w-4" />}
          tone="purple"
          footer={
            upcomingChunks.length > 1 ? (
              <div className="flex items-center gap-1.5">
                {upcomingChunks.map((moment) => (
                  <span
                    key={moment.at.toISOString()}
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
        <Spinner label="Loading teams…" />
      ) : teamCards.length === 0 ? (
        <Card>
          <CardBody>
            <EmptyState
              icon={<Users className="h-7 w-7" />}
              title="No teams yet"
              description={
                isStaff
                  ? 'Add your first team in Setup above. If the bot already tracks war or race channels, they are offered as detected channels.'
                  : 'Staff have not set up any teams for this server yet. The live war and race pages still work.'
              }
              action={
                guild.race_channel_id || guild.war_channel_id ? (
                  <span className="text-xs text-slate-600">
                    Legacy channel settings are being replaced by teams.
                  </span>
                ) : undefined
              }
            />
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-5">
          {teamCards.map(({ snapshot, ratings }) => (
            <TeamCard
              key={snapshot.team.id}
              snapshot={snapshot}
              ratings={ratings}
              now={now}
              guildId={guildId}
              canManageChannel={canManageChannel}
            />
          ))}
        </div>
      )}

      <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-600">
        <span className="flex items-center gap-1.5">
          <Clock className="h-3.5 w-3.5" /> Times shown in your local timezone
        </span>
        <span className="flex items-center gap-1.5">
          <CalendarClock className="h-3.5 w-3.5" /> Next maze start: {maze ? formatDateTime(maze.event_start) : 'Not scheduled'}
        </span>
        <span className="flex items-center gap-1.5">
          <Swords className="h-3.5 w-3.5" /> War and race data refresh from the bot&apos;s tables
        </span>
        <span className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5" /> Rating window: current war, else 7 days
        </span>
      </div>
    </div>
  )
}
