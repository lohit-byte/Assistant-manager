'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarClock,
  Clock3,
  Map,
  RefreshCw,
  Save,
  Trash2,
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
  Field,
  PageHeader,
  Spinner,
  TextInput,
  Toggle,
} from '@/components/ui'
import {
  deleteMazeSchedule,
  getMazeSchedule,
  saveMazeSchedule,
} from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { MAZE_SCHEDULES, MAZE_TYPE_META } from '@/lib/constants'
import {
  discountMoments,
  formatDateTime,
  formatRelative,
  fromDateTimeLocal,
  isSnowflake,
  nextDiscount,
  toDate,
  toDateTimeLocal,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { MazeSchedule } from '@/lib/types'

interface Draft {
  event_start: string
  event_end: string
  maze_type: '7d' | '3d'
  channel_id: string
  ping_enabled_global: boolean
}

function defaultDraft(): Draft {
  const start = new Date()
  start.setSeconds(0, 0)
  const end = new Date(start.getTime() + 7 * 24 * 3600_000)
  return {
    event_start: toDateTimeLocal(start),
    event_end: toDateTimeLocal(end),
    maze_type: '7d',
    channel_id: '',
    ping_enabled_global: true,
  }
}

function draftFromRow(row: MazeSchedule | null): Draft {
  if (!row) return defaultDraft()
  const type = row.maze_type === '3d' ? '3d' : '7d'
  const start = toDate(row.event_start)
  const end = toDate(row.event_end)
  return {
    event_start: toDateTimeLocal(start),
    event_end: toDateTimeLocal(end),
    maze_type: type,
    channel_id: row.channel_id ? String(row.channel_id) : '',
    ping_enabled_global: row.ping_enabled_global ?? true,
  }
}

export default function MazePage() {
  const { guildId } = useGuild()
  const now = useNow(30_000)
  const [draft, setDraft] = useState<Draft>(() => defaultDraft())
  const [existing, setExisting] = useState<MazeSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      try {
        const row = await getMazeSchedule(createClient(), guildId)
        setExisting(row)
        setDraft(draftFromRow(row))
      } catch (caught) {
        setFeedback({
          tone: 'red',
          text: caught instanceof Error ? caught.message : 'Could not load the maze schedule.',
        })
      } finally {
        setLoading(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    void load()
  }, [load])

  const start = toDate(fromDateTimeLocal(draft.event_start))
  const end = toDate(fromDateTimeLocal(draft.event_end))
  const meta = MAZE_TYPE_META[draft.maze_type]

  const moments = useMemo(
    () => discountMoments(end, draft.maze_type, MAZE_SCHEDULES[draft.maze_type], now),
    [end, draft.maze_type, now],
  )
  const upcoming = nextDiscount(moments)

  const setStartAndDuration = (value: string) => {
    setDraft((current) => {
      const nextStart = toDate(fromDateTimeLocal(value))
      const nextEnd = nextStart
        ? toDateTimeLocal(new Date(nextStart.getTime() + meta.days * 24 * 3600_000))
        : current.event_end
      return { ...current, event_start: value, event_end: nextEnd }
    })
  }

  const changeType = (type: '7d' | '3d') => {
    setDraft((current) => {
      const currentStart = toDate(fromDateTimeLocal(current.event_start))
      return {
        ...current,
        maze_type: type,
        event_end: currentStart
          ? toDateTimeLocal(
              new Date(currentStart.getTime() + MAZE_TYPE_META[type].days * 24 * 3600_000),
            )
          : current.event_end,
      }
    })
  }

  const save = async () => {
    const isoStart = fromDateTimeLocal(draft.event_start)
    const isoEnd = fromDateTimeLocal(draft.event_end)
    if (!isoStart || !isoEnd) {
      setFeedback({ tone: 'red', text: 'Choose a valid start and end time.' })
      return
    }
    if (new Date(isoEnd).getTime() <= new Date(isoStart).getTime()) {
      setFeedback({ tone: 'red', text: 'The end time must be after the start time.' })
      return
    }
    if (draft.channel_id.trim() && !isSnowflake(draft.channel_id)) {
      setFeedback({ tone: 'red', text: 'Channel ID must be a valid Discord channel ID.' })
      return
    }

    setBusy('save')
    setFeedback(null)
    try {
      await saveMazeSchedule(createClient(), guildId, {
        event_start: isoStart,
        event_end: isoEnd,
        maze_type: draft.maze_type,
        channel_id: draft.channel_id.trim() || null,
        ping_enabled_global: draft.ping_enabled_global,
      })
      setExisting(await getMazeSchedule(createClient(), guildId))
      setFeedback({ tone: 'green', text: 'Maze schedule saved.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not save the maze schedule.',
      })
    } finally {
      setBusy(null)
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete the maze schedule for this server?')) return
    setBusy('delete')
    setFeedback(null)
    try {
      await deleteMazeSchedule(createClient(), guildId)
      setExisting(null)
      setDraft(defaultDraft())
      setFeedback({ tone: 'green', text: 'Maze schedule deleted.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not delete the maze schedule.',
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Maze" description="Schedule and discount timeline." />
        <Spinner label="Loading maze schedule…" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Maze schedule"
        title="Maze"
        description="The bot stores exactly one maze schedule per server. Saving here replaces it; the bot's existing Discord timers are not rescheduled."
        actions={
          <>
            <Button variant="secondary" onClick={() => load('refresh')}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            {existing ? (
              <Button variant="danger" onClick={remove} loading={busy === 'delete'}>
                <Trash2 className="h-4 w-4" />
                Delete
              </Button>
            ) : null}
          </>
        }
      />

      {feedback ? (
        <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      ) : null}

      <Alert tone="amber" className="mb-6" title="Timers already queued in Discord keep their original times">
        This page changes the stored schedule. If the bot already created Discord tasks for the
        previous schedule, use the bot command to cancel or recreate them.
      </Alert>

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader
            title="Schedule"
            description="Maze type, timing and ping channel"
            icon={<Map className="h-5 w-5" />}
          />
          <CardBody className="space-y-5">
            <Field label="Maze type">
              <div className="grid grid-cols-2 gap-2">
                {(['7d', '3d'] as const).map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => changeType(type)}
                    className={`rounded-xl border px-4 py-3 text-left transition-colors ${
                      draft.maze_type === type
                        ? 'border-purple-500/60 bg-purple-500/10'
                        : 'border-slate-700 bg-slate-950/60 hover:border-slate-600'
                    }`}
                  >
                    <p className="text-sm font-semibold text-white">
                      {MAZE_TYPE_META[type].label}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {MAZE_SCHEDULES[type].length} discount moments
                    </p>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Event start" hint="Your local timezone.">
                <TextInput
                  type="datetime-local"
                  value={draft.event_start}
                  onChange={(event) => setStartAndDuration(event.target.value)}
                />
              </Field>
              <Field label="Event end" hint={`Suggested: start + ${meta.days} days.`}>
                <TextInput
                  type="datetime-local"
                  value={draft.event_end}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, event_end: event.target.value }))
                  }
                />
              </Field>
            </div>

            <Field
              label="Ping channel ID"
              hint="Optional. Leave blank to use the server's configured maze channel."
            >
              <TextInput
                value={draft.channel_id}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, channel_id: event.target.value }))
                }
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
              />
            </Field>

            <div className="border-t border-slate-800 pt-5">
              <Toggle
                checked={draft.ping_enabled_global}
                onChange={(value) =>
                  setDraft((current) => ({ ...current, ping_enabled_global: value }))
                }
                label="Maze pings enabled"
                description="Players can still opt out individually with !maze pings off."
              />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
              {start && end ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-slate-300">
                    <CalendarClock className="h-4 w-4 text-purple-300" />
                    {formatDateTime(start)} → {formatDateTime(end)}
                  </p>
                  <p className="flex items-center gap-2 text-xs text-slate-500">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatRelative(end, now)} · {upcoming ? `${upcoming.percent} next` : 'No upcoming discounts'}
                  </p>
                </div>
              ) : (
                <p className="text-slate-500">Choose a start and end time to preview the timeline.</p>
              )}
            </div>

            <Button onClick={save} loading={busy === 'save'} className="w-full">
              <Save className="h-4 w-4" />
              Save schedule
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Discount timeline"
            description={`${meta.label} · times shown in your local timezone`}
            icon={<CalendarClock className="h-5 w-5" />}
            action={<Badge tone="purple">{MAZE_SCHEDULES[draft.maze_type].length} moments</Badge>}
          />
          <CardBody>
            {moments.length === 0 ? (
              <EmptyState
                icon={<Map className="h-7 w-7" />}
                title="No timeline yet"
                description="Set an end time to generate the discount countdowns."
              />
            ) : (
              <ol className="space-y-2">
                {moments.map((moment, index) => {
                  const isNext =
                    upcoming !== null && moment.at.getTime() === upcoming.at.getTime()
                  return (
                    <li
                      key={`${moment.percent}-${index}`}
                      className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${
                        isNext
                          ? 'border-purple-500/50 bg-purple-500/10'
                          : moment.past
                            ? 'border-slate-800/70 bg-slate-950/40'
                            : 'border-slate-800 bg-slate-950/60'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <span
                          className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${
                            isNext
                              ? 'bg-purple-500 text-white'
                              : moment.past
                                ? 'bg-slate-800 text-slate-500'
                                : 'bg-slate-800 text-slate-300'
                          }`}
                        >
                          {index + 1}
                        </span>
                        <div>
                          <p
                            className={`text-sm font-semibold ${
                              isNext
                                ? 'text-purple-200'
                                : moment.past
                                  ? 'text-slate-500'
                                  : 'text-slate-200'
                            }`}
                          >
                            {moment.percent} discount
                          </p>
                          <p className="text-xs text-slate-500">{formatDateTime(moment.at)}</p>
                        </div>
                      </div>
                      <span
                        className={`text-xs ${
                          isNext
                            ? 'font-semibold text-purple-300'
                            : moment.past
                              ? 'text-slate-600'
                              : 'text-slate-400'
                        }`}
                      >
                        {moment.past ? 'Passed' : formatRelative(moment.at, now)}
                      </span>
                    </li>
                  )
                })}
              </ol>
            )}
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
