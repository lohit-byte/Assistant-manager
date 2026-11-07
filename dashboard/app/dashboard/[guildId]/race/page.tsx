'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Activity, ChevronRight, ChevronDown, Flag, Hand, RefreshCw, Sparkles, Target, Trophy, Users, Check } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, ProgressBar, Spinner, Stat, TextInput, Divider } from '@/components/ui'
import { getRaceState, saveRaceState, listAliases } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { NODES_PER_LAP } from '@/lib/constants'
import { percent } from '@/lib/format'
import type { RaceState, Alias } from '@/lib/types'
import { useNow } from '@/lib/hooks'

interface RaceLog {
  id: number;
  player_name: string;
  action_type: string;
  created_at: string;
}

function emptyRace(guildId: string, channelId: string): RaceState {
  return {
    guild_id: guildId, channel_id: channelId, target_laps: 0, current_lap: 0, current_node: 0,
    task_description: 'No Active Node', ofa_holder_id: null, ofa_target: null,
    ofa_done: false, dyp_progress: 0, dyp_target: 0, dyp_contributors: [],
    je_progress: '0', je_target: '0', je_done: false,
    pending_ofa_message_id: null, pending_ofa_user_id: null, is_event_active: false,
    active_race_sheet: null,
  }
}

export default function RacePage() {
  const { guildId } = useGuild()
  const router = useRouter()
  const searchParams = useSearchParams()
  
  const channelId = searchParams.get('channel')
  const [availableChannels, setAvailableChannels] = useState<string[]>([])
  
  const now = useNow(15000) 
  const [draft, setDraft] = useState<RaceState | null>(null)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [logs, setLogs] = useState<RaceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null)

  const [sheets, setSheets] = useState<any[]>([])
  const [activeSheet, setActiveSheet] = useState<string | null>(null)
  const [jsonInput, setJsonInput] = useState(`{\n  "0.1": { "ofa": "Hatch 19", "dyp": "15 Collect 20k food", "je": "Breed 36 C" }\n}`)
  const [sheetName, setSheetName] = useState('')

  // Load channels
  useEffect(() => {
    const fetchChannels = async () => {
      const supabase = createClient()
      const { data } = await supabase.from('race_state').select('channel_id').eq('guild_id', guildId)
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
      if (!channelId) return
      if (mode === 'initial') setLoading(true)
      try {
        const supabase = createClient()
        const [row, aliasData, sheetData, logData] = await Promise.all([
          getRaceState(supabase, channelId),
          listAliases(supabase, guildId),
          supabase.from('race_sheets').select('name').eq('guild_id', guildId),
          supabase.from('race_logs').select('*').eq('guild_id', guildId).order('created_at', { ascending: false }).limit(15)
        ])
        
        setAliases(aliasData)
        setSheets(sheetData.data || [])
        setLogs(logData.data || [])
        
        const state = row ?? emptyRace(guildId, channelId)
        setDraft(state)
        setActiveSheet(state.active_race_sheet || null)
      } catch (caught) {
        setFeedback({ tone: 'red', text: 'Could not load race state.' })
      } finally {
        setLoading(false)
      }
    },
    [guildId, channelId],
  )

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    const interval = setInterval(() => { void load('refresh') }, 15000)
    return () => clearInterval(interval)
  }, [load])

  const contributorNames = useMemo(() => {
    if (!draft?.dyp_contributors) return []
    return draft.dyp_contributors.map((id: string) => {
      const found = aliases.find(a => String(a.discord_id) === String(id))
      return found ? found.alias_name : `User ${id}`
    })
  }, [draft?.dyp_contributors, aliases])

  const ofaName = useMemo(() => {
    if (!draft?.ofa_holder_id) return null
    const found = aliases.find(a => String(a.discord_id) === String(draft.ofa_holder_id))
    return found ? found.alias_name : `User ${draft.ofa_holder_id}`
  }, [draft?.ofa_holder_id, aliases])

  const updateTargetLaps = async () => {
    if (!channelId || !draft) return
    setBusy('target')
    try {
      await saveRaceState(createClient(), channelId, guildId, { target_laps: draft.target_laps })
      setFeedback({ tone: 'green', text: 'Lap target updated.' })
    } catch (e) { setFeedback({ tone: 'red', text: 'Could not save target.' }) } finally { setBusy(null) }
  }

  const uploadSheet = async () => {
    if (!sheetName || !jsonInput) return
    setBusy('sheet')
    try {
      const parsed = JSON.parse(jsonInput)
      const supabase = createClient()
      const { error } = await supabase.from('race_sheets').upsert({ guild_id: guildId, name: sheetName, data: parsed }, { onConflict: 'guild_id,name' })
      if (error) throw error
      setFeedback({ tone: 'green', text: `Sheet "${sheetName}" uploaded!` })
      setSheetName(''); load('refresh')
    } catch (e) { setFeedback({ tone: 'red', text: 'Invalid JSON.' }) } finally { setBusy(null) }
  }

  const selectSheet = async (name: string) => {
    if (!channelId) return
    setBusy('select')
    const supabase = createClient()
    await supabase.from('race_state').upsert({ channel_id: channelId, guild_id: guildId, active_race_sheet: name }, { onConflict: 'channel_id' })
    setActiveSheet(name)
    setFeedback({ tone: 'green', text: `Now using sheet: ${name}` })
    setBusy(null)
  }

  if (loading) return <div><PageHeader title="Race Tracker" /><Spinner label="Loading…" /></div>
  if (!channelId || !draft) return <div><PageHeader title="Race" /><EmptyState title="No active race" description="Start tracking in Discord with `!race target 20`." icon={<Trophy className="h-7 w-7" />} /></div>

  const lap = draft.current_lap ?? 0
  const node = draft.current_node ?? 0
  const targetLaps = draft.target_laps ?? 0
  const dypProgress = draft.dyp_progress ?? 0
  const dypTarget = draft.dyp_target ?? 0
  const jeProgress = draft.je_progress ?? '0'
  const jeTarget = draft.je_target ?? '0'

  return (
    <div>
      <PageHeader
        eyebrow="Race Live Tracker"
        title="Race"
        actions={
          <div className="flex items-center gap-2">
            {availableChannels.length > 0 && (
              <div className="relative">
                <select value={channelId} onChange={(e) => router.push(`?channel=${e.target.value}`)} className="appearance-none bg-slate-900 border border-slate-700 text-white text-sm rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:border-purple-500">
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

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Current Node" value={`Lap ${lap}.${node}`} hint={activeSheet ? `Sheet: ${activeSheet}` : 'No active sheet'} icon={<Flag className="h-4 w-4" />} tone="purple" />
        <Stat label="Lap Target" value={targetLaps > 0 ? targetLaps : 'Not set'} hint={targetLaps > 0 ? `${percent(lap, targetLaps).toFixed(0)}% of target` : 'Set a target below'} icon={<Target className="h-4 w-4" />} tone="green" />
        <Stat label="Recent Activity" value={logs.length > 0 ? `${logs.length} actions` : 'Quiet'} hint="See the feed below" icon={<Activity className="h-4 w-4" />} tone="amber" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_350px]">
        <div className="space-y-6">
          <Card>
            <CardHeader title="Current Node Tasks" description="Live view from Discord." icon={<Trophy className="h-5 w-5" />} />
            <CardBody className="space-y-6">
              <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800">
                <p className="text-xs uppercase text-slate-500 mb-2">Task Description</p>
                <p className="text-sm text-slate-200">{draft.task_description || 'No active node.'}</p>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white"><Hand className="h-4 w-4 text-purple-300" /> One For All (OFA)</p>
                  <Badge tone={draft.ofa_done ? 'green' : ofaName ? 'amber' : 'slate'}>{draft.ofa_done ? 'Done' : ofaName ? 'Claimed' : 'Open'}</Badge>
                </div>
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-sm">
                  {ofaName ? <span>Player <strong className="text-purple-300">{ofaName}</strong> {draft.ofa_done ? 'has completed this.' : 'is working on this.'}</span> : <span className="text-slate-500">Nobody has claimed this yet.</span>}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white"><Users className="h-4 w-4 text-emerald-300" /> Do Your Part (DYP)</p>
                  <span className="text-sm font-bold">{dypProgress} / {dypTarget}</span>
                </div>
                <ProgressBar value={dypProgress} max={dypTarget} tone="green" />
                <div className="flex flex-wrap gap-2 pt-2">
                  {contributorNames.length > 0 ? contributorNames.map((name: string, i: number) => <Badge key={i} tone="green">{name}</Badge>) : <span className="text-xs text-slate-500">No contributions logged yet.</span>}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white"><Sparkles className="h-4 w-4 text-amber-300" /> Joint Effort (JE)</p>
                  <Badge tone={draft.je_done ? 'green' : 'slate'}>{draft.je_done ? 'Done' : 'In Progress'}</Badge>
                </div>
                <div className="flex justify-between text-sm font-bold"><span>{jeProgress}</span><span className="text-slate-500">/ {jeTarget}</span></div>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Race Automation" description="Upload a community JSON sheet." icon={<ChevronRight className="h-5 w-5" />} />
            <CardBody className="space-y-6">
              <div className="flex items-end gap-3">
                <Field label="Team Lap Target" className="flex-1">
                  <TextInput type="number" value={String(targetLaps)} onChange={(e) => setDraft({...draft, target_laps: parseInt(e.target.value) || 0})} />
                </Field>
                <Button onClick={updateTargetLaps} loading={busy === 'target'} className="mb-0.5">Save Target</Button>
              </div>

              <Divider />

              <div className="space-y-4">
                <Field label="Active Node Sheet">
                  <select value={activeSheet || ''} onChange={(e) => selectSheet(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white">
                    <option value="" disabled>Select a sheet...</option>
                    {sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                  </select>
                </Field>

                <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
                  <Field label="Sheet Name">
                    <TextInput value={sheetName} onChange={e => setSheetName(e.target.value)} placeholder="e.g. Godzilla" />
                  </Field>
                  <Field label="Paste JSON Data">
                    <textarea value={jsonInput} onChange={e => setJsonInput(e.target.value)} className="w-full bg-slate-950 border border-slate-800 rounded-lg p-3 text-sm font-mono text-slate-300 h-24" />
                  </Field>
                </div>
                <Button onClick={uploadSheet} loading={busy === 'sheet'} disabled={!sheetName || !jsonInput} className="w-full">
                  Upload Sheet to Server
                </Button>
              </div>
            </CardBody>
          </Card>
        </div>

        <div>
          <Card className="h-full">
            <CardHeader title="Live Activity" description="Recent Discord commands." icon={<Activity className="h-5 w-5" />} />
            <CardBody className="p-0">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">No activity yet.</div>
              ) : (
                <ul className="divide-y divide-slate-800/50">
                  {logs.map((log) => {
                    const actionMap: Record<string, { label: string, color: string }> = {
                      ofa_claim: { label: 'Claimed OFA', color: 'text-purple-300' },
                      ofa_done: { label: 'Completed OFA', color: 'text-emerald-300' },
                      dyp_done: { label: 'Logged DYP', color: 'text-blue-300' },
                      je_done: { label: 'Logged JE', color: 'text-amber-300' },
                    }
                    const action = actionMap[log.action_type] || { label: log.action_type, color: 'text-slate-300' }
                    return (
                      <li key={log.id} className="p-4 flex items-start gap-3 hover:bg-slate-800/20 transition-colors">
                        <div className={`mt-0.5 p-1.5 rounded-full bg-slate-800 ${action.color}`}><Check className="w-3 h-3" /></div>
                        <div>
                          <p className="text-sm"><strong className="text-white">{log.player_name}</strong> <span className="text-slate-400"> {action.label}</span></p>
                          <p className="text-xs text-slate-500 mt-0.5">{new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
