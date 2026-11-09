'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Activity, Check, ChevronDown, ChevronRight, Flag, Hand, RefreshCw, Sparkles, Target, Trophy, Users } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { Alert, Badge, Button, Card, CardBody, CardHeader, Divider, EmptyState, Field, PageHeader, ProgressBar, Spinner, Stat, TextInput } from '@/components/ui'
import { getRaceState, listAliases, listRaceLogs, saveRaceState } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { NODES_PER_LAP } from '@/lib/constants'
import { formatDateTime, percent } from '@/lib/format'
import { parseNodeSheet } from '@/lib/node-sheet'
import type { RaceLog, RaceState, Alias } from '@/lib/types'
import { useNow } from '@/lib/hooks'

/** "default" and empty both mean the bundled nodesheet.json shipped with the bot. */
const BUNDLED_SHEET = '__bundled__'

const ACTION_META: Record<string, { label: string; color: string }> = {
  ofa_claim: { label: 'Claimed OFA', color: 'text-accent-300' },
  ofa_done: { label: 'Completed OFA', color: 'text-sage-400' },
  dyp_done: { label: 'Logged DYP', color: 'text-steel-300' },
  je_done: { label: 'Completed JE', color: 'text-warn-300' },
  je_add: { label: 'Added JE', color: 'text-warn-300' },
}

function isBundledSheet(name: string | null | undefined): boolean {
  if (!name) return true
  const clean = name.trim().toLowerCase()
  return clean === '' || clean === 'default' || clean === 'bundled'
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
  const { guildId, isStaff, canManageChannel } = useGuild()
  const router = useRouter()
  const searchParams = useSearchParams()

  const channelId = searchParams.get('channel')
  // Staff edit everywhere; captains only on the race channel of the team they captain.
  const canManage = canManageChannel(channelId)

  const [availableChannels, setAvailableChannels] = useState<string[]>([])

  const now = useNow(15000)
  const [draft, setDraft] = useState<RaceState | null>(null)
  const [aliases, setAliases] = useState<Alias[]>([])
  const [logs, setLogs] = useState<RaceLog[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'amber' | 'red'; text: string } | null>(null)

  const [sheets, setSheets] = useState<{ name: string }[]>([])
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
          // Only this channel's activity: per-team feed, not the whole server.
          listRaceLogs(supabase, guildId, channelId, null).catch(() => []),
        ])

        setAliases(aliasData)
        setSheets(sheetData.data || [])
        setLogs(logData)

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
      // Same validation as the bot's per-server upload: accept a `{nodes}` wrapper, skip
      // malformed nodes with a warning, and only reject a payload that is not an object.
      let payload: unknown
      try {
        payload = JSON.parse(jsonInput)
      } catch {
        throw new Error('Invalid JSON — check the brackets and quotes.')
      }
      const { nodes, warnings } = parseNodeSheet(payload)
      const nodeCount = Object.keys(nodes).length
      if (nodeCount === 0) {
        throw new Error(
          warnings[0] ?? 'No usable nodes found. Each node needs `lap.node` keys with ofa, dyp and je strings.',
        )
      }

      const supabase = createClient()
      const { error } = await supabase
        .from('race_sheets')
        .upsert({ guild_id: guildId, name: sheetName, data: nodes }, { onConflict: 'guild_id,name' })
      if (error) throw error

      if (warnings.length > 0) {
        setFeedback({
          tone: 'amber',
          text: `Sheet "${sheetName}" uploaded with ${nodeCount} node${nodeCount === 1 ? '' : 's'}; ${warnings.length} skipped: ${warnings.slice(0, 3).join(' ')}`,
        })
      } else {
        setFeedback({ tone: 'green', text: `Sheet "${sheetName}" uploaded with ${nodeCount} node${nodeCount === 1 ? '' : 's'}!` })
      }
      setSheetName('')
      load('refresh')
    } catch (e) {
      setFeedback({ tone: 'red', text: e instanceof Error ? e.message : 'Could not upload the sheet.' })
    } finally {
      setBusy(null)
    }
  }

  const selectSheet = async (value: string) => {
    if (!channelId) return
    setBusy('select')
    try {
      if (value === BUNDLED_SHEET) {
        // Empty `active_race_sheet` is exactly what the bot reads as "use the bundled sheet".
        await saveRaceState(createClient(), channelId, guildId, { active_race_sheet: null })
        setActiveSheet(null)
        setFeedback({ tone: 'green', text: 'Now using the default (bundled) node sheet.' })
      } else {
        await saveRaceState(createClient(), channelId, guildId, { active_race_sheet: value })
        setActiveSheet(value)
        setFeedback({ tone: 'green', text: `Now using sheet: ${value}` })
      }
    } catch (e) {
      setFeedback({ tone: 'red', text: 'Could not select the sheet.' })
    } finally {
      setBusy(null)
    }
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
  const bundled = isBundledSheet(activeSheet)

  return (
    <div>
      <PageHeader
        eyebrow="Race Live Tracker"
        title="Race"
        actions={
          <div className="flex items-center gap-2">
            {availableChannels.length > 0 && (
              <div className="relative">
                <select value={channelId} onChange={(e) => router.push(`?channel=${e.target.value}`)} className="appearance-none bg-slate-900 border border-slate-700 text-slate-50 text-sm rounded-lg pl-4 pr-10 py-2 focus:outline-none focus:border-accent-500">
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
        <Stat
          label="Current Node"
          value={`Lap ${lap}.${node}`}
          hint={bundled ? 'Sheet: default (bundled)' : `Sheet: ${activeSheet}`}
          icon={<Flag className="h-4 w-4" />}
          tone="purple"
        />
        <Stat label="Lap Target" value={targetLaps > 0 ? targetLaps : 'Not set'} hint={targetLaps > 0 ? `${percent(lap, targetLaps).toFixed(0)}% of target` : canManage ? 'Set a target below' : 'Staff managed'} icon={<Target className="h-4 w-4" />} tone="green" />
        <Stat label="Recent Activity" value={logs.length > 0 ? `${logs.length} actions` : 'Quiet'} hint="This channel only" icon={<Activity className="h-4 w-4" />} tone="amber" />
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
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-50"><Hand className="h-4 w-4 text-accent-300" /> One For All (OFA)</p>
                  <Badge tone={draft.ofa_done ? 'green' : ofaName ? 'amber' : 'slate'}>{draft.ofa_done ? 'Done' : ofaName ? 'Claimed' : 'Open'}</Badge>
                </div>
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-sm">
                  {ofaName ? <span>Player <strong className="text-accent-300">{ofaName}</strong> {draft.ofa_done ? 'has completed this.' : 'is working on this.'}</span> : <span className="text-slate-500">Nobody has claimed this yet.</span>}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-50"><Users className="h-4 w-4 text-sage-400" /> Do Your Part (DYP)</p>
                  <span className="text-sm font-bold">{dypProgress} / {dypTarget}</span>
                </div>
                <ProgressBar value={dypProgress} max={dypTarget} tone="green" />
                <div className="flex flex-wrap gap-2 pt-2">
                  {contributorNames.length > 0 ? contributorNames.map((name: string, i: number) => <Badge key={i} tone="green">{name}</Badge>) : <span className="text-xs text-slate-500">No contributions logged yet.</span>}
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="flex items-center gap-2 text-sm font-semibold text-slate-50"><Sparkles className="h-4 w-4 text-warn-300" /> Joint Effort (JE)</p>
                  <Badge tone={draft.je_done ? 'green' : 'slate'}>{draft.je_done ? 'Done' : 'In Progress'}</Badge>
                </div>
                <div className="flex justify-between text-sm font-bold"><span>{jeProgress}</span><span className="text-slate-500">/ {jeTarget}</span></div>
              </div>
            </CardBody>
          </Card>

          {canManage ? (
            <Card>
              <CardHeader title="Race Automation" description="Choose the node sheet and, for staff, upload a community JSON sheet." icon={<ChevronRight className="h-5 w-5" />} />
              <CardBody className="space-y-6">
                <div className="flex items-end gap-3">
                  <Field label="Team Lap Target" className="flex-1">
                    <TextInput type="number" value={String(targetLaps)} onChange={(e) => setDraft({...draft, target_laps: parseInt(e.target.value) || 0})} />
                  </Field>
                  <Button onClick={updateTargetLaps} loading={busy === 'target'} className="mb-0.5">Save Target</Button>
                </div>

                <Divider />

                <div className="space-y-4">
                  <Field
                    label="Active Node Sheet"
                    hint="“default (bundled)” is the sheet shipped with the bot. Server sheets override it."
                  >
                    <select
                      value={bundled ? BUNDLED_SHEET : activeSheet ?? BUNDLED_SHEET}
                      onChange={(e) => void selectSheet(e.target.value)}
                      disabled={busy === 'select'}
                      className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-slate-50"
                    >
                      <option value={BUNDLED_SHEET}>default (bundled)</option>
                      {sheets.map(s => <option key={s.name} value={s.name}>{s.name}</option>)}
                    </select>
                  </Field>

                  {isStaff ? (
                    <>
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
                    </>
                  ) : (
                    <p className="text-xs text-slate-500">
                      Uploading a guild-wide sheet is limited to staff. Captains pick the sheet for
                      their team.
                    </p>
                  )}
                </div>
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div>
          <Card className="h-full">
            <CardHeader title="Live Activity" description="Recent actions in this channel." icon={<Activity className="h-5 w-5" />} />
            <CardBody className="p-0">
              {logs.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500">No activity yet.</div>
              ) : (
                <ul className="divide-y divide-slate-800/50 max-h-[560px] overflow-y-auto">
                  {logs.slice(0, 20).map((log) => {
                    const action = ACTION_META[log.action_type] || { label: log.action_type, color: 'text-slate-300' }
                    const nodeLabel =
                      log.lap !== null && log.lap !== undefined && log.node !== null && log.node !== undefined
                        ? `lap ${log.lap}.${log.node}`
                        : null
                    return (
                      <li key={log.id} className="p-4 flex items-start gap-3 hover:bg-slate-800/20 transition-colors">
                        <div className={`mt-0.5 p-1.5 rounded-full bg-slate-800 ${action.color}`}><Check className="w-3 h-3" /></div>
                        <div>
                          <p className="text-sm"><strong className="text-slate-50">{log.player_name || `User ${log.discord_id ?? '—'}`}</strong> <span className="text-slate-400"> {action.label}</span></p>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {formatDateTime(log.created_at)}
                            {nodeLabel ? ` · ${nodeLabel}` : ''}
                          </p>
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

      <div className="mt-6 flex flex-wrap gap-4 text-xs text-slate-600">
        <span>{NODES_PER_LAP} nodes per lap</span>
        <span className="flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" /> Auto-refreshes every 15 seconds</span>
        <span>Updated {now.toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
