'use client'

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Activity, AlertTriangle, ChevronDown, Clock, Plus, RefreshCw, Save, Swords, Trash2, Trophy, Users,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { WarRowActionsCell, WarRowDrawer } from '@/components/war-row-actions'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, PageHeader, ProgressBar, Spinner, TextInput, type Tone,
} from '@/components/ui'
import {
  addWarning, deleteWarning, getWar, getWarSettings, listAliases, listTeamPlayers,
  listWarnings, listWarLogs, saveWarSettings, saveWarTeamRole, updateWar,
} from '@/lib/data'
import {
  addToMissingBlockReason, computeAttendance, type AttendanceRow, type AttendanceStatus,
} from '@/lib/attendance'
import { computeRatings, type RatingRow } from '@/lib/rating'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/lib/toast'
import { DEFAULT_ATTACKS_REQUIRED, MAX_ATTACKS_REQUIRED } from '@/lib/constants'
import {
  formatDateTime, getWarWindow, isSnowflake, playerLabel, warPhaseLabel,
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

const ATTENDANCE_STATUS: Record<AttendanceStatus, { label: string; tone: Tone }> = {
  done: { label: 'Done', tone: 'green' },
  partial: { label: 'Partial', tone: 'amber' },
  none: { label: 'Not reported', tone: 'red' },
  excused: { label: 'Excused', tone: 'blue' },
}

/** War list entries are `{ name, id }` objects now, but old rows may still hold plain strings. */
function entryName(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof (entry as { name?: unknown }).name === 'string') {
    return (entry as { name: string }).name
  }
  return ''
}

function entryId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const id = (entry as { id?: unknown }).id
  return id === null || id === undefined || String(id).trim() === '' ? null : String(id).trim()
}

/** Name or Discord-id match against a war list, tolerant of legacy plain-string entries. */
function listMatchesPlayer(
  entries: unknown,
  names: Set<string>,
  discordId: string,
): boolean {
  if (!Array.isArray(entries)) return false
  return entries.some((entry) => {
    const name = entryName(entry).trim().toLowerCase()
    return (name !== '' && names.has(name)) || entryId(entry) === discordId
  })
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
  const [rosterIds, setRosterIds] = useState<string[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [aliasesLoaded, setAliasesLoaded] = useState(false)
  const [missingAlias, setMissingAlias] = useState('')
  // The one open row drawer (by player key, never rendered) and its in-progress warning.
  const [drawer, setDrawer] = useState<{ key: string; warn: boolean } | null>(null)
  const [drawerReason, setDrawerReason] = useState('')
  const nudged = useRef(false)
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
        setAliasesLoaded(true)

        // Fetch Channel-specific War Data
        if (channelId) {
          const nextWar = await getWar(supabase, channelId)
          setWar(nextWar)
          if (nextWar) {
            setCounts(Object.fromEntries(Object.entries(nextWar.attack_counts ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)])))
            setTeamRole(nextWar.team_role_id ? String(nextWar.team_role_id) : '')
          }

          const team = teams.find((item) => String(item.war_channel_id) === channelId) ?? null

          const [nextWarLogs, nextRoster] = await Promise.all([
            listWarLogs(supabase, channelId, nextWar?.war_start ?? null, 25).catch(() => []),
            team ? listTeamPlayers(supabase, [team.id]).catch(() => []) : Promise.resolve([]),
          ])
          setWarLogs(nextWarLogs)
          setRosterIds(nextRoster.map((player) => String(player.discord_id)))
          setRatings(
            computeRatings({
              war: nextWar,
              warSettings: nextSettings,
              aliases: nextAliases,
            }),
          )
        } else {
          setWarLogs([])
          setRatings([])
          setRosterIds([])
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
  const attendance = useMemo(
    () =>
      computeAttendance({
        war,
        required,
        aliases,
        rosterIds,
        exemptAbsent: settings.exempt_absent,
      }),
    [war, required, aliases, rosterIds, settings.exempt_absent],
  )
  const hasRoster = rosterIds.length > 0
  const rankedRatings = useMemo(() => ratings.filter((row) => !row.excused), [ratings])
  const excusedRatings = useMemo(() => ratings.filter((row) => row.excused), [ratings])
  const ratingTeam = useMemo(
    () => teams.find((item) => String(item.war_channel_id) === channelId) ?? null,
    [channelId, teams],
  )

  // Staff-only nudge, once per visit: without aliases every player would show as "No alias".
  useEffect(() => {
    if (!aliasesLoaded || !isStaff || aliases.length > 0 || nudged.current) return
    nudged.current = true
    toast.warn(
      'No aliases yet — players show by alias, not Discord ID.',
      '!alias add @user <name> or the Aliases page',
    )
  }, [aliasesLoaded, isStaff, aliases.length, toast])

  // Aliases whose player has no row in the attendance table (guests, loans, roster changes).
  const aliasesWithoutRow = useMemo(() => {
    const rowIds = new Set(
      attendance.rows.filter((row) => row.discordId !== null).map((row) => String(row.discordId)),
    )
    const rowNames = new Set(attendance.rows.map((row) => row.alias.trim().toLowerCase()))
    return aliases.filter(
      (alias) =>
        !rowIds.has(String(alias.discord_id)) && !rowNames.has(alias.alias_name.trim().toLowerCase()),
    )
  }, [aliases, attendance.rows])

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

  const addMissing = async (target: { alias: string; discordId: string | number | null }) => {
    if (!war || !channelId) return
    const alias =
      (target.discordId !== null
        ? aliases.find((entry) => String(entry.discord_id) === String(target.discordId))
        : undefined) ?? aliases.find((entry) => entry.alias_name.toLowerCase() === target.alias.toLowerCase())
    if (!alias) return
    // Look at every alias of that player so a second alias row cannot slip a reported player in.
    const playerAliases = aliases.filter((entry) => String(entry.discord_id) === String(alias.discord_id))
    const playerNames = new Set(playerAliases.map((entry) => entry.alias_name.toLowerCase()))
    playerNames.add(target.alias.toLowerCase())
    const playerId = String(alias.discord_id)
    let attacks = 0
    for (const [name, value] of Object.entries(war.attack_counts ?? {})) {
      if (!playerNames.has(name.trim().toLowerCase())) continue
      const count = Number(value)
      if (Number.isFinite(count) && count > 0) attacks += count
    }
    // Never add a player the bot would not consider short: excused players and players who
    // already reported enough attacks are refused before any write.
    if (settings.exempt_absent && listMatchesPlayer(excused, playerNames, playerId)) {
      return setFeedback({ tone: 'red', text: `${alias.alias_name} is excused for this war — not added to missing.` })
    }
    if (required > 0 && attacks >= required) {
      return setFeedback({ tone: 'red', text: `${alias.alias_name} already reported ${attacks}/${required} — not added to missing.` })
    }
    if (listMatchesPlayer(missing, playerNames, playerId)) {
      return setFeedback({ tone: 'red', text: `${alias.alias_name} is already on the missing list.` })
    }
    setBusy('missing')
    try {
      const nextMissing = [...missing, { name: alias.alias_name.toLowerCase(), id: alias.discord_id }]
      await updateWar(createClient(), channelId, { missing_list: nextMissing })
      setMissingAlias('')
      setDrawer(null)
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

  const removeMissing = async (row: AttendanceRow) => {
    if (!channelId) return
    const playerAliases = aliases.filter(
      (entry) => row.discordId !== null && String(entry.discord_id) === String(row.discordId),
    )
    const playerNames = new Set(playerAliases.map((entry) => entry.alias_name.toLowerCase()))
    playerNames.add(row.alias.toLowerCase())
    const playerId = row.discordId !== null ? String(row.discordId) : null
    // A player can sit on the list under another alias of theirs, so match names and id.
    const matchesRow = (entry: unknown): boolean => {
      const name = entryName(entry).trim().toLowerCase()
      if (name !== '' && playerNames.has(name)) return true
      return playerId !== null && entryId(entry) === playerId
    }
    setBusy(`missing-${row.alias}`)
    try {
      await updateWar(createClient(), channelId, {
        missing_list: missing.filter((entry) => !matchesRow(entry)),
      })
      await load('refresh')
      toast.success(
        `Removed ${row.alias} from the missing list.`,
        'This only edits the missing list; attack reports stay in the log.',
      )
    } catch (caught) {
      setFeedback({ tone: 'red', text: 'Could not update the missing list.' })
    } finally {
      setBusy(null)
    }
  }

  const submitWarning = async () => {
    const target = aliases.find((entry) => String(entry.id) === warningId)
    if (!target) return setFeedback({ tone: 'red', text: 'Please select a player to warn.' })
    setBusy('warning')
    try {
      await addWarning(createClient(), guildId, String(target.discord_id), warningReason, null)
      setWarnings(await listWarnings(createClient(), guildId))
      setWarningId(''); setWarningReason('')
      toast.success(
        'Warning recorded.',
        'Appears in Recorded warnings below. The bot does not message the player automatically.',
      )
    } catch (e) { setFeedback({ tone: 'red', text: 'Could not record warning.' }) } finally { setBusy(null) }
  }

  /* Row drawer: one open at a time, keyed by player (never rendered or used as a DOM id). */
  const rowKey = (row: AttendanceRow) =>
    row.discordId !== null ? `id:${String(row.discordId)}` : `name:${row.alias.toLowerCase()}`

  const closeDrawer = (returnFocusTo?: string) => {
    setDrawer(null)
    setDrawerReason('')
    if (returnFocusTo) {
      requestAnimationFrame(() => document.getElementById(returnFocusTo)?.focus())
    }
  }

  const toggleDrawer = (row: AttendanceRow, plusId: string) => {
    if (drawer?.key === rowKey(row)) return closeDrawer(plusId)
    setDrawer({ key: rowKey(row), warn: false })
    setDrawerReason('')
    if (row.discordId === null) {
      // A legacy name-only row has no Discord user behind it: nothing to act on until it has one.
      toast.warn('Add an alias first', '!alias add @user <name>')
    }
  }

  const warnFromRow = async (row: AttendanceRow, plusId: string) => {
    if (row.discordId === null) return
    setBusy('row-warning')
    try {
      await addWarning(createClient(), guildId, String(row.discordId), drawerReason, null)
      setWarnings(await listWarnings(createClient(), guildId))
      closeDrawer(plusId)
      toast.success(
        'Warning recorded.',
        'Appears in Recorded warnings. The bot does not message the player automatically.',
      )
    } catch (e) {
      setFeedback({ tone: 'red', text: 'Could not record warning.' })
    } finally {
      setBusy(null)
    }
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
                  {availableChannels.map((id, index) => {
                    const owner = teams.find((item) => String(item.war_channel_id) === id)
                    return (
                      <option key={id} value={id}>
                        {owner ? `Team — ${owner.name}` : `Channel ${index + 1}`}
                      </option>
                    )
                  })}
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
        {/* min-w-0: the rating table's min-content must not widen the single-column grid
            track past the phone viewport; the table scrolls inside its own overflow-x box. */}

        {/* LEFT COLUMN: CHANNEL SPECIFIC DATA */}
        <div className="min-w-0 space-y-6">
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
                          Team role: {war.team_role_id ? 'set' : 'none — @here fallback'}
                        </p>
                      )}
                    </CardBody>
                  </Card>

                  <Card>
                    <CardHeader title="Attendance & counts" description={`Required: ${required} attacks per player, set in War settings on the right.`} icon={<Swords className="h-5 w-5" />} />
                    <CardBody className="space-y-4">
                      <p className="text-xs leading-relaxed text-slate-500">
                        Every rostered player with an alias starts on the missing list and clears
                        themselves by sending <code className="font-mono text-slate-300">attacks done</code>{' '}
                        in Discord.
                      </p>
                      {!hasRoster && aliases.length > 0 ? (
                        <p className="text-xs leading-relaxed text-slate-500">
                          No roster is configured for this team, so every alias in the server is
                          listed. Add players to the team in Setup to scope this list to the team.
                        </p>
                      ) : null}
                      {canManage ? (
                        <p className="text-xs leading-relaxed text-slate-500">
                          Add a player when the bot’s count is short: tap + on their row and choose Add
                          to missing. Players who already reported enough attacks or are excused are
                          refused. Removing a player only edits this missing list — it never changes
                          the attack log.
                        </p>
                      ) : null}
                      {canManage && aliases.length === 0 ? (
                        <p className="text-xs text-slate-500">Add players with `!alias add @user &lt;alias&gt;` in Discord first.</p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="green">Done {attendance.summary.done}</Badge>
                        <Badge tone="amber">Partial {attendance.summary.partial}</Badge>
                        <Badge tone="red">Not reported {attendance.summary.none}</Badge>
                        <Badge tone="blue">Excused {attendance.summary.excused}</Badge>
                      </div>
                      {attendance.rows.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          {aliases.length === 0
                            ? 'Add players with `!alias add @user <alias>` in Discord first.'
                            : 'No player in this team’s roster has an alias yet. Add one with `!alias add` in Discord.'}
                        </p>
                      ) : (
                        <div className="max-h-[360px] overflow-x-auto overflow-y-auto">
                          <table className="w-full text-left text-sm">
                            <thead>
                              <tr className="text-[11px] uppercase tracking-wider text-slate-500">
                                <th className="px-2 py-1.5 font-medium">Player</th>
                                <th className="px-2 py-1.5 font-medium">Attacks</th>
                                <th className="px-2 py-1.5 font-medium">Status</th>
                                {canManage ? <th className="px-1 py-1.5" aria-label="Actions" /> : null}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-800/70">
                              {attendance.rows.map((row, index) => {
                                const meta = ATTENDANCE_STATUS[row.status]
                                const label = playerLabel(row.alias, aliases, row.discordId)
                                const key = rowKey(row)
                                const plusId = `war-row-plus-${index}`
                                const drawerId = `war-row-drawer-${index}`
                                const expanded = drawer?.key === key
                                return (
                                  <Fragment key={key}>
                                    <tr className="hover:bg-slate-800/30">
                                      <td className="px-2 py-2 font-medium text-slate-200">{label}</td>
                                      <td className="px-2 py-2">
                                        <Badge tone={meta.tone}>{row.attacks}/{row.required}</Badge>
                                      </td>
                                      <td className="px-2 py-2"><Badge tone={meta.tone}>{meta.label}</Badge></td>
                                      {canManage ? (
                                        <WarRowActionsCell
                                          alias={label}
                                          plusId={plusId}
                                          drawerId={drawerId}
                                          expanded={expanded}
                                          onToggle={() => toggleDrawer(row, plusId)}
                                          canRemove={row.onMissingList}
                                          removing={busy === `missing-${row.alias}`}
                                          onRemove={() => removeMissing(row)}
                                        />
                                      ) : null}
                                    </tr>
                                    {canManage && expanded ? (
                                      <WarRowDrawer
                                        id={drawerId}
                                        colSpan={4}
                                        alias={label}
                                        hasDiscordId={row.discordId !== null}
                                        addBlockedReason={addToMissingBlockReason(row)}
                                        canWarn={isStaff}
                                        warnOpen={drawer?.warn === true}
                                        warnReason={drawerReason}
                                        busy={
                                          busy === 'missing' ? 'add' : busy === 'row-warning' ? 'warn' : null
                                        }
                                        onAdd={() => void addMissing({ alias: row.alias, discordId: row.discordId })}
                                        onWarnOpen={() =>
                                          setDrawer((current) => (current ? { ...current, warn: !current.warn } : current))
                                        }
                                        onWarnReasonChange={setDrawerReason}
                                        onWarnSubmit={() => void warnFromRow(row, plusId)}
                                        onClose={() => closeDrawer(plusId)}
                                      />
                                    ) : null}
                                  </Fragment>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {canManage && aliasesWithoutRow.length > 0 ? (
                        <div className="mt-3 flex items-center gap-2">
                          <select
                            value={missingAlias}
                            onChange={(e) => setMissingAlias(e.target.value)}
                            aria-label="Add someone not in this list"
                            className="min-w-0 flex-1 bg-slate-950 border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-50 focus:border-accent-500"
                          >
                            <option value="" disabled>Add someone not in this list…</option>
                            {aliasesWithoutRow.map((alias) => (
                              <option key={alias.id} value={alias.alias_name.toLowerCase()}>
                                {alias.alias_name}
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            className="min-h-[40px] shrink-0"
                            disabled={!missingAlias}
                            onClick={() => void addMissing({ alias: missingAlias, discordId: null })}
                            loading={busy === 'missing' && drawer === null}
                          >
                            Add
                          </Button>
                        </div>
                      ) : null}
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
                                    {playerLabel(log.player_name, aliases, log.discord_id)}
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
                        description="Attack attendance is the whole score. Excused players are not ranked."
                        icon={<Trophy className="h-5 w-5" />}
                      />
                      <CardBody className="space-y-4">
                        {ratings.length === 0 ? (
                          <EmptyState
                            icon={<Trophy className="h-7 w-7" />}
                            title="No rating yet"
                            description="Attack counts appear here after players report attacks for this team."
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
                                    <th className="px-2 py-1.5 text-right font-medium">Attacks</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800/70">
                                  {rankedRatings.map((row, index) => (
                                    <tr
                                      key={row.discordId ? String(row.discordId) : `${row.alias}-${index}`}
                                      className="hover:bg-slate-800/30"
                                    >
                                      <td className="px-2 py-2 font-mono text-xs text-slate-600">{index + 1}</td>
                                      <td className="px-2 py-2 text-slate-200">{playerLabel(row.alias, aliases, row.discordId)}</td>
                                      <td className="px-2 py-2">
                                        <span className="font-semibold text-slate-50">{row.score}</span>{' '}
                                        <Badge tone={gradeTone(row.grade)}>{row.grade}</Badge>
                                      </td>
                                      <td className="px-2 py-2 text-right font-mono text-xs text-slate-400">{row.attacks}/{row.required}</td>
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
                                    >{playerLabel(row.alias, aliases, row.discordId)}</Badge>
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
        <div className="min-w-0 space-y-6">
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
                  hint={`How many attacks each player should use in a war (1–${MAX_ATTACKS_REQUIRED}). It decides who shows as missing and feeds the team rating.`}
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
                      <option key={a.id} value={String(a.id)}>
                        {a.alias_name}
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
                    const displayName = playerLabel(null, aliases, w.discord_id)
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
