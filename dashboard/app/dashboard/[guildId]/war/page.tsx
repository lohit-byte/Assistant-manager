'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  AlertTriangle, Ban, Clock, Plus, RefreshCw, Save, Swords, Trash2, UserMinus, Users, X, ChevronDown
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import {
  Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState,
  Field, PageHeader, ProgressBar, Spinner, Stat, TextInput, Toggle,
} from '@/components/ui'
import {
  endWar, getWar, getWarSettings, saveWarSettings, updateWar, listWarnings, deleteWarning, addWarning
} from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_ATTACKS_REQUIRED, MAX_ATTACKS_REQUIRED } from '@/lib/constants'
import {
  formatDateTime, formatDuration, formatRelative, getWarWindow, isSnowflake, warPhaseLabel,
} from '@/lib/format'
import { useNow } from '@/lib/hooks'
import type { War, WarSettings, Warning } from '@/lib/types'

type Feedback = { tone: 'green' | 'red'; text: string } | null

// --- NEW LIVE TIMER ---
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
    <div className={`p-6 rounded-2xl border flex flex-col items-center justify-center transition-colors ${isCritical ? 'bg-red-500/10 border-red-500/50 animate-pulse' : isUrgent ? 'bg-amber-500/10 border-amber-500/50' : 'bg-slate-950/60 border-slate-800'}`}>
      <p className="text-xs text-slate-400 uppercase tracking-widest mb-1">Time Remaining</p>
      <p className={`text-5xl font-black font-mono tracking-tighter ${isCritical ? 'text-red-500' : isUrgent ? 'text-amber-400' : 'text-white'}`}>
        {String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}:{String(s).padStart(2, '0')}
      </p>
    </div>
  )
}
// ----------------------

export default function WarPage() {
  const { guildId } = useGuild()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const channelId = searchParams.get('channel') // Get channel from URL
  
  // If no channel is set, fetch the first active one available
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [war, setWar] = useState<War | null>(null)

  const now = useNow(15000)

  const [settings, setSettings] = useState<WarSettings>({ guild_id: guildId, attacks_required: 6, exempt_absent: true })
  const [warnings, setWarnings] = useState<Warning[]>([])
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  const [missingInput, setMissingInput] = useState('')
  const [excusedInput, setExcusedInput] = useState('')

  // Load available channels for this server (using active wars as a proxy)
  useEffect(() => {
    const fetchChannels = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('wars').select('channel_id').eq('guild_id', guildId).eq('is_active', true)
      if (data) {
        const uniqueIds = Array.from(new Set(data.map(d => String(d.channel_id))))
        setAvailableChannels(uniqueIds)
        // Auto-select first channel if none is selected
        if (!channelId && uniqueIds.length > 0) {
          router.replace(`?channel=${uniqueIds[0]}`)
        }
      }
      setLoading(false)
    }
    fetchChannels()
  }, [guildId, channelId, router])

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!channelId) return
      if (mode === 'initial') setLoading(true)
      const supabase = createClient()
      try {
        const [nextSettings, nextWar] = await Promise.all([
          getWarSettings(supabase, guildId),
          getWar(supabase, channelId)
        ])
        setSettings(nextSettings)
        setWar(nextWar)
        if (nextWar) {
          setCounts(Object.fromEntries(Object.entries(nextWar.attack_counts ?? {}).map(([name, value]) => [name.toLowerCase(), String(value)])))
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

  if (!channelId) {
    return (
      <div>
        <PageHeader title="War" description="Select a team to view." />
        <EmptyState
          icon={<Swords className="h-7 w-7" />}
          title="No active wars"
          description="You haven't started any wars yet. Go to Discord and type `!war defence ends 24h` in a channel to start tracking."
        />
      </div>
    )
  }

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

  return (
    <div>
      <PageHeader
        eyebrow="War Tracker (Multi-Team)"
        title="War"
        actions={
          <div className="flex items-center gap-2">
            {/* TEAM SELECTOR DROPDOWN */}
            <div className="relative">
              <select 
                value={channelId}
                onChange={(e) => router.push(`?channel=${e.target.value}`)}
                className="appearance-none bg-slate-900 border border-slate-700 text-white text-sm rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:border-purple-500"
              >
                {availableChannels.map(id => (
                  <option key={id} value={id}>Team Channel ({id})</option>
                ))}
              </select>
              <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
            </div>

            <Button variant="secondary" onClick={() => load('refresh')}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        }
      />

      {feedback && <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>{feedback.text}</Alert>}

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <div className="space-y-6">
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
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Missing</p><p className="mt-1 text-xl font-bold text-amber-300">{missing.length}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Excused</p><p className="mt-1 text-xl font-bold text-sky-300">{excused.length}</p></div>
                    <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-3"><p className="text-xs text-slate-500">Logged</p><p className="mt-1 text-xl font-bold text-white">{Object.keys(counts).length}</p></div>
                  </div>
                </>
              ) : <EmptyState icon={<Swords className="h-7 w-7" />} title="No active war for this channel" />}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-6">
           <Card>
            <CardHeader title="War Settings (Global)" icon={<Save className="h-5 w-5" />} />
            <CardBody className="space-y-6">
              <Field label="Required Attacks">
                <div className="flex items-center gap-4">
                  <input type="range" min="1" max={MAX_ATTACKS_REQUIRED} value={settings.attacks_required} onChange={(e) => setSettings({...settings, attacks_required: parseInt(e.target.value)})} className="w-full accent-purple-500" />
                  <div className="flex h-10 w-12 items-center justify-center rounded-lg border border-slate-700 bg-slate-950 text-lg font-bold text-purple-300">{settings.attacks_required}</div>
                </div>
              </Field>
              <Button onClick={saveSettings} loading={busy === 'settings'} className="w-full">Save Settings</Button>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
