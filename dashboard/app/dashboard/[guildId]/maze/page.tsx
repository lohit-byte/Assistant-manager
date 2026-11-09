'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarClock, Clock3, Map, RefreshCw, Save, Trash2 } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { StaffOnlyPanel } from '@/components/staff-only'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, PageHeader, Select, Spinner, TextInput, Toggle
} from '@/components/ui'
import { deleteMazeSchedule, getMazeSchedule, saveMazeSchedule } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { MAZE_SCHEDULES, MAZE_TYPE_META } from '@/lib/constants'
import { discountMoments, formatDateTime, formatRelative, fromDateTimeLocal, isSnowflake, nextDiscount, toDate, toDateTimeLocal } from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { MazePingMention, MazeSchedule } from '@/lib/types'

/** Who the bot mentions on automatic maze discount pings. */
const PING_MENTIONS: Array<{ value: MazePingMention; label: string }> = [
  { value: 'here', label: '@here' },
  { value: 'everyone', label: '@everyone' },
  { value: 'role', label: 'A role' },
  { value: 'none', label: 'No mention' },
]

interface Draft {
  event_start: string
  event_end: string
  maze_type: '7d' | '3d'
  channel_id: string
  ping_enabled_global: boolean
  ping_mention: MazePingMention
  ping_role_id: string
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
    ping_mention: 'here',
    ping_role_id: '',
  }
}

function draftFromRow(row: MazeSchedule | null): Draft {
  if (!row) return defaultDraft()
  const type = row.maze_type === '3d' ? '3d' : '7d'
  const start = toDate(row.event_start)
  const end = toDate(row.event_end)
  const mention: MazePingMention =
    row.ping_mention === 'everyone' || row.ping_mention === 'role' || row.ping_mention === 'none'
      ? row.ping_mention
      : 'here'
  return {
    event_start: toDateTimeLocal(start),
    event_end: toDateTimeLocal(end),
    maze_type: type,
    channel_id: row.channel_id ? String(row.channel_id) : '',
    ping_enabled_global: row.ping_enabled_global ?? true,
    ping_mention: mention,
    ping_role_id: row.ping_role_id ? String(row.ping_role_id) : '',
  }
}

export default function MazePage() {
  const { guildId, isStaff, readOnly } = useGuild()
  const now = useNow(30_000)
  const [draft, setDraft] = useState<Draft>(() => defaultDraft())
  const [existing, setExisting] = useState<MazeSchedule | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null)

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    try {
      const row = await getMazeSchedule(createClient(), guildId)
      setExisting(row)
      setDraft(draftFromRow(row))
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not load maze.' })
    } finally { setLoading(false) }
  }, [guildId])

  useEffect(() => { void load() }, [load])

  const start = toDate(fromDateTimeLocal(draft.event_start))
  const end = toDate(fromDateTimeLocal(draft.event_end))
  const meta = MAZE_TYPE_META[draft.maze_type]

  const moments = useMemo(() => discountMoments(end, draft.maze_type, MAZE_SCHEDULES[draft.maze_type], now), [end, draft.maze_type, now])
  const upcoming = nextDiscount(moments)

  const setStartAndDuration = (value: string) => {
    setDraft((current) => {
      const nextStart = toDate(fromDateTimeLocal(value))
      const nextEnd = nextStart ? toDateTimeLocal(new Date(nextStart.getTime() + meta.days * 24 * 3600_000)) : current.event_end
      return { ...current, event_start: value, event_end: nextEnd }
    })
  }

  const changeType = (type: '7d' | '3d') => {
    setDraft((current) => {
      const currentStart = toDate(fromDateTimeLocal(current.event_start))
      return {
        ...current, maze_type: type,
        event_end: currentStart ? toDateTimeLocal(new Date(currentStart.getTime() + MAZE_TYPE_META[type].days * 24 * 3600_000)) : current.event_end,
      }
    })
  }

  const save = async () => {
    const isoStart = fromDateTimeLocal(draft.event_start)
    const isoEnd = fromDateTimeLocal(draft.event_end)
    if (!isoStart || !isoEnd) return setFeedback({ tone: 'red', text: 'Choose a valid start and end time.' })

    const roleId = draft.ping_role_id.trim()
    if (draft.ping_mention === 'role' && !isSnowflake(roleId)) {
      return setFeedback({ tone: 'red', text: 'Enter a valid Discord role ID (17–20 digits) for the role ping.' })
    }
    
    setBusy('save'); setFeedback(null)
    try {
      await saveMazeSchedule(createClient(), guildId, {
        event_start: isoStart, event_end: isoEnd, maze_type: draft.maze_type,
        channel_id: draft.channel_id.trim() || null, ping_enabled_global: draft.ping_enabled_global,
        ping_mention: draft.ping_mention,
        ping_role_id: draft.ping_mention === 'role' ? roleId : null,
      })
      setExisting(await getMazeSchedule(createClient(), guildId))
      setFeedback({ tone: 'green', text: 'Maze schedule saved.' })
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not save maze schedule.' })
    } finally { setBusy(null) }
  }

  const remove = async () => {
    if (!window.confirm('Delete the maze schedule for this server?')) return
    setBusy('delete'); setFeedback(null)
    try {
      await deleteMazeSchedule(createClient(), guildId)
      setExisting(null); setDraft(defaultDraft())
      setFeedback({ tone: 'green', text: 'Maze schedule deleted.' })
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not delete maze schedule.' })
    } finally { setBusy(null) }
  }

  // Maze is guild-level: staff manage it and read-only alias members may still view it, but
  // a team captain never gets maze access (it is not their team's channel).
  if (!isStaff && !readOnly) return <StaffOnlyPanel area="Maze scheduling" />

  if (loading) return <div><PageHeader title="Maze" /><Spinner label="Loading…" /></div>

  return (
    <div>
      <PageHeader
        eyebrow="Maze schedule"
        title="Maze"
        description="Schedule the maze so the bot can auto-ping discounts."
        actions={
          <>
            <Button variant="secondary" onClick={() => load('refresh')}><RefreshCw className="h-4 w-4" /> Refresh</Button>
            {!readOnly && existing && <Button variant="danger" onClick={remove} loading={busy === 'delete'}><Trash2 className="h-4 w-4" /> Delete</Button>}
          </>
        }
      />

      {feedback && <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>{feedback.text}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[0.95fr_1.05fr]">
        <Card>
          <CardHeader title="Schedule" description={readOnly ? 'View only — staff manage this schedule.' : 'Maze type, timing and ping channel'} icon={<Map className="h-5 w-5" />} />
          <CardBody className="space-y-5">
            <Field label="Maze type">
              <div className="grid grid-cols-2 gap-2">
                {(['7d', '3d'] as const).map((type) => (
                  <button key={type} type="button" disabled={readOnly} onClick={() => changeType(type)} className={`rounded-xl border px-4 py-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${draft.maze_type === type ? 'border-accent-500/60 bg-accent-500/10' : 'border-slate-700 bg-slate-950/60 hover:border-slate-600'}`}>
                    <p className="text-sm font-semibold text-slate-50">{MAZE_TYPE_META[type].label}</p>
                  </button>
                ))}
              </div>
            </Field>

            <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
              <Field label="Event start" hint="Your local timezone." className="min-w-0">
                <TextInput className="w-full min-w-0 appearance-none" type="datetime-local" value={draft.event_start} disabled={readOnly} onChange={(event) => setStartAndDuration(event.target.value)} />
              </Field>
              <Field label="Event end" hint={`Suggested: start + ${meta.days} days.`} className="min-w-0">
                <TextInput className="w-full min-w-0 appearance-none" type="datetime-local" value={draft.event_end} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, event_end: event.target.value }))} />
              </Field>
            </div>

            {/* QUICK SET BUTTONS */}
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" disabled={readOnly} onClick={() => setStartAndDuration(toDateTimeLocal(new Date()))}>Starts Now</Button>
              <Button size="sm" variant="secondary" disabled={readOnly} onClick={() => setStartAndDuration(toDateTimeLocal(new Date(Date.now() + 86400000)))}>Starts Tomorrow</Button>
            </div>

            <Field label="Ping channel ID" hint="Optional.">
              <TextInput value={draft.channel_id} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, channel_id: event.target.value }))} placeholder="e.g. 123456789012345678" inputMode="numeric" />
            </Field>

            <Field label="Ping mention" hint="Who the automatic maze discount pings mention.">
              <Select value={draft.ping_mention} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, ping_mention: event.target.value as MazePingMention }))}>
                {PING_MENTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
            </Field>

            {draft.ping_mention === 'role' ? (
              <Field label="Ping role ID" hint="Right-click the role in Discord → Copy ID.">
                <TextInput value={draft.ping_role_id} disabled={readOnly} onChange={(event) => setDraft((current) => ({ ...current, ping_role_id: event.target.value }))} placeholder="e.g. 123456789012345678" inputMode="numeric" />
              </Field>
            ) : null}

            <div className="border-t border-slate-800 pt-5">
              <Toggle checked={draft.ping_enabled_global} disabled={readOnly} onChange={(value) => setDraft((current) => ({ ...current, ping_enabled_global: value }))} label="Maze pings enabled" description="Players can still opt out individually." />
            </div>

            <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3 text-sm">
              {start && end ? (
                <div className="space-y-1">
                  <p className="flex items-center gap-2 text-slate-300"><CalendarClock className="h-4 w-4 text-accent-300" /> {formatDateTime(start)} → {formatDateTime(end)}</p>
                  <p className="flex items-center gap-2 text-xs text-slate-500"><Clock3 className="h-3.5 w-3.5" /> {formatRelative(end, now)} · {upcoming ? `${upcoming.percent} next` : 'No upcoming discounts'}</p>
                </div>
              ) : <p className="text-slate-500">Choose a start and end time to preview.</p>}
            </div>

            {readOnly ? null : (
              <Button onClick={save} loading={busy === 'save'} className="w-full"><Save className="h-4 w-4" /> Save schedule</Button>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Discount timeline" description={`${meta.label} · times in your local timezone`} icon={<CalendarClock className="h-5 w-5" />} />
          <CardBody>
            {moments.length === 0 ? (
              <EmptyState icon={<Map className="h-7 w-7" />} title="No timeline yet" description="Set an end time to generate the discount countdowns." />
            ) : (
              <ol className="space-y-2">
                {moments.map((moment, index) => {
                  const isNext = upcoming !== null && moment.at.getTime() === upcoming.at.getTime()
                  return (
                    <li key={`${moment.percent}-${index}`} className={`flex items-center justify-between gap-3 rounded-xl border px-4 py-3 ${isNext ? 'border-accent-500/50 bg-accent-500/10' : moment.past ? 'border-slate-800/70 bg-slate-950/40' : 'border-slate-800 bg-slate-950/60'}`}>
                      <div className="flex items-center gap-3">
                        <span className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold ${isNext ? 'bg-accent-500 text-ink-950' : moment.past ? 'bg-slate-800 text-slate-500' : 'bg-slate-800 text-slate-300'}`}>{index + 1}</span>
                        <div>
                          <p className={`text-sm font-semibold ${isNext ? 'text-accent-200' : moment.past ? 'text-slate-500' : 'text-slate-200'}`}>{moment.percent} discount</p>
                          <p className="text-xs text-slate-500">{formatDateTime(moment.at)}</p>
                        </div>
                      </div>
                      <span className={`text-xs ${isNext ? 'font-semibold text-accent-300' : moment.past ? 'text-slate-600' : 'text-slate-400'}`}>{moment.past ? 'Passed' : formatRelative(moment.at, now)}</span>
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
