'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity, AlertTriangle, ChevronDown, Clock, Plus, RefreshCw, Save, Swords, Trash2, Trophy, Users,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, PageHeader, ProgressBar, Spinner, TextInput, type Tone,
} from '@/components/ui'
import {
  addWarning, deleteWarning, getWar, getWarSettings, listAliases, listRaceLogs, listWarnings,
  listWarLogs, saveWarSettings, saveWarTeamRole, updateWar,
} from '@/lib/data'
import { computeRatings, type RatingRow } from '@/lib/rating'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/toast'
import { DEFAULT_ATTACKS_REQUIRED, MAX_ATTACKS_REQUIRED } from '@/lib/constants'
import {
  formatDateTime, getWarWindow, isSnowflake, warPhaseLabel,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { War, WarLog, WarSettings, Warning, Alias } from '@/lib/types'

type Feedback = { tone: 'green' | 'red'; text: string } | null

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

function sourceLabel(source: string): string {
  switch (source) {
    case 'self':
      return 'Self report'
    case 'staff':
      return 'Staff'
    case 'undo':
      return 'Undo'
    default:
      return source
  }
}

function LiveTimer({ endTime }: { endTime: Date | null }) {
  const [timeLeft, setTimeLeft] = useState<number>(0)
  useEffect(() => {
    if (!endTime) return
    const updateTimer = () => setTimeLeft(Math.max(0, endTime.getTime() - Date.now()))
    updateTimer()
    const interval = setInterval(updateTimer, 1000)
    return () => clearInterval(interval)
  }, [endTime])

  if (!endTime) return null
  const isUrgent = timeLeft < 3600_000 && timeLeft > 0
  const isCritical = timeLeft < 600_000 && timeLeft > 0
  const totalSec = Math.floor(timeLeft / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60

  return (
    <div className={`p-6 rounded-2xl border flex flex-col items-center justify-center transition-colors ${isCritical ? 'bg-danger-500/10 border-danger-500/50 animate-pulse' : isUrgent ? 'bg-warn-500/10 border-warn-500/50' : 'bg-slate-950/60 border-slate-800'}`}>
      <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">Time Remaining</p>
      <p className={`text-5xl font-black font-mono tracking-tighter ${isCritical ? 'text-danger-500' : isUrgent ? 'text-warn-400' : 'text-slate-50'}`}>
        {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </p>
    </div>
  )
}

export default function WarPage() {
  const { guildId, isStaff, teams, canManageChannel } = useGuild()
  const router = useRouter()
  const searchParams = useSearchParams()
  const toast = useToast()

  const channelId = searchParams.get('channel')
  // Staff edit everywhere; a captain only edits the channels of the team they captain.
  const canManage = canManageChannel(channelId)

  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [war, setWar] = useState<War | null>(null)
  const [warLogs, setWarLogs] = useState<WarLog[]>([])
  const [ratings, setRatings] = useState<RatingRow[]>([])
  const now = useNow(15000)

  const [settings, setSettings] = useState<WarSettings>({ guild_id: guildId, attacks_required: DEFAULT_ATTACKS_REQUIRED, exempt_absent: true })
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [missingAlias, setMissingAlias] = useState('')
  const [teamRole, setTeamRole] = useState('')
  const [warningId, setWarningId] = useState('')
  const [warningReason, setWarningReason] = useState('')

  // Load available channels
  useEffect(() => {
    const fetchChannels = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('wars').select('channel_id').eq('guild_id', guildId).eq('is_active', true)
      if (data) {
        const uniqueIds = Array.from(new Set(data.map(d => String(d.channel_id))))
        setAvailableChannels(uniqueIds)
        if (!channelId && uniqueIds.length > 0) router.replace(`?channel=${uniqueIds[0]}`)
      }
      setLoading(false)
    }
    fetchChannels()
  }, [guildId, channelId, router])

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      const supabase = createClient()
      try {
        // Fetch Global Settings, Warnings, and Aliases
        const [nextSettings, nextWarnings, nextAliases] = await Promise.all([
          getWarSettings(supabase, guildId),
          listWarnings(supabase, guildId),
          listAliases(supabase, guildId),
        ])
        setSettings(nextSettings)
        setWarnings(nextWarnings)
        setAliases(nextAliases)

        // Fetch Channel-specific War Data
        if (channelId) {
          const nextWar = await getWar(supabase, channelId)
          setWar(nextWar)
          if (nextWar) {
            setCounts(Object.fromEntries(Object.entries(nextWar.attack_counts ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)])))
            setTeamRole(nextWar.team_role_id ? String(nextWar.team_role_id) : '')
          }

          // The team that owns this war channel links it to the race channel used for the rating.
          const team = teams.find((item) => String(item.war_channel_id) === channelId) ?? null
          const raceChannelId =
            team?.race_channel_id !== null && team?.race_channel_id !== undefined
              ? String(team.race_channel_id)
              : null
          // Only an active war narrows the race window; otherwise rating uses the last 7 days.
          const windowStart = nextWar?.is_active
            ? nextWar.war_start ?? new Date(Date.now() - 7 * 86_400_000).toISOString()
            : new Date(Date.now() - 7 * 86_400_000).toISOString()

          const [nextWarLogs, nextRaceLogs] = await Promise.all([
            listWarLogs(supabase, channelId, nextWar?.war_start ?? null, 25).catch(() => []),
            raceChannelId
              ? listRaceLogs(supabase, guildId, raceChannelId, windowStart).catch(() => [])
              : Promise.resolve([]),
          ])
          setWarLogs(nextWarLogs)
          setRatings(
            computeRatings({
              war: nextWar,
              warSettings: nextSettings,
              raceLogs: nextRaceLogs,
              aliases: nextAliases,
              warChannelId: channelId,
              raceChannelId,
            }),
          )
        } else {
          setWarLogs([])
          setRatings([])
        }
      } catch (caught) {
        setFeedback({ tone: 'red', text: 'Could not load war data.' })
      } finally {
        setLoading(false)
      }
    },
    [guildId, channelId, teams],
  )

  useEffect(() => { void load() }, [load])

  const warWindow = getWarWindow(war)
  const missing = war?.missing_list ?? []
  const excused = war?.absent_list ?? []
  const required = settings.attacks_required
  const excusedNames = useMemo(() => new Set(excused.map((entry) => entry.name.toLowerCase())), [excused])
  const rankedRatings = useMemo(() => ratings.filter((row) => !row.excused), [ratings])
  const excusedRatings = useMemo(() => ratings.filter((row) => row.excused), [ratings])
  // A one-sided team's rating renormalizes, so the missing half's column is not meaningful.
  const ratingTeam = useMemo(
    () => teams.find((item) => String(item.war_channel_id) === channelId) ?? null,
    [channelId, teams],
  )
  const hasRaceHalf = Boolean(ratingTeam?.race_channel_id)

  const trackedNames = useMemo(() => {
    const names = new Set<string>()
    Object.keys(counts).forEach((name) => names.add(name))
    missing.forEach((entry) => names.add(entry.name.toLowerCase()))
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [counts, missing])

  const saveSettings = async () => {
    setBusy('settings')
    try {
      await saveWarSettings(createClient(), guildId, { attacks_required: settings.attacks_required, exempt_absent: settings.exempt_absent })
      toast.success(
        'War settings saved.',
        `Every team in this server now needs ${settings.attacks_required} attacks per player to count as complete.`,
      )
    } catch (caught) { setFeedback({ tone: 'red', text: 'Could not save.' }) } finally { setBusy(null) }
  }

  const saveTeamRole = async () => {
    if (!channelId || !war) return
    const roleId = teamRole.trim()
    if (roleId && !isSnowflake(roleId)) {
      return setFeedback({ tone: 'red', text: 'Enter a valid Discord role ID (17–20 digits), or leave it empty.' })
    }
    setBusy('team-role')
    try {
      // Keep `teams.team_role_id` (the Setup source of truth) in sync with the war row the bot
      // reads, so both editors agree.
      await saveWarTeamRole(createClient(), channelId, ratingTeam?.id ?? null, roleId || null)
      setWar(await getWar(createClient(), channelId))
      if (roleId) {
        toast.success(
          'Team role saved.',
          ratingTeam
            ? 'Announcements in this channel ping it, and the team setup shows the same role.'
            : 'Announcements in this channel ping it instead of @here.',
        )
      } else {
        toast.success('Team role cleared.', 'Announcements in this channel fall back to @here.')
      }
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not save the team role.' })
    } finally {
      setBusy(null)
    }
  }

  const addMissing = async () => {
    if (!missingAlias || !war || !channelId) return
    const alias = aliases.find((entry) => entry.alias_name.toLowerCase() === missingAlias)
    if (!alias) return
    if (missing.some((entry) => entry.name.toLowerCase() === missingAlias)) {
      return setFeedback({ tone: 'red', text: 'That player is already on the missing list.' })
    }
    setBusy('missing')
    try {
      const nextMissing = [...missing, { name: missingAlias, id: alias.discord_id }]
      await updateWar(createClient(), channelId, { missing_list: nextMissing })
      setMissingAlias('')
      await load('refresh')
      toast.success(
        `${alias.alias_name} added to the missing list.`,
        'The bot’s war check now counts them as short.',
      )
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not update the missing list.' })
    } finally {
      setBusy(null)
    }
  }

  const removeMissing = async (name: string) => {
    if (!channelId) return
    setBusy(`missing-${name}`)
    try {
      await updateWar(createClient(), channelId, {
        missing_list: missing.filter((entry) => entry.name.toLowerCase() !== name.toLowerCase()),
      })
      await load('refresh')
      const displayName = aliases.find((entry) => entry.alias_name.toLowerCase() === name.toLowerCase())?.alias_name ?? name
      toast.success(
        `Removed ${displayName} from the missing list.`,
        'This only edits the missing list; attack reports stay in the log.',
      )
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not update the missing list.' })
    } finally {
      setBusy(null)
    }
  }

  const submitWarning = async () => {
    if (!warningId) return setFeedback({ tone: 'red', text: 'Please select a player to warn.' })
    setBusy('warning')
    try {
      await addWarning(createClient(), guildId, warningId, warningReason, null)
      setWarnings(await listWarnings(createClient(), guildId))
      setWarningId(''); setWarningReason('')
      toast.success(
        'Warning recorded.',
        'Appears in Recorded warnings below. The bot does not message the player automatically.',
      )
    } catch (e) { setFeedback({ tone: 'red', text: 'Could not record warning.' }) } finally { setBusy(null) }
  }

  const removeWarning = async (id: number) => {
    setBusy(`warn-${id}`)
    try {
      await deleteWarning(createClient(), guildId, id)
      setWarnings((current) => current.filter((w) => w.id !== id))
      toast.success('Warning removed.', 'It is deleted from this server’s warning list.')
    } finally {
      setBusy(null)
    }
  }

  if (loading) return <div><PageHeader title="War" /><Spinner label="Loading…" /></div>

  return (
    <div>
      <PageHeader
        eyebrow="War Tracker (Multi-Team)"
        title="War"
        description="Live war state for one team channel at a time. Pick a channel to see its timer, attendance and rating; the staff settings and warnings on the right apply to the whole server."
        actions={
          <div className="flex items-center gap-2">
            {availableChannels.length > 0 && (
              <div className="relative">
                <select
                  value={channelId || ''}
                  onChange={(e) => router.push(`?channel=${e.target.value}`)}
                  aria-label="War channel"
                  className="appearance-none bg-slate-900 border border-slate-700 text-slate-50 text-sm rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:border-accent-500"
                >
                  {availableChannels.map(id => <option key={id} value={id}>Team Channel ({id})</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            )}
            <Button variant="secondary" onClick={() => load('refresh')} aria-label="Refresh war data"><RefreshCw className="h-4 w-4" /></Button>
          </div>
        }
      />

      {feedback && <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>{feedback.text}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">

        {/* LEFT COLUMN: CHANNEL SPECIFIC DATA */}
        <div className="space-y-6">
          {!channelId ? (
            <Card>
              <CardBody>
                <EmptyState
                  icon={<Swords className="h-7 w-7" />}
                  title="No active wars"
                  description="You haven't started any wars yet. Go to Discord and type `!war defence ends 24h` in a channel to start tracking."
                />
              </CardBody>
            </Card>
          ) : (
            <>
              <Card>
                <CardHeader title="Live War Command Center" icon={<Clock className="h-5 w-5" />} />
                <CardBody className="space-y-6">
                  {war && war.is_active ? (
                    <>
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={warWindow.phase === 'attack' ? 'red' : 'blue'} dot>{warPhaseLabel(warWindow.phase)}</Badge>
                      </div>
                      <LiveTimer endTime={warWindow.warEnd} />
                      {warWindow.start && warWindow.warEnd && (
                        <div>
                          <ProgressBar value={now.getTime() - warWindow.start.getTime()} max={48 * 3600_000} tone={warWindow.phase === 'attack' ? 'red' : 'blue'} label={`Total War Progress`} />
                          <div className="flex justify-between mt-2 text-xs text-slate-500">
                            <span>Started: {formatDateTime(warWindow.start)}</span>
                            <span>Ends: {formatDateTime(warWindow.warEnd)}</span>
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Missing</p><p className="mt-1 text-xl font-bold text-warn-300">{missing.length}</p></div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Excused</p><p className="mt-1 text-xl font-bold text-steel-400">{excused.length}</p></div>
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500" title="Players with at least one logged attack">Players logged</p><p className="mt-1 text-xl font-bold text-slate-50">{Object.keys(counts).length}</p></div>
                      </div>
                    </>
                  ) : <EmptyState icon={<Swords className="h-7 w-7" />} title="No active war for this channel" />}
                </CardBody>
              </Card>

              {war && war.is_active && (
                <>
                  <Card>
                    <CardHeader
                      title="Announcements (this channel)"
                      description="Per war channel. War announcements in this channel ping this role instead of @here."
                      icon={<Users className="h-5 w-5" />}
                    />
                    <CardBody className="space-y-3">
                      {canManage ? (
                        <>
                          <Field
                            label="Team role ID"
                            hint="Paste the role ID (17–20 digits) from Discord. Saving changes what war announcements ping in this channel and updates the team setup. Leave empty to clear."
                          >
                            <TextInput
                              value={teamRole}
                              onChange={(e) => setTeamRole(e.target.value)}
                              placeholder="e.g. 123456789012345678"
                              inputMode="numeric"
                            />
                          </Field>
                          <Button onClick={saveTeamRole} loading={busy === 'team-role'} className="w-full">
                            <Save className="h-4 w-4" /> Save Team Role
                          </Button>
                        </>
                      ) : (
                        <p className="text-sm text-slate-400">
                          Team role: {war.team_role_id ? `ID ${war.team_role_id}` : 'none — @here fallback'}
                        </p>
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Attendance & counts" description={`Required: ${required} attacks per player, set in War settings on the right.`} icon={<Swords className="h-5 w-5" />} />
                    <CardBody className="space-y-4">
                      {canManage ? (
                        <p className="text-xs leading-relaxed text-slate-500">
                          Add a player when the bot’s count is short: pick their alias and choose Add
                          Missing. Removing a player only edits this missing list — it never changes
                          the attack log.
                        </p>
                      ) : null}
                      {canManage ? (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <select
                            value={missingAlias}
                            onChange={(e) => setMissingAlias(e.target.value)}
                            aria-label="Player to add to the missing list"
                            className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-50 focus:border-accent-500 sm:flex-1"
                          >
                            <option value="" disabled>Select a player (alias)…</option>
                            {aliases.map((alias) => (
                              <option key={alias.id} value={alias.alias_name.toLowerCase()}>
                                {alias.alias_name}
                              </option>
                            ))}
                          </select>
                          <Button onClick={addMissing} loading={busy === 'missing'}>Add Missing</Button>
                        </div>
                      ) : null}
                      {canManage && aliases.length === 0 ? (
                        <p className="text-xs text-slate-500">Add players with `!alias add @user &lt;alias&gt;` in Discord first.</p>
                      ) : null}
                      <div className="max-h-[300px] overflow-y-auto">
                        <table className="w-full text-left text-sm">
                          <tbody className="divide-y divide-slate-800">
                            {trackedNames.map((name) => {
                              const value = parseInt(counts[name] || '0')
                              const isExcused = settings.exempt_absent && excusedNames.has(name)
                              const isMissing = missing.some((entry) => entry.name.toLowerCase() === name)
                              return (
                                <tr key={name} className="hover:bg-slate-800/30">
                                  <td className="px-3 py-2 font-medium text-slate-200">{name}</td>
                                  <td className="px-3 py-2 text-right">
                                    {isExcused ? <Badge tone="blue">Excused</Badge> : value >= required ? <Badge tone="green">Met</Badge> : <Badge tone="amber">Missing</Badge>}
                                  </td>
                                  {canManage && isMissing ? (
                                    <td className="px-1 py-2 text-right">
                                      <button
                                        type="button"
                                        onClick={() => removeMissing(name)}
                                        disabled={busy === `missing-${name}`}
                                        className="rounded p-1 text-slate-500 hover:text-danger-300"
                                        aria-label={`Remove ${name} from the missing list`}
                                        title="Remove from missing"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    </td>
                                  ) : null}
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardBody>
                  </Card>

                  {canManage ? (
                    <Card>
                      <CardHeader
                        title="Attack log"
                        description="Every self-report from the ✅ I attacked button and `attacks done`, newest first."
                        icon={<Activity className="h-5 w-5" />}
                        action={<Badge tone="slate">{warLogs.length} shown</Badge>}
                      />
                      <CardBody className="p-0">
                        {warLogs.length === 0 ? (
                          <div className="p-8 text-center text-sm text-slate-500">
                            No attack reports logged for this war yet.
                          </div>
                        ) : (
                          <ul className="max-h-[360px] divide-y divide-slate-800/50 overflow-y-auto">
                            {warLogs.map((log) => (
                              <li key={log.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-medium text-slate-200">
                                    {log.player_name || `User ${log.discord_id ?? '—'}`}
                                  </p>
                                  <p className="text-xs text-slate-500">
                                    {formatDateTime(log.created_at)} · {sourceLabel(log.source)}
                                  </p>
                                </div>
                                <span className={`font-mono text-sm font-semibold ${log.attacks > 0 ? 'text-sage-300' : 'text-danger-300'}`}>
                                  {log.attacks > 0 ? `+${log.attacks}` : log.attacks}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </CardBody>
                    </Card>
                  ) : null}

                  {canManage ? (
                    <Card>
                      <CardHeader
                        title="Team rating"
                        description={
                          hasRaceHalf
                            ? 'War attendance 60% + race tasks 40%. Excused players are not ranked.'
                            : 'War-only team: attendance is the whole score. Excused players are not ranked.'
                        }
                        icon={<Trophy className="h-5 w-5" />}
                      />
                      <CardBody className="space-y-4">
                        {ratings.length === 0 ? (
                          <EmptyState
                            icon={<Trophy className="h-7 w-7" />}
                            title="No rating yet"
                            description="Attack counts and race tasks appear here after the bot logs activity for this team."
                          />
                        ) : (
                          <>
                            <div className="overflow-x-auto">
                              <table className="w-full text-left text-sm">
                                <thead>
                                  <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                                    <th className="px-2 py-1.5 font-medium">#</th>
                                    <th className="px-2 py-1.5 font-medium">Player</th>
                                    <th className="px-2 py-1.5 font-medium">Score</th>
                                    <th className="px-2 py-1.5 text-right font-medium">War</th>
                                    <th className="px-2 py-1.5 text-right font-medium">Race</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                  {rankedRatings.map((row, index) => (
                                    <tr
                                      key={row.discordId ? String(row.discordId) : `${row.alias}-${index}`}
                                      className="hover:bg-slate-800/30"
                                    >
                                      <td className="px-2 py-2 font-mono text-xs text-slate-600">{index + 1}</td>
                                      <td className="px-2 py-2 text-slate-200">{row.alias}</td>
                                      <td className="px-2 py-2">
                                        <span className="font-semibold text-slate-50">{row.score}</span>{' '}
                                        <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>
                                      </td>
                                      <td className="px-2 py-2 text-right font-mono text-xs text-slate-400">{row.attacks}/{row.required}</td>
                                      <td className="px-2 py-2 text-right font-mono text-xs text-slate-400">{hasRaceHalf ? row.raceTasks : '—'}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {excusedRatings.length > 0 ? (
                              <div>
                                <p className="mono-label text-steel-400">Excused ({excusedRatings.length})</p>
                                <div className="mt-1.5 flex flex-wrap gap-1.5">
                                  {excusedRatings.map((row, index) => (
                                    <Badge
                                      key={row.discordId ? String(row.discordId) : `${row.alias}-${index}`}
                                      tone="blue"
                                    >{row.alias} · {row.raceTasks} race</Badge>
                                  ))}
                                </div>
                                <p className="mt-1.5 text-[11px] text-slate-600">Excused players are not ranked and do not receive a grade.</p>
                              </div>
                            ) : null}
                          </>
                        )}
                      </CardBody>
                    </Card>
                  ) : null}
                </>
              )}
            </>
          )}
        </div>

        {/* RIGHT COLUMN: GLOBAL SETTINGS & WARNINGS */}
        <div className="space-y-6">
          {!isStaff ? (
            <Card>
              <CardHeader
                title="War Settings (Global)"
                description="Server-wide: every team in this server uses the same target."
                icon={<Save className="h-5 w-5" />}
              />
              <CardBody className="space-y-2">
                <p className="text-sm text-slate-300">
                  Required attacks per player:{' '}
                  <span className="font-semibold text-slate-50">{settings.attacks_required}</span>
                </p>
                <p className="text-xs text-slate-500">Only staff can change war settings.</p>
              </CardBody>
            </Card>
          ) : (
            <Card>
              <CardHeader
                title="War Settings (Global)"
                description="Server-wide: every team in this server uses the same target."
                icon={<Save className="h-5 w-5" />}
              />
              <CardBody className="space-y-6">
                <Field
                  label="Required Attacks"
                  hint={`How many attacks each player should use in a war (1–${MAX_ATTACKS_REQUIRED}). It decides who shows as missing and feeds the war part of the team rating.`}
                >
                  <div className="flex items-center gap-4">
                    <input type="range" min="1" max={MAX_ATTACKS_REQUIRED} value={settings.attacks_required} onChange={(e) => setSettings({...settings, attacks_required: parseInt(e.target.value)})} aria-label="Required attacks per player" className="w-full accent-accent-500" />
                    <div className="flex h-10 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-lg font-bold text-accent-300">{settings.attacks_required}</div>
                  </div>
                </Field>
                <Button onClick={saveSettings} loading={busy === 'settings'} className="w-full">Save Settings</Button>
              </CardBody>
            </Card>
          )}

          <Card>
            <CardHeader
              title="Warnings (Global)"
              description={
                isStaff
                  ? 'Staff records for this server. Adding one saves it here; the bot does not message the player automatically.'
                  : 'Staff records for this server. Only staff can add or delete them.'
              }
              icon={<AlertTriangle className="h-5 w-5" />}
            />
            <CardBody className="space-y-4">
              {isStaff ? (
                <div className="space-y-3">
                  <p className="text-xs leading-relaxed text-slate-500">
                    Choose the player, type a short reason, then add the warning. It appears in
                    Recorded warnings below and in Discord with `!warning list`.
                  </p>
                  <select
                    value={warningId}
                    onChange={(e) => setWarningId(e.target.value)}
                    aria-label="Player to warn"
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-50 focus:border-accent-500"
                  >
                    <option value="" disabled>Select a player (alias)…</option>
                    {aliases.map(a => (
                      <option key={a.id} value={String(a.discord_id)}>
                        {a.alias_name} ({a.discord_id})
                      </option>
                    ))}
                  </select>

                  <TextInput placeholder="Reason for warning…" aria-label="Reason for warning" value={warningReason} onChange={e => setWarningReason(e.target.value)} />

                  <Button onClick={submitWarning} loading={busy === 'warning'} className="w-full">
                    <Plus className="h-4 w-4 mr-2" /> Add Warning
                  </Button>
                </div>
              ) : null}

              <div className="mt-6 space-y-2">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Recorded Warnings</h4>
                {warnings.length === 0 ? (
                  <p className="text-sm text-slate-500">No warnings recorded yet.</p>
                ) : (
                  warnings.map(w => {
                    const player = aliases.find(a => String(a.discord_id) === String(w.discord_id))
                    const displayName = player ? player.alias_name : `User ${w.discord_id}`
                    return (
                      <li key={w.id} className="flex justify-between items-center bg-slate-950/60 px-3 py-2 rounded-lg border border-slate-800 list-none">
                        <div>
                          <p className="text-sm font-semibold text-slate-50">{displayName}</p>
                          <p className="text-xs text-slate-500">{w.reason}</p>
                        </div>
                        {isStaff ? (
                          <button onClick={() => removeWarning(w.id)} className="text-slate-500 hover:text-danger-400" aria-label={`Delete warning for ${displayName}`}>
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </li>
                    )
                  })
                )}
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
