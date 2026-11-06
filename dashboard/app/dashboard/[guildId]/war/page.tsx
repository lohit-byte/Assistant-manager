'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  Clock,
  Plus,
  RefreshCw,
  Save,
  Swords,
  Trash2,
  UserMinus,
  Users,
  X,
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
  ProgressBar,
  Spinner,
  TextInput,
  Toggle,
} from '@/components/ui'
import {
  addWarning,
  deleteWarning,
  endWar,
  getWar,
  getWarSettings,
  listAliases,
  listWarnings,
  resetWarLists,
  saveWarSettings,
  updateWar,
} from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_ATTACKS_REQUIRED, MAX_ATTACKS_REQUIRED } from '@/lib/constants'
import {
  formatDateTime,
  formatDuration,
  formatRelative,
  getWarWindow,
  isSnowflake,
  warPhaseLabel,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { War, WarSettings, Warning } from '@/lib/types'

type Feedback = { tone: 'green' | 'red'; text: string } | null

export default function WarPage() {
  const { guildId } = useGuild()
  const now = useNow(15_000)

  const [settings, setSettings] = useState<WarSettings>({
    guild_id: guildId,
    attacks_required: DEFAULT_ATTACKS_REQUIRED,
    exempt_absent: true,
  })
  const [war, setWar] = useState<War | null>(null)
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const [missingInput, setMissingInput] = useState('')
  const [excusedInput, setExcusedInput] = useState('')
  const [logName, setLogName] = useState('')
  const [logCount, setLogCount] = useState('')

  const [warningId, setWarningId] = useState('')
  const [warningReason, setWarningReason] = useState('')

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      const supabase = createClient()
      try {
        const [nextSettings, nextWar, nextWarnings] = await Promise.all([
          getWarSettings(supabase, guildId),
          getWar(supabase, guildId),
          listWarnings(supabase, guildId),
        ])
        setSettings(nextSettings)
        setWar(nextWar)
        setWarnings(nextWarnings)
        setCounts(
          Object.fromEntries(
            Object.entries(nextWar?.attack_counts ?? {}).map(([name, value]) => [
              name.toLowerCase(),
              String(value),
            ]),
          ),
        )
      } catch (caught) {
        setFeedback({
          tone: 'red',
          text: caught instanceof Error ? caught.message : 'Could not load war data.',
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

  const reloadWar = async () => {
    const next = await getWar(createClient(), guildId)
    setWar(next)
    setCounts(
      Object.fromEntries(
        Object.entries(next?.attack_counts ?? {}).map(([name, value]) => [
          name.toLowerCase(),
          String(value),
        ]),
      ),
    )
  }

  const warWindow = getWarWindow(war)
  const missing = war?.missing_list ?? []
  const excused = war?.absent_list ?? []
  const required = settings.attacks_required

  const excusedNames = useMemo(
    () => new Set(excused.map((entry) => entry.name.toLowerCase())),
    [excused],
  )

  const trackedNames = useMemo(() => {
    const names = new Set<string>()
    Object.keys(counts).forEach((name) => names.add(name))
    missing.forEach((entry) => names.add(entry.name.toLowerCase()))
    return Array.from(names).sort((a, b) => a.localeCompare(b))
  }, [counts, missing])

  const saveSettings = async () => {
    setBusy('settings')
    setFeedback(null)
    try {
      await saveWarSettings(createClient(), guildId, {
        attacks_required: settings.attacks_required,
        exempt_absent: settings.exempt_absent,
      })
      setFeedback({ tone: 'green', text: 'War settings saved.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not save war settings.',
      })
    } finally {
      setBusy(null)
    }
  }

  const addToList = async (list: 'missing' | 'excused', rawName: string) => {
    const name = rawName.trim().toLowerCase()
    if (!name || !war) return
    const key = `${list}-add`
    setBusy(key)
    setFeedback(null)
    try {
      const currentMissing = (war?.missing_list ?? []).filter((entry) => entry.name.toLowerCase() !== name)
      const currentExcused = (war?.absent_list ?? []).filter((entry) => entry.name.toLowerCase() !== name)

      if (list === 'missing') {
        currentMissing.push({ name })
        await updateWar(createClient(), guildId, {
          missing_list: currentMissing,
          absent_list: currentExcused,
        })
        setMissingInput('')
      } else {
        currentExcused.push({ name })
        await updateWar(createClient(), guildId, {
          absent_list: currentExcused,
          missing_list: currentMissing,
        })
        setExcusedInput('')
      }
      await reloadWar()
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not update the war list.',
      })
    } finally {
      setBusy(null)
    }
  }

  const removeFromList = async (list: 'missing' | 'excused', name: string) => {
    setBusy(`${list}-${name}`)
    setFeedback(null)
    try {
      const nextMissing = (war?.missing_list ?? []).filter((entry) => entry.name.toLowerCase() !== name)
      const nextExcused = (war?.absent_list ?? []).filter((entry) => entry.name.toLowerCase() !== name)
      await updateWar(createClient(), guildId, {
        missing_list: nextMissing,
        absent_list: nextExcused,
      })
      await reloadWar()
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not update the war list.',
      })
    } finally {
      setBusy(null)
    }
  }

  const logAttacks = async (name: string, value: number) => {
    if (!war) return
    const key = name.toLowerCase()
    setBusy(`log-${key}`)
    setFeedback(null)
    try {
      const nextCounts = { ...(war.attack_counts ?? {}), [key]: value }
      const nextMissing = (war.missing_list ?? []).filter(
        (entry) => entry.name.toLowerCase() !== key || value < required,
      )
      await updateWar(createClient(), guildId, {
        attack_counts: nextCounts,
        missing_list: nextMissing,
      })
      await reloadWar()
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not log attacks.',
      })
    } finally {
      setBusy(null)
    }
  }

  const addManualLog = async () => {
    const name = logName.trim().toLowerCase()
    const value = Number.parseInt(logCount, 10)
    if (!name || Number.isNaN(value) || value < 0) {
      setFeedback({ tone: 'red', text: 'Enter a name and a non-negative attack count.' })
      return
    }
    await logAttacks(name, value)
    setLogName('')
    setLogCount('')
  }

  const saveCounts = async () => {
    if (!war) return
    setBusy('counts')
    setFeedback(null)
    try {
      const nextCounts: Record<string, number> = {}
      for (const [name, raw] of Object.entries(counts)) {
        const value = Number.parseInt(raw, 10)
        nextCounts[name] = Number.isNaN(value) ? 0 : Math.max(0, value)
      }
      const nextMissing = (war.missing_list ?? []).filter(
        (entry) => (nextCounts[entry.name.toLowerCase()] ?? 0) < required,
      )
      await updateWar(createClient(), guildId, {
        attack_counts: nextCounts,
        missing_list: nextMissing,
      })
      await reloadWar()
      setFeedback({ tone: 'green', text: 'Attack log saved.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not save the attack log.',
      })
    } finally {
      setBusy(null)
    }
  }

  const resetLists = async () => {
    if (!window.confirm('Clear the missing list, excused list and every attack count for this war?')) {
      return
    }
    setBusy('reset')
    setFeedback(null)
    try {
      await resetWarLists(createClient(), guildId)
      await reloadWar()
      setFeedback({ tone: 'green', text: 'War lists cleared.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not reset the war.',
      })
    } finally {
      setBusy(null)
    }
  }

  const stopWar = async () => {
    if (
      !window.confirm(
        'Mark this war as ended? The bot will stop updating its status message. Timers already scheduled in the bot keep running until they fire.',
      )
    ) {
      return
    }
    setBusy('end')
    setFeedback(null)
    try {
      await endWar(createClient(), guildId)
      await reloadWar()
      setFeedback({ tone: 'green', text: 'War marked as ended.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not end the war.',
      })
    } finally {
      setBusy(null)
    }
  }

    const submitWarning = async () => {
    const input = warningId.trim()
    setBusy('warning-add')
    setFeedback(null)
    try {
      const aliases = await listAliases(createClient(), guildId)
      const match = aliases.find((a) => a.alias_name.toLowerCase() === input.toLowerCase())
      const discordId = match ? String(match.discord_id) : isSnowflake(input) ? input : null
      if (!discordId) {
        setFeedback({
          tone: 'red',
          text: `No alias "${input}" found. Add it on the Aliases page first.`,
        })
        return
      }
      await addWarning(createClient(), guildId, discordId, warningReason, null)
      setWarningId('')
      setWarningReason('')
      setWarnings(await listWarnings(createClient(), guildId))
      setFeedback({ tone: 'green', text: 'Warning recorded.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not record the warning.',
      })
    } finally {
      setBusy(null)
    }
  }

  const removeWarning = async (id: number) => {
    setBusy(`warning-${id}`)
    setFeedback(null)
    try {
      await deleteWarning(createClient(), guildId, id)
      setWarnings((current) => current.filter((item) => item.id !== id))
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not delete the warning.',
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="War" description="Settings, live attendance and warnings." />
        <Spinner label="Loading war data…" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="War tracker"
        title="War"
        description="This page reads and writes the same war tables the Discord bot uses. Bot commands keep working alongside it."
        actions={
          <>
            <Button variant="secondary" onClick={() => load('refresh')}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            {war ? (
              <Button variant="danger" onClick={stopWar} loading={busy === 'end'}>
                <Ban className="h-4 w-4" />
                End war
              </Button>
            ) : null}
          </>
        }
      />

      {feedback ? (
        <Alert
          tone={feedback.tone}
          className="mb-6"
          onDismiss={() => setFeedback(null)}
        >
          {feedback.text}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <Card>
          <CardHeader
            title="War settings"
            description="Used by !war check and attack logging."
            icon={<Swords className="h-5 w-5" />}
          />
          <CardBody className="space-y-6">
            <Field
              label="Required attacks"
              hint={`Players below this many attacks appear in the missing list. Bot default: ${DEFAULT_ATTACKS_REQUIRED}.`}
            >
              <div className="flex items-center gap-4">
                <input
                  type="range"
                  min={1}
                  max={MAX_ATTACKS_REQUIRED}
                  value={settings.attacks_required}
                  onChange={(event) =>
                    setSettings((current) => ({
                      ...current,
                      attacks_required: Number(event.target.value),
                    }))
                  }
                  className="h-2 flex-1 cursor-pointer appearance-none rounded-lg bg-slate-800 accent-purple-500"
                />
                <div className="flex h-12 w-16 items-center justify-center rounded-xl border border-slate-700 bg-slate-950 text-xl font-bold text-purple-300">
                  {settings.attacks_required}
                </div>
              </div>
            </Field>

            <div className="border-t border-slate-800 pt-5">
              <Toggle
                checked={settings.exempt_absent}
                onChange={(value) =>
                  setSettings((current) => ({ ...current, exempt_absent: value }))
                }
                label="Exempt excused players"
                description="Do not count excused players as below the required attacks."
              />
            </div>

            <Button onClick={saveSettings} loading={busy === 'settings'} className="w-full">
              <Save className="h-4 w-4" />
              Save war settings
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Live war"
            description="Phase timer and attendance"
            icon={<Clock className="h-5 w-5" />}
            action={
              war ? (
                <Button variant="secondary" size="sm" onClick={resetLists} loading={busy === 'reset'}>
                  <Trash2 className="h-3.5 w-3.5" />
                  Reset lists
                </Button>
              ) : null
            }
          />
          <CardBody>
            {war ? (
              <div className="space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      warWindow.active ? (warWindow.phase === 'attack' ? 'red' : 'blue') : 'slate'
                    }
                    dot
                  >
                    {warWindow.active ? warPhaseLabel(warWindow.phase) : 'Inactive'}
                  </Badge>
                  <Badge tone={war.is_active ? 'green' : 'slate'}>
                    {war.is_active ? 'Tracking' : 'Stopped'}
                  </Badge>
                  {war.status_channel_id ? (
                    <span className="font-mono text-xs text-slate-500">
                      channel {String(war.status_channel_id)}
                    </span>
                  ) : null}
                </div>

                <div className="grid gap-2 text-sm sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                    <p className="text-xs text-slate-500">Started</p>
                    <p className="mt-0.5 text-slate-200">{formatDateTime(warWindow.start)}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3">
                    <p className="text-xs text-slate-500">Ends</p>
                    <p className="mt-0.5 text-slate-200">{formatDateTime(warWindow.end)}</p>
                  </div>
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
                    <p className="mt-2 text-xs text-slate-500">
                      {formatRelative(warWindow.end, now)} ·{' '}
                      {formatDuration(warWindow.end.getTime() - now.getTime())} remaining
                    </p>
                  </div>
                ) : (
                  <p className="text-sm text-slate-500">
                    {warWindow.phase === 'ended'
                      ? 'This war has ended. Reset the lists to prepare the next one.'
                      : 'No phase timer is running for this war.'}
                  </p>
                )}

                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Missing</p>
                    <p className="mt-1 text-xl font-bold text-amber-300">{missing.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Excused</p>
                    <p className="mt-1 text-xl font-bold text-sky-300">{excused.length}</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3">
                    <p className="text-xs text-slate-500">Logged</p>
                    <p className="mt-1 text-xl font-bold text-white">{Object.keys(counts).length}</p>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                icon={<Swords className="h-7 w-7" />}
                title="No war record"
                description="Start a war in Discord with !war defence ends 24h. The record will appear here."
              />
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Missing list"
            description="Players who still need attacks"
            icon={<UserMinus className="h-5 w-5" />}
          />
          <CardBody className="space-y-4">
            <div className="flex gap-2">
              <TextInput
                value={missingInput}
                onChange={(event) => setMissingInput(event.target.value)}
                placeholder="Player alias"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addToList('missing', missingInput)
                }}
              />
              <Button
                onClick={() => addToList('missing', missingInput)}
                loading={busy === 'missing-add'}
                disabled={!war}
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>

            {missing.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
                The missing list is empty.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {missing.map((entry) => (
                  <li
                    key={entry.name}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-amber-200">{entry.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFromList('missing', entry.name.toLowerCase())}
                      disabled={busy === `missing-${entry.name.toLowerCase()}`}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      aria-label={`Remove ${entry.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Excused list"
            description="Players excused from this war"
            icon={<Users className="h-5 w-5" />}
          />
          <CardBody className="space-y-4">
            <div className="flex gap-2">
              <TextInput
                value={excusedInput}
                onChange={(event) => setExcusedInput(event.target.value)}
                placeholder="Player alias"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void addToList('excused', excusedInput)
                }}
              />
              <Button
                onClick={() => addToList('excused', excusedInput)}
                loading={busy === 'excused-add'}
                disabled={!war}
              >
                <Plus className="h-4 w-4" />
                Add
              </Button>
            </div>

            {excused.length === 0 ? (
              <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
                Nobody is excused.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {excused.map((entry) => (
                  <li
                    key={entry.name}
                    className="flex items-center justify-between rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2"
                  >
                    <span className="text-sm font-medium text-sky-200">{entry.name}</span>
                    <button
                      type="button"
                      onClick={() => removeFromList('excused', entry.name.toLowerCase())}
                      disabled={busy === `excused-${entry.name.toLowerCase()}`}
                      className="rounded p-1 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                      aria-label={`Remove ${entry.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardBody>
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader
          title="Attack log"
          description={`Required: ${required} attacks per player`}
          icon={<Swords className="h-5 w-5" />}
          action={
            trackedNames.length > 0 ? (
              <Button variant="secondary" size="sm" onClick={saveCounts} loading={busy === 'counts'}>
                <Save className="h-3.5 w-3.5" />
                Save counts
              </Button>
            ) : null
          }
        />
        <CardBody className="space-y-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <TextInput
              value={logName}
              onChange={(event) => setLogName(event.target.value)}
              placeholder="Player alias"
              className="sm:flex-1"
            />
            <TextInput
              value={logCount}
              onChange={(event) => setLogCount(event.target.value)}
              placeholder={`Attacks (0–${MAX_ATTACKS_REQUIRED}+)`}
              inputMode="numeric"
              className="sm:w-44"
            />
            <Button onClick={addManualLog} disabled={!war || !logName.trim() || !logCount.trim()}>
              <Plus className="h-4 w-4" />
              Log
            </Button>
          </div>

          {!war || trackedNames.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
              No attacks have been logged for this war.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-sm">
                <thead className="border-b border-slate-800 text-xs uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-3 py-2 font-medium">Player</th>
                    <th className="w-32 px-3 py-2 font-medium">Attacks</th>
                    <th className="w-28 px-3 py-2 text-right font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/70">
                  {trackedNames.map((name) => {
                    const value = Number.parseInt(counts[name] ?? '0', 10) || 0
                    const isExcused = settings.exempt_absent && excusedNames.has(name)
                    const ok = value >= required || isExcused
                    return (
                      <tr key={name}>
                        <td className="px-3 py-2 font-medium text-slate-200">{name}</td>
                        <td className="px-3 py-2">
                          <TextInput
                            value={counts[name] ?? ''}
                            inputMode="numeric"
                            aria-label={`Attacks for ${name}`}
                            onChange={(event) =>
                              setCounts((current) => ({ ...current, [name]: event.target.value }))
                            }
                            className="w-24 px-2 py-1.5 text-center"
                          />
                        </td>
                        <td className="px-3 py-2 text-right">
                          {isExcused ? (
                            <Badge tone="blue">Excused</Badge>
                          ) : ok ? (
                            <Badge tone="green">Met</Badge>
                          ) : (
                            <Badge tone="amber">{Math.max(0, required - value)} short</Badge>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader
          title="Warnings"
          description="Recorded by staff in Discord or from this dashboard"
          icon={<AlertTriangle className="h-5 w-5" />}
        />
        <CardBody className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-[1fr_1.6fr_auto]">
            <TextInput
              value={warningId}
              onChange={(event) => setWarningId(event.target.value)}
              placeholder="Player alias"
            />
            <TextInput
              value={warningReason}
              onChange={(event) => setWarningReason(event.target.value)}
              placeholder="Reason (optional)"
            />
            <Button onClick={submitWarning} loading={busy === 'warning-add'}>
              <Plus className="h-4 w-4" />
              Warn
            </Button>
          </div>

          {warnings.length === 0 ? (
            <p className="rounded-xl border border-dashed border-slate-800 px-4 py-6 text-center text-sm text-slate-500">
              No warnings recorded for this server.
            </p>
          ) : (
            <ul className="space-y-2">
              {warnings.map((warning) => (
                <li
                  key={warning.id}
                  className="flex items-start justify-between gap-3 rounded-xl border border-slate-800 bg-slate-950/60 px-4 py-3"
                >
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-slate-200">
                      <span className="font-mono text-xs text-slate-400">
                        {String(warning.discord_id)}
                      </span>
                      <span className="text-xs font-normal text-slate-500">
                        {formatDateTime(warning.created_at)}
                      </span>
                    </p>
                    <p className="mt-1 text-sm text-slate-400">
                      {warning.reason || 'No reason provided'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeWarning(warning.id)}
                    disabled={busy === `warning-${warning.id}`}
                    className="rounded p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300"
                    aria-label={`Delete warning ${warning.id}`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}
