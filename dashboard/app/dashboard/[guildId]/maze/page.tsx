'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  CalendarPlus,
  Check,
  Map,
  RefreshCw,
  Save,
  Trash2,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { StaffOnlyPanel } from '@/components/staff-only'
import { Wheel } from '@/components/wheel-picker'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Spinner,
  TextInput,
  Toggle,
} from '@/components/ui'
import {
  addMazeEvent,
  cancelMazeEvent,
  confirmMazeEvent,
  deleteMazeSchedule,
  getActiveMazeEvent,
  getMazeSchedule,
  listMazeEvents,
  saveMazeSchedule,
} from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { MAZE_DURATION_DAYS, PLATFORM_ADMIN_IDS } from '@/lib/constants'
import { discordIdFromSession } from '@/lib/discord'
import {
  currentMazeMoment,
  formatDateTime,
  formatDuration,
  formatRelative,
  isSnowflake,
  mazeMoments,
  nextMazeMoment,
  toDate,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'
import { useToast } from '@/lib/toast'
import type { MazeMoment } from '@/lib/format'
import type { MazeEvent, MazePingMention, MazeSchedule } from '@/lib/types'

const MENTION_OPTIONS: Array<{ value: MazePingMention; label: string }> = [
  { value: 'here', label: '@here' },
  { value: 'everyone', label: '@everyone' },
  { value: 'role', label: 'A role' },
  { value: 'none', label: 'No mention' },
]

const DAYS_LEFT = Array.from({ length: 8 }, (_, index) => index)
const HOURS = Array.from({ length: 24 }, (_, index) => index)
const MINUTES = Array.from({ length: 60 }, (_, index) => index)
const DAYS_AHEAD = Array.from({ length: 61 }, (_, index) => index)

const STATUS_META: Record<string, { label: string; tone: 'green' | 'amber' }> = {
  confirmed: { label: 'Confirmed in game', tone: 'green' },
  scheduled: { label: 'Predicted from the calendar', tone: 'amber' },
}

/**
 * The maze as the player experiences it: discount spans and the discount-free spans between them.
 * The bot pings at the start of each discount span only.
 */
function DiscountTimeline({ moments }: { moments: MazeMoment[] }) {
  const live = currentMazeMoment(moments)
  const next = nextMazeMoment(moments)

  const rows: Array<
    | { kind: 'discount'; key: string; moment: MazeMoment }
    | { kind: 'gap'; key: string; start: Date; end: Date }
  > = []
  let cursor: Date | null = null
  for (const moment of moments) {
    if (cursor && moment.start.getTime() > cursor.getTime()) {
      rows.push({
        kind: 'gap',
        key: `gap-${cursor.toISOString()}`,
        start: cursor,
        end: moment.start,
      })
    }
    rows.push({ kind: 'discount', key: moment.start.toISOString(), moment })
    cursor = moment.end
  }

  return (
    <div className="space-y-2">
      <ol className="space-y-2">
        {rows.map((row) => {
          if (row.kind === 'gap') {
            return (
              <li
                key={row.key}
                className="flex items-center justify-between gap-3 rounded-xl border border-dashed border-white/[0.05] px-4 py-2.5"
              >
                <p className="text-xs font-medium text-slate-600">No discount</p>
                <span className="shrink-0 text-[11px] text-slate-600">
                  {formatDuration(row.end.getTime() - row.start.getTime())}
                </span>
              </li>
            )
          }
          const { moment } = row
          const isLive = live?.start.getTime() === moment.start.getTime()
          const isNext = next?.start.getTime() === moment.start.getTime()
          return (
            <li
              key={row.key}
              className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                isLive
                  ? 'border-accent-400/40 bg-accent-500/10'
                  : isNext
                    ? 'border-accent-400/20 bg-white/[0.03]'
                    : moment.past
                      ? 'border-white/[0.04] bg-white/[0.01]'
                      : 'border-white/[0.06] bg-white/[0.02]'
              }`}
            >
              <div className="min-w-0">
                <p
                  className={`text-sm font-semibold ${
                    isLive ? 'text-accent-200' : moment.past ? 'text-slate-600' : 'text-slate-200'
                  }`}
                >
                  {moment.percent} off moves
                  {isLive ? (
                    <Badge tone="purple" className="ml-2">
                      live now
                    </Badge>
                  ) : null}
                </p>
                <p className="mt-0.5 truncate text-xs text-slate-500">
                  {formatDateTime(moment.start)} → {formatDateTime(moment.end)}
                </p>
              </div>
              <span
                className={`shrink-0 text-xs ${
                  moment.past ? 'text-slate-600' : isLive ? 'text-accent-300' : 'text-slate-400'
                }`}
              >
                {moment.past
                  ? 'Ended'
                  : isLive
                    ? `Ends ${formatRelative(moment.end)}`
                    : formatRelative(moment.start)}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="text-xs leading-relaxed text-slate-500">
        The maze has four stretches with no discount at all (dashed rows) — the bot is quiet then.
        Times follow the maze start, so every server sees the same ones.
      </p>
    </div>
  )
}

export default function MazePage() {
  const { guildId, isStaff } = useGuild()
  const toast = useToast()
  const now = useNow(30_000)

  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [event, setEvent] = useState<MazeEvent | null>(null)
  const [events, setEvents] = useState<MazeEvent[]>([])
  const [settings, setSettings] = useState<MazeSchedule | null>(null)
  const [discordId, setDiscordId] = useState<string | null>(null)

  const [channelId, setChannelId] = useState('')
  const [enabled, setEnabled] = useState(true)
  const [mention, setMention] = useState<MazePingMention>('here')
  const [roleId, setRoleId] = useState('')

  const [leftDays, setLeftDays] = useState(7)
  const [leftHours, setLeftHours] = useState(0)
  const [leftMinutes, setLeftMinutes] = useState(0)

  const [aheadDays, setAheadDays] = useState(3)
  const [aheadHour, setAheadHour] = useState(16)
  const [aheadMinute, setAheadMinute] = useState(30)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      setError(null)
      const supabase = createClient()
      try {
        const [active, all, row, session] = await Promise.all([
          getActiveMazeEvent(supabase),
          listMazeEvents(supabase),
          getMazeSchedule(supabase, guildId),
          supabase.auth.getSession(),
        ])
        setEvent(active)
        setEvents(all)
        setSettings(row)
        setDiscordId(discordIdFromSession(session.data.session?.user))
        setChannelId(row?.channel_id ? String(row.channel_id) : '')
        setEnabled(row?.ping_enabled_global ?? true)
        setMention(
          row?.ping_mention === 'everyone' ||
            row?.ping_mention === 'role' ||
            row?.ping_mention === 'none'
            ? row.ping_mention
            : 'here',
        )
        setRoleId(row?.ping_role_id ? String(row.ping_role_id) : '')
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : 'Could not load the maze.')
      } finally {
        setLoading(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const isPlatformAdmin = Boolean(discordId && PLATFORM_ADMIN_IDS.includes(discordId))
  const eventStart = toDate(event?.event_start)
  const eventEnd = toDate(event?.event_end)
  const moments = useMemo(() => mazeMoments(eventStart, now), [eventStart, now])

  // "The maze started" is entered as the in-game countdown, because that is what the
  // player can read; the start is the end minus the 7-day length.
  const remainingMinutes = leftDays * 1440 + leftHours * 60 + leftMinutes
  const estimatedEnd = new Date(now.getTime() + remainingMinutes * 60_000)
  const estimatedStart = new Date(
    estimatedEnd.getTime() - MAZE_DURATION_DAYS * 24 * 3600_000,
  )
  const estimatedMoments = mazeMoments(estimatedStart, now)
  const estimatedNext = nextMazeMoment(estimatedMoments)
  const needsCorrection = Boolean(
    event &&
      eventStart &&
      Math.abs(estimatedStart.getTime() - eventStart.getTime()) > 15 * 60_000,
  )

  const calendarStart = useMemo(() => {
    const start = new Date(now)
    start.setDate(start.getDate() + aheadDays)
    start.setHours(aheadHour, aheadMinute, 0, 0)
    return start
  }, [now, aheadDays, aheadHour, aheadMinute])
  const calendarEnd = new Date(calendarStart.getTime() + MAZE_DURATION_DAYS * 24 * 3600_000)

  const saveAlerts = async () => {
    if (channelId.trim() && !isSnowflake(channelId)) {
      setError('The alert channel must be a Discord channel ID (17–20 digits).')
      return
    }
    if (mention === 'role' && roleId.trim() && !isSnowflake(roleId)) {
      setError('The ping role must be a Discord role ID (17–20 digits).')
      return
    }
    setBusy('alerts')
    setError(null)
    try {
      await saveMazeSchedule(createClient(), guildId, {
        channel_id: channelId.trim() || null,
        ping_enabled_global: enabled,
        ping_mention: mention,
        ping_role_id: roleId.trim() || null,
      })
      toast.success('Maze alerts saved.', 'The bot picks the change up within 5 minutes.')
      await load('refresh')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save the maze alerts.')
    } finally {
      setBusy(null)
    }
  }

  const removeAlerts = async () => {
    if (!window.confirm('Turn maze alerts off for this server?')) return
    setBusy('remove')
    setError(null)
    try {
      await deleteMazeSchedule(createClient(), guildId)
      toast.success('Maze alerts are off for this server.')
      await load('refresh')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not turn the alerts off.')
    } finally {
      setBusy(null)
    }
  }

  const confirmStart = async () => {
    if (remainingMinutes <= 0) {
      setError('Set the countdown you see in game, e.g. 6 days 21 hours 47 minutes.')
      return
    }
    if (remainingMinutes > (MAZE_DURATION_DAYS + 1) * 1440) {
      setError('That countdown is longer than a maze event. Check the days and hours.')
      return
    }
    setBusy('confirm')
    setError(null)
    try {
      // Correct the closest existing event within a day instead of adding a second row.
      const nearby = events
        .map((item) => ({ item, start: toDate(item.event_start) }))
        .filter((entry): entry is { item: MazeEvent; start: Date } => entry.start !== null)
        .map((entry) => ({ ...entry, delta: Math.abs(entry.start.getTime() - estimatedStart.getTime()) }))
        .filter((entry) => entry.delta <= 24 * 3600_000)
        .sort((a, b) => a.delta - b.delta)
      const existing = nearby.length ? nearby[0].item : null
      await confirmMazeEvent(createClient(), guildId, discordId, {
        event_start: estimatedStart.toISOString(),
        event_end: estimatedEnd.toISOString(),
        existing,
      })
      toast.success(
        'Shared maze schedule confirmed.',
        'Every server with alerts on has been re-armed.',
      )
      await load('refresh')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not confirm the maze.')
    } finally {
      setBusy(null)
    }
  }

  const addToCalendar = async () => {
    setBusy('calendar')
    setError(null)
    try {
      await addMazeEvent(createClient(), {
        event_start: calendarStart.toISOString(),
        event_end: calendarEnd.toISOString(),
      })
      toast.success('Maze added to the shared calendar.', 'Alerts are armed for it already.')
      await load('refresh')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not add the maze.')
    } finally {
      setBusy(null)
    }
  }

  const removeFromCalendar = async (id: MazeEvent['id']) => {
    if (!window.confirm('Remove this maze from the shared calendar?')) return
    setBusy(`calendar-${id}`)
    setError(null)
    try {
      await cancelMazeEvent(createClient(), id)
      toast.success('Maze removed from the calendar.')
      await load('refresh')
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not remove the maze.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Maze" description="Shared maze event and discount alerts." />
        <Spinner label="Loading maze alerts…" />
      </div>
    )
  }

  if (!isStaff) {
    return (
      <div>
        <PageHeader title="Maze" description="Shared maze event and discount alerts." />
        <StaffOnlyPanel area="Maze alerts" />
      </div>
    )
  }

  const status = event?.status ? STATUS_META[event.status] : null

  return (
    <div>
      <PageHeader
        eyebrow="Maze alerts"
        title="Maze"
        description="One shared maze event drives every server's discount pings. The calendar predicts it; the first staff member who sees the in-game countdown corrects it for everyone."
        actions={
          <Button variant="secondary" onClick={() => load('refresh')}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {error ? (
        <Alert tone="red" className="mb-6" title="That did not work" onDismiss={() => setError(null)}>
          {error}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Shared maze"
              description="What every server's alerts are counting down to"
              icon={<Map className="h-5 w-5" />}
              action={
                status ? <Badge tone={status.tone}>{status.label}</Badge> : undefined
              }
            />
            <CardBody className="space-y-4">
              {event && eventStart && eventEnd ? (
                <>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                    <span className="text-slate-300">
                      {formatDateTime(eventStart)} → {formatDateTime(eventEnd)}
                    </span>
                    {event.confirmed_by_guild ? (
                      <span className="text-xs text-slate-500">
                        confirmed by server {String(event.confirmed_by_guild)}
                      </span>
                    ) : (
                      <span className="text-xs text-slate-500">
                        predicted — nobody has pasted the in-game countdown yet
                      </span>
                    )}
                  </div>
                  <DiscountTimeline moments={moments} />
                </>
              ) : (
                <EmptyState
                  icon={<CalendarClock className="h-7 w-7" />}
                  title="No maze on the shared calendar"
                  description="Add the dates from the in-game monthly calendar below, or paste the countdown once the maze appears. Alerts stay off until there is an event."
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tell the bot the maze started"
              description="Paste the countdown above the maze map — it corrects the shared schedule for every server"
              icon={<Check className="h-5 w-5" />}
            />
            <CardBody className="space-y-5">
              <div className="flex flex-wrap items-start justify-center gap-3 sm:justify-start">
                <Wheel values={DAYS_LEFT} value={leftDays} onChange={setLeftDays} label="days" />
                <Wheel values={HOURS} value={leftHours} onChange={setLeftHours} label="hours" />
                <Wheel
                  values={MINUTES}
                  value={leftMinutes}
                  onChange={setLeftMinutes}
                  label="minutes"
                />
                <div className="min-w-[180px] flex-1 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3 text-sm">
                  <p className="font-semibold text-slate-200">
                    {leftDays}d {leftHours}h {leftMinutes}m left
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Start {formatDateTime(estimatedStart)}
                  </p>
                  <p className="text-xs text-slate-500">Ends {formatDateTime(estimatedEnd)}</p>
                  <p className="mt-1 text-xs text-slate-400">
                    {estimatedNext
                      ? `Next: ${estimatedNext.percent} in ${formatRelative(estimatedNext.start, now)}`
                      : 'No discounts left in this maze'}
                  </p>
                </div>
              </div>
              {needsCorrection ? (
                <Alert tone="amber" title="This corrects the shared schedule">
                  The current event differs from this countdown by more than 15 minutes. Confirming
                  re-times every server's alerts.
                </Alert>
              ) : null}
              <Button onClick={confirmStart} loading={busy === 'confirm'} className="w-full">
                <Check className="h-4 w-4" />
                Confirm for every server
              </Button>
            </CardBody>
          </Card>

          {isPlatformAdmin ? (
            <Card>
              <CardHeader
                title="Platform calendar"
                description="Maze weeks from the in-game monthly calendar; alerts are armed as soon as one is added"
                icon={<CalendarPlus className="h-5 w-5" />}
                action={<Badge tone="purple">Owner</Badge>}
              />
              <CardBody className="space-y-5">
                {events.length ? (
                  <ul className="space-y-2">
                    {events.map((item) => {
                      const start = toDate(item.event_start)
                      const end = toDate(item.event_end)
                      const meta = STATUS_META[item.status]
                      return (
                        <li
                          key={String(item.id)}
                          className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3"
                        >
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-200">
                              {formatDateTime(start)} → {formatDateTime(end)}
                            </p>
                            <p className="text-xs text-slate-500">
                              {meta ? meta.label : item.status}
                              {item.confirmed_by_guild
                                ? ` · server ${String(item.confirmed_by_guild)}`
                                : ''}
                            </p>
                          </div>
                          <Button
                            variant="danger"
                            onClick={() => removeFromCalendar(item.id)}
                            loading={busy === `calendar-${item.id}`}
                          >
                            <Trash2 className="h-4 w-4" />
                            Remove
                          </Button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="text-sm text-slate-500">The calendar is empty.</p>
                )}

                <div className="border-t border-white/[0.06] pt-5">
                  <p className="text-sm font-semibold text-slate-200">Add a maze week</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Starts in {aheadDays} day{aheadDays === 1 ? '' : 's'} at{' '}
                    {String(aheadHour).padStart(2, '0')}:{String(aheadMinute).padStart(2, '0')} —
                    your local time.
                  </p>
                  <div className="mt-3 flex flex-wrap items-start gap-3">
                    <Wheel
                      values={DAYS_AHEAD}
                      value={aheadDays}
                      onChange={setAheadDays}
                      label="days from today"
                    />
                    <Wheel values={HOURS} value={aheadHour} onChange={setAheadHour} label="hour" />
                    <Wheel
                      values={MINUTES}
                      value={aheadMinute}
                      onChange={setAheadMinute}
                      label="minute"
                    />
                  </div>
                  <p className="mt-3 text-xs text-slate-500">
                    {formatDateTime(calendarStart)} → {formatDateTime(calendarEnd)}
                  </p>
                  <Button
                    onClick={addToCalendar}
                    loading={busy === 'calendar'}
                    className="mt-3 w-full"
                  >
                    <CalendarPlus className="h-4 w-4" />
                    Add to calendar
                  </Button>
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader
              title="Alerts for this server"
              description="Where the bot posts discount pings, and who it mentions"
              icon={<CalendarClock className="h-5 w-5" />}
              action={
                <Badge tone={settings?.ping_enabled_global ? 'green' : 'slate'}>
                  {settings ? (settings.ping_enabled_global ? 'On' : 'Off') : 'Not set up'}
                </Badge>
              }
            />
            <CardBody className="space-y-5">
              {!settings ? (
                <Alert tone="amber" title="Alerts are not set up yet">
                  Save a channel below to subscribe this server. The pings then follow the shared
                  maze automatically, including maze weeks added to the calendar.
                </Alert>
              ) : null}

              <Toggle
                checked={enabled}
                onChange={setEnabled}
                label="Maze discount pings"
                description="Pings go out when each discount window opens (50%, 20% and the 10% path discounts)."
              />

              <Field
                label="Alert channel ID"
                hint="Optional: leave blank to use this server's maze channel from Server setup."
              >
                <TextInput
                  value={channelId}
                  onChange={(event) => setChannelId(event.target.value)}
                  placeholder="e.g. 123456789012345678"
                  inputMode="numeric"
                />
              </Field>

              <Field label="Mention">
                <Select
                  value={mention}
                  onChange={(event) => setMention(event.target.value as MazePingMention)}
                >
                  {MENTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
              </Field>

              {mention === 'role' ? (
                <Field label="Role ID" hint="The role the bot pings.">
                  <TextInput
                    value={roleId}
                    onChange={(event) => setRoleId(event.target.value)}
                    placeholder="e.g. 123456789012345678"
                    inputMode="numeric"
                  />
                </Field>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <Button onClick={saveAlerts} loading={busy === 'alerts'} className="flex-1">
                  <Save className="h-4 w-4" />
                  Save alerts
                </Button>
                {settings ? (
                  <Button
                    variant="danger"
                    onClick={removeAlerts}
                    loading={busy === 'remove'}
                  >
                    <Trash2 className="h-4 w-4" />
                    Turn off
                  </Button>
                ) : null}
              </div>
            </CardBody>
          </Card>

        </div>
      </div>
    </div>
  )
}
