'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, Ban, Clock, Plus, RefreshCw, Save, Swords, UserMinus, Users, X, ChevronDown, Trash2
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, PageHeader, ProgressBar, Spinner, Stat, TextInput, Toggle,
} from '@/components/ui'
import {
  endWar, getWar, getWarSettings, saveWarSettings, updateWar, listWarnings, deleteWarning, addWarning, listAliases
} from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_ATTACKS_REQUIRED, MAX_ATTACKS_REQUIRED } from '@/lib/constants'
import {
  formatDateTime, formatDuration, formatRelative, getWarWindow, isSnowflake, warPhaseLabel,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { War, WarSettings, Warning, Alias } from '@/lib/types'

type Feedback = { tone: 'green' | 'red'; text: string } | null

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
  const { guildId, readOnly } = useGuild()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const channelId = searchParams.get('channel')
  
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [war, setWar] = useState<War | null>(null)
  const now = useNow(15000)

  const [settings, setSettings] = useState<WarSettings>({ guild_id: guildId, attacks_required: 6, exempt_absent: true })
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [aliases, setAliases] = useState<Alias[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [missingInput, setMissingInput] = useState('')
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
          listAliases(supabase, guildId)
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
          }
        }
      } catch (caught) {
        setFeedback({ tone: 'red', text: 'Could not load war data.' })
      } finally {
        setLoading(false)
      }
    },
    [guildId, channelId],
  )

  useEffect(() => { void load() }, [load])

  const warWindow = getWarWindow(war)
  const missing = war?.missing_list ?? []
  const excused = war?.absent_list ?? []
  const required = settings.attacks_required
  const excusedNames = useMemo(() => new Set(excused.map((entry) => entry.name.toLowerCase())), [excused])
  
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
      setFeedback({ tone: 'green', text: 'War settings saved.' })
    } catch (caught) { setFeedback({ tone: 'red', text: 'Could not save.' }) } finally { setBusy(null) }
  }

  const submitWarning = async () => {
    if (!warningId) return setFeedback({ tone: 'red', text: 'Please select a player to warn.' })
    setBusy('warning')
    try {
      await addWarning(createClient(), guildId, warningId, warningReason, null)
      setWarnings(await listWarnings(createClient(), guildId))
      setWarningId(''); setWarningReason('')
      setFeedback({ tone: 'green', text: 'Warning recorded successfully.' })
    } catch (e) { setFeedback({ tone: 'red', text: 'Could not record warning.' }) } finally { setBusy(null) }
  }

  const removeWarning = async (id: number) => {
    setBusy(`warn-${id}`)
    await deleteWarning(createClient(), guildId, id)
    setWarnings((current) => current.filter((w) => w.id !== id))
    setBusy(null)
  }

  if (loading) return <div><PageHeader title="War" /><Spinner label="Loading…" /></div>

  return (
    <div>
      <PageHeader
        eyebrow="War Tracker (Multi-Team)"
        title="War"
        actions={
          <div className="flex items-center gap-2">
            {availableChannels.length > 0 && (
              <div className="relative">
                <select 
                  value={channelId || ''}
                  onChange={(e) => router.push(`?channel=${e.target.value}`)}
                  className="appearance-none bg-slate-900 border border-slate-700 text-slate-50 text-sm rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:border-accent-500"
                >
                  {availableChannels.map(id => <option key={id} value={id}>Team Channel ({id})</option>)}
                </select>
                <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              </div>
            )}
            <Button variant="secondary" onClick={() => load('refresh')}><RefreshCw className="h-4 w-4" /></Button>
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
                        <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Logged</p><p className="mt-1 text-xl font-bold text-slate-50">{Object.keys(counts).length}</p></div>
                      </div>
                    </>
                  ) : <EmptyState icon={<Swords className="h-7 w-7" />} title="No active war for this channel" />}
                </CardBody>
              </Card>

              {war && war.is_active && (
                <>
                  <Card>
                    <CardHeader title="Attack Log" description={`Required: ${required} attacks per player`} icon={<Swords className="h-5 w-5" />} />
                    <CardBody className="space-y-4">
                      {readOnly ? null : (
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <TextInput placeholder="Player alias" value={missingInput} onChange={(e) => setMissingInput(e.target.value)} className="sm:flex-1" />
                          <Button onClick={() => {
                            if(!missingInput || !war) return
                            const nextMissing = [...missing, { name: missingInput.toLowerCase() }]
                            updateWar(createClient(), channelId, { missing_list: nextMissing }).then(() => { setMissingInput(''); load('refresh') })
                          }}>Add Missing</Button>
                        </div>
                      )}
                      <div className="max-h-[300px] overflow-y-auto">
                        <table className="w-full text-left text-sm">
                          <tbody className="divide-y divide-slate-800">
                            {trackedNames.map((name) => {
                              const value = parseInt(counts[name] || '0')
                              const isExcused = settings.exempt_absent && excusedNames.has(name)
                              return (
                                <tr key={name} className="hover:bg-slate-800/30">
                                  <td className="px-3 py-2 font-medium text-slate-200">{name}</td>
                                  <td className="px-3 py-2 text-right">
                                    {isExcused ? <Badge tone="blue">Excused</Badge> : value >= required ? <Badge tone="green">Met</Badge> : <Badge tone="amber">Missing</Badge>}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardBody>
                  </Card>
                </>
              )}
            </>
          )}
        </div>

        {/* RIGHT COLUMN: GLOBAL SETTINGS & WARNINGS */}
        <div className="space-y-6">
           {readOnly ? (
            <Card>
              <CardHeader title="War Settings (Global)" icon={<Save className="h-5 w-5" />} />
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
            <CardHeader title="War Settings (Global)" icon={<Save className="h-5 w-5" />} />
            <CardBody className="space-y-6">
              <Field label="Required Attacks">
                <div className="flex items-center gap-4">
                  <input type="range" min="1" max={MAX_ATTACKS_REQUIRED} value={settings.attacks_required} onChange={(e) => setSettings({...settings, attacks_required: parseInt(e.target.value)})} className="w-full accent-accent-500" />
                  <div className="flex h-10 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-lg font-bold text-accent-300">{settings.attacks_required}</div>
                </div>
              </Field>
              <Button onClick={saveSettings} loading={busy === 'settings'} className="w-full">Save Settings</Button>
            </CardBody>
          </Card>
          )}

          <Card>
            <CardHeader title="Warnings (Global)" description={readOnly ? 'Recorded warnings — staff manage these' : 'Manage player warnings'} icon={<AlertTriangle className="h-5 w-5" />} />
            <CardBody className="space-y-4">
              
              {/* NEW ALIAS DROPDOWN */}
              {readOnly ? null : (
                <div className="space-y-3">
                  <select 
                    value={warningId} 
                    onChange={(e) => setWarningId(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-slate-50 focus:border-accent-500"
                  >
                    <option value="" disabled>Select a player (alias)...</option>
                    {aliases.map(a => (
                      <option key={a.id} value={String(a.discord_id)}>
                        {a.alias_name} ({a.discord_id})
                      </option>
                    ))}
                  </select>
                  
                  <TextInput placeholder="Reason for warning..." value={warningReason} onChange={e => setWarningReason(e.target.value)} />
                  
                  <Button onClick={submitWarning} loading={busy === 'warning'} className="w-full">
                    <Plus className="h-4 w-4 mr-2" /> Add Warning
                  </Button>
                </div>
              )}

              <div className="mt-6 space-y-2">
                <h4 className="text-sm font-semibold text-slate-300 mb-2">Recorded Warnings</h4>
                {warnings.length === 0 ? (
                  <p className="text-sm text-slate-500">No warnings recorded yet.</p>
                ) : (
                  warnings.map(w => {
                    const player = aliases.find(a => String(a.discord_id) === String(w.discord_id))
                    const displayName = player ? player.alias_name : `User ${w.discord_id}`
                    return (
                      <li key={w.id} className="flex justify-between items-center bg-slate-950/60 px-3 py-2 rounded-lg border border-slate-800">
                        <div>
                          <p className="text-sm font-semibold text-slate-50">{displayName}</p>
                          <p className="text-xs text-slate-500">{w.reason}</p>
                        </div>
                        {readOnly ? null : (
                          <button onClick={() => removeWarning(w.id)} className="text-slate-500 hover:text-danger-400"><Trash2 className="h-4 w-4" /></button>
                        )}
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
