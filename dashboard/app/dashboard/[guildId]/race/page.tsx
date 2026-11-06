'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ChevronRight,
  Flag,
  Hand,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  Trophy,
  Users,
} from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Field,
  PageHeader,
  ProgressBar,
  Spinner,
  Stat,
  TextArea,
  TextInput,
  Toggle,
} from '@/components/ui'
import { getRaceState, saveRaceState } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { NODES_PER_LAP } from '@/lib/constants'
import { clamp, isSnowflake, percent } from '@/lib/format'
import type { RaceState } from '@/lib/types'

function emptyRace(guildId: string): RaceState {
  return {
    guild_id: guildId,
    target_laps: 0,
    current_lap: 0,
    current_node: 0,
    task_description: 'No Active Node',
    ofa_holder_id: null,
    ofa_target: null,
    ofa_done: false,
    dyp_progress: 0,
    dyp_target: 0,
    dyp_contributors: [],
    je_progress: '0',
    je_target: '0',
    je_done: false,
    pending_ofa_message_id: null,
    pending_ofa_user_id: null,
    is_event_active: false,
  }
}

function num(value: string, fallback = 0): number {
  const parsed = Number.parseInt(value, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

export default function RacePage() {
  const { guildId } = useGuild()
  const [draft, setDraft] = useState<RaceState>(() => emptyRace(guildId))
  const [contributorsText, setContributorsText] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      try {
        const row = (await getRaceState(createClient(), guildId)) ?? emptyRace(guildId)
        setDraft(row)
        setContributorsText((row.dyp_contributors ?? []).join(', '))
      } catch (caught) {
        setFeedback({
          tone: 'red',
          text: caught instanceof Error ? caught.message : 'Could not load race state.',
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

  const update = <K extends keyof RaceState>(key: K, value: RaceState[K]) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const lap = draft.current_lap ?? 0
  const node = draft.current_node ?? 0
  const targetLaps = draft.target_laps ?? 0
  const dypProgress = draft.dyp_progress ?? 0
  const dypTarget = draft.dyp_target ?? 0
  const jeProgress = draft.je_progress ?? '0'
  const jeTarget = draft.je_target ?? '0'

  const nodeIsActive = useMemo(() => {
    const task = draft.task_description ?? ''
    return task.length > 0 && task !== 'No Active Node'
  }, [draft.task_description])

  const patchFromDraft = () => ({
    target_laps: draft.target_laps ?? 0,
    current_lap: draft.current_lap ?? 0,
    current_node: draft.current_node ?? 0,
    task_description: draft.task_description ?? 'No Active Node',
    ofa_holder_id: draft.ofa_holder_id ? String(draft.ofa_holder_id) : null,
    ofa_target: draft.ofa_target ?? null,
    ofa_done: Boolean(draft.ofa_done),
    dyp_progress: draft.dyp_progress ?? 0,
    dyp_target: draft.dyp_target ?? 0,
    dyp_contributors: contributorsText
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean),
    je_progress: draft.je_progress ?? '0',
    je_target: draft.je_target ?? '0',
    je_done: Boolean(draft.je_done),
    pending_ofa_message_id: draft.pending_ofa_message_id,
    pending_ofa_user_id: draft.pending_ofa_user_id,
    is_event_active: Boolean(draft.is_event_active),
  })

  const saveAll = async () => {
    if (draft.ofa_holder_id && !isSnowflake(String(draft.ofa_holder_id))) {
      setFeedback({ tone: 'red', text: 'OFA holder must be a valid Discord user ID (17–20 digits).' })
      return
    }
    setBusy('save')
    setFeedback(null)
    try {
      await saveRaceState(createClient(), guildId, patchFromDraft())
      setFeedback({ tone: 'green', text: 'Race state saved.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not save race state.',
      })
    } finally {
      setBusy(null)
    }
  }

  const resetTasks = () => ({
    task_description: 'No Active Node',
    ofa_holder_id: null,
    ofa_target: null,
    ofa_done: false,
    dyp_progress: 0,
    dyp_target: 0,
    dyp_contributors: [] as string[],
    je_progress: '0',
    je_target: '0',
    je_done: false,
    pending_ofa_message_id: null,
    pending_ofa_user_id: null,
  })

  const advanceNode = async () => {
    const nextNode = node + 1
    const nextLap = nextNode > NODES_PER_LAP ? lap + 1 : lap
    const normalisedNode = nextNode > NODES_PER_LAP ? 1 : nextNode
    setBusy('advance')
    setFeedback(null)
    try {
      await saveRaceState(createClient(), guildId, {
        current_lap: nextLap,
        current_node: normalisedNode,
        ...resetTasks(),
      })
      setDraft((current) => ({
        ...current,
        current_lap: nextLap,
        current_node: normalisedNode,
        ...resetTasks(),
      }))
      setContributorsText('')
      setFeedback({
        tone: 'green',
        text: `Advanced to lap ${nextLap}.${normalisedNode}. Fill in the new tasks.`,
      })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not advance the node.',
      })
    } finally {
      setBusy(null)
    }
  }

  const clearNode = async () => {
    if (!window.confirm('Clear the current node tasks without changing the lap or node?')) return
    setBusy('clear')
    setFeedback(null)
    try {
      await saveRaceState(createClient(), guildId, resetTasks())
      setDraft((current) => ({ ...current, ...resetTasks() }))
      setContributorsText('')
      setFeedback({ tone: 'green', text: 'Current node cleared.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not clear the node.',
      })
    } finally {
      setBusy(null)
    }
  }

  const resetRace = async () => {
    if (
      !window.confirm(
        'Reset the race to lap 0, node 0 and clear every task? The lap target is kept.',
      )
    ) {
      return
    }
    setBusy('reset')
    setFeedback(null)
    try {
      await saveRaceState(createClient(), guildId, {
        current_lap: 0,
        current_node: 0,
        ...resetTasks(),
      })
      setDraft((current) => ({ ...current, current_lap: 0, current_node: 0, ...resetTasks() }))
      setContributorsText('')
      setFeedback({ tone: 'green', text: 'Race progress reset.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not reset the race.',
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Race" description="Node progress and task tracking." />
        <Spinner label="Loading race state…" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Race tracker"
        title="Race"
        description="Mirror of the race state the bot reads from the database. Advancing a node resets its tasks, exactly like !race newnode."
        actions={
          <>
            <Button variant="secondary" onClick={() => load('refresh')}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="secondary" onClick={clearNode} loading={busy === 'clear'}>
              <RotateCcw className="h-4 w-4" />
              Clear node
            </Button>
            <Button onClick={advanceNode} loading={busy === 'advance'}>
              <ChevronRight className="h-4 w-4" />
              Advance node
            </Button>
          </>
        }
      />

      {feedback ? (
        <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      ) : null}

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat
          label="Current node"
          value={`Lap ${lap}.${node}`}
          hint={`${NODES_PER_LAP} nodes per lap`}
          icon={<Flag className="h-4 w-4" />}
          tone="purple"
        />
        <Stat
          label="Lap target"
          value={targetLaps > 0 ? targetLaps : 'Not set'}
          hint={targetLaps > 0 ? `${percent(lap, targetLaps).toFixed(0)}% of target` : 'Set a target below'}
          icon={<Target className="h-4 w-4" />}
          tone="green"
        />
        <Stat
          label="Event"
          value={draft.is_event_active ? 'Active' : 'Inactive'}
          hint={nodeIsActive ? 'Node has tasks' : 'No active node tasks'}
          icon={<Sparkles className="h-4 w-4" />}
          tone={draft.is_event_active ? 'amber' : 'slate'}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[0.85fr_1.15fr]">
        <Card>
          <CardHeader
            title="Progress"
            description="Lap, node and event state"
            icon={<Trophy className="h-5 w-5" />}
          />
          <CardBody className="space-y-5">
            <div className="grid grid-cols-2 gap-3">
              <Field label="Current lap">
                <TextInput
                  type="number"
                  min={0}
                  value={String(lap)}
                  onChange={(event) => update('current_lap', Math.max(0, num(event.target.value)))}
                />
              </Field>
              <Field label="Current node">
                <TextInput
                  type="number"
                  min={0}
                  max={NODES_PER_LAP}
                  value={String(node)}
                  onChange={(event) =>
                    update(
                      'current_node',
                      clamp(num(event.target.value), 0, NODES_PER_LAP),
                    )
                  }
                />
              </Field>
            </div>

            <Field label="Lap target" hint="0 means no target.">
              <TextInput
                type="number"
                min={0}
                value={String(targetLaps)}
                onChange={(event) => update('target_laps', Math.max(0, num(event.target.value)))}
              />
            </Field>

            {targetLaps > 0 ? (
              <ProgressBar value={lap} max={targetLaps} tone="green" label="Laps completed" />
            ) : null}

            <div className="border-t border-slate-800 pt-5">
              <Toggle
                checked={Boolean(draft.is_event_active)}
                onChange={(value) => update('is_event_active', value)}
                label="Race event active"
                description="Shown in the bot status embed."
              />
            </div>

            <div className="flex flex-wrap gap-2 border-t border-slate-800 pt-5">
              <Button onClick={saveAll} loading={busy === 'save'} className="flex-1">
                <Save className="h-4 w-4" />
                Save state
              </Button>
              <Button variant="danger" onClick={resetRace} loading={busy === 'reset'}>
                Reset progress
              </Button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Current node tasks"
            description="OFA, DYP and JE targets"
            icon={<Flag className="h-5 w-5" />}
            action={
              <Badge tone={nodeIsActive ? 'green' : 'slate'}>
                {nodeIsActive ? 'Node active' : 'No active node'}
              </Badge>
            }
          />
          <CardBody className="space-y-6">
            <Field
              label="Task description"
              hint="Use the same format as the bot: OFA: … | DYP: … | JE: …"
            >
              <TextArea
                value={draft.task_description ?? ''}
                onChange={(event) => update('task_description', event.target.value)}
                placeholder="OFA: hatch 50 eggs | DYP: breed 10 pets | JE: craft 5 items"
              />
            </Field>

            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Hand className="h-4 w-4 text-purple-300" /> One For All (OFA)
                </p>
                <Badge tone={draft.ofa_done ? 'green' : draft.ofa_holder_id ? 'amber' : 'slate'}>
                  {draft.ofa_done ? 'Done' : draft.ofa_holder_id ? 'Claimed' : 'Open'}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Holder Discord ID">
                  <TextInput
                    value={draft.ofa_holder_id ? String(draft.ofa_holder_id) : ''}
                    onChange={(event) =>
                      update('ofa_holder_id', event.target.value.trim() || null)
                    }
                    placeholder="e.g. 123456789012345678"
                    inputMode="numeric"
                  />
                </Field>
                <Field label="Target">
                  <TextInput
                    value={draft.ofa_target ?? ''}
                    onChange={(event) => update('ofa_target', event.target.value)}
                    placeholder="e.g. 50"
                  />
                </Field>
              </div>
              <Toggle
                checked={Boolean(draft.ofa_done)}
                onChange={(value) => update('ofa_done', value)}
                label="OFA completed"
              />
            </div>

            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Users className="h-4 w-4 text-emerald-300" /> Do Your Part (DYP)
                </p>
                <Badge tone={dypTarget > 0 && dypProgress >= dypTarget ? 'green' : 'slate'}>
                  {dypProgress}/{dypTarget}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Progress">
                  <TextInput
                    type="number"
                    min={0}
                    value={String(dypProgress)}
                    onChange={(event) =>
                      update('dyp_progress', Math.max(0, num(event.target.value)))
                    }
                  />
                </Field>
                <Field label="Target">
                  <TextInput
                    type="number"
                    min={0}
                    value={String(dypTarget)}
                    onChange={(event) =>
                      update('dyp_target', Math.max(0, num(event.target.value)))
                    }
                  />
                </Field>
              </div>
              <Field label="Contributors" hint="Comma separated. Matches the names the bot records.">
                <TextInput
                  value={contributorsText}
                  onChange={(event) => setContributorsText(event.target.value)}
                  placeholder="player one, player two"
                />
              </Field>
              {dypTarget > 0 ? (
                <ProgressBar value={dypProgress} max={dypTarget} tone="green" />
              ) : null}
            </div>

            <div className="space-y-4 rounded-xl border border-slate-800 bg-slate-950/50 p-4">
              <div className="flex items-center justify-between">
                <p className="flex items-center gap-2 text-sm font-semibold text-white">
                  <Sparkles className="h-4 w-4 text-amber-300" /> Joint Effort (JE)
                </p>
                <Badge tone={draft.je_done ? 'green' : 'slate'}>
                  {draft.je_done ? 'Done' : `${jeProgress}/${jeTarget}`}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Progress">
                  <TextInput
                    value={jeProgress}
                    onChange={(event) => update('je_progress', event.target.value)}
                    placeholder="e.g. 500K or 0"
                  />
                </Field>
                <Field label="Target">
                  <TextInput
                    value={jeTarget}
                    onChange={(event) => update('je_target', event.target.value)}
                    placeholder="e.g. 2M"
                  />
                </Field>
              </div>
              <Toggle
                checked={Boolean(draft.je_done)}
                onChange={(value) => update('je_done', value)}
                label="JE completed"
              />
            </div>

            <Button onClick={saveAll} loading={busy === 'save'} className="w-full">
              <Save className="h-4 w-4" />
              Save node & tasks
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
