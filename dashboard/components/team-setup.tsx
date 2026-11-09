'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, Settings, Trash2, UserRound, Users, X } from 'lucide-react'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Divider,
  EmptyState,
  Field,
  Select,
  TextInput,
} from '@/components/ui'
import {
  addTeamCaptain,
  createTeam,
  deleteTeam,
  removeTeamCaptain,
  saveTeam,
  type TeamValues,
} from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { isSnowflake } from '@/lib/format'
import type { Alias, Guild, Team, TeamCaptain } from '@/lib/types'

export interface TeamSetupProps {
  guild: Guild
  teams: Team[]
  /** Captain rows grouped by team id. */
  captainsByTeam: Record<number, TeamCaptain[]>
  aliases: Alias[]
  detectedWarChannels: string[]
  detectedRaceChannels: string[]
  /** Reload the guild row and the teams snapshot after every write. */
  onChanged: () => Promise<void> | void
}

interface TeamDraft {
  name: string
  war_channel_id: string
  race_channel_id: string
  team_role_id: string
}

interface EditorState {
  /** Null while creating a new team. */
  team: Team | null
  draft: TeamDraft
}

type Feedback = { tone: 'green' | 'red'; text: string } | null

function valuesFromTeam(team?: Team | null): TeamDraft {
  const channel = (id: Team['war_channel_id']) =>
    id !== null && id !== undefined ? String(id) : ''
  return {
    name: team?.name ?? '',
    war_channel_id: channel(team?.war_channel_id ?? null),
    race_channel_id: channel(team?.race_channel_id ?? null),
    team_role_id: channel(team?.team_role_id ?? null),
  }
}

/** Channel ids are Discord snowflakes; empty means "not linked". */
function validateChannelId(value: string, label: string): string | null {
  const clean = value.trim()
  if (!clean) return null
  if (!isSnowflake(clean)) return `${label} must be a Discord ID (17–20 digits), or empty.`
  return null
}

function aliasForCaptain(aliases: Alias[], captain: TeamCaptain): string | null {
  const found = aliases.find((alias) => String(alias.discord_id) === String(captain.discord_id))
  return found ? found.alias_name : null
}

/**
 * Staff-only "Server & team setup" card: the guild-level fields that used to live on the
 * Settings page, plus the teams that pair a war channel with a race channel and own captains.
 * Detected channels the bot already tracks can be imported as a half team.
 */
export function TeamSetup({
  guild,
  teams,
  captainsByTeam,
  aliases,
  detectedWarChannels,
  detectedRaceChannels,
  onChanged,
}: TeamSetupProps) {
  const [staffRole, setStaffRole] = useState(guild.staff_role_id ? String(guild.staff_role_id) : '')
  const [mazeChannel, setMazeChannel] = useState(
    guild.maze_channel_id ? String(guild.maze_channel_id) : '',
  )
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [captainAlias, setCaptainAlias] = useState('')
  const [captainId, setCaptainId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)

  // The parent refreshes the guild row after a save; keep the server fields in sync with it.
  useEffect(() => {
    setStaffRole(guild.staff_role_id ? String(guild.staff_role_id) : '')
    setMazeChannel(guild.maze_channel_id ? String(guild.maze_channel_id) : '')
  }, [guild.maze_channel_id, guild.staff_role_id])

  const maxTeams = guild.max_teams ?? 1
  const atTeamLimit = teams.length >= maxTeams
  const detectedCount = detectedWarChannels.length + detectedRaceChannels.length

  const availableCaptainAliases = useMemo(() => {
    const teamId = editor?.team?.id
    const taken = new Set(
      (teamId !== undefined ? captainsByTeam[teamId] ?? [] : []).map((captain) =>
        String(captain.discord_id),
      ),
    )
    return aliases.filter((alias) => !taken.has(String(alias.discord_id)))
  }, [aliases, captainsByTeam, editor?.team?.id])

  const openNew = (prefill?: { war?: string; race?: string }) => {
    setFeedback(null)
    setCaptainAlias('')
    setCaptainId('')
    setEditor({
      team: null,
      draft: {
        name: `Team ${teams.length + 1}`,
        war_channel_id: prefill?.war ?? '',
        race_channel_id: prefill?.race ?? '',
        team_role_id: '',
      },
    })
  }

  const openEdit = (team: Team) => {
    setFeedback(null)
    setCaptainAlias('')
    setCaptainId('')
    setEditor({ team, draft: valuesFromTeam(team) })
  }

  const updateDraft = (patch: Partial<TeamDraft>) => {
    setEditor((current) => (current ? { ...current, draft: { ...current.draft, ...patch } } : current))
  }

  const reload = async () => {
    await onChanged()
  }

  const saveServer = async () => {
    setFeedback(null)
    const roleError = validateChannelId(staffRole, 'Staff role ID')
    const mazeError = validateChannelId(mazeChannel, 'Maze channel ID')
    if (roleError || mazeError) {
      setFeedback({ tone: 'red', text: roleError ?? mazeError ?? 'Check the IDs.' })
      return
    }

    setBusy('server')
    try {
      const { error } = await createClient()
        .from('guilds')
        .update({
          staff_role_id: staffRole.trim() || null,
          maze_channel_id: mazeChannel.trim() || null,
        })
        .eq('guild_id', guild.guild_id)
      if (error) throw new Error(error.message)
      await reload()
      setFeedback({ tone: 'green', text: 'Server settings saved.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not save the server settings.',
      })
    } finally {
      setBusy(null)
    }
  }

  const saveEditor = async () => {
    if (!editor) return
    setFeedback(null)
    const values = editor.draft
    const name = values.name.trim()
    const channelError =
      validateChannelId(values.war_channel_id, 'War channel ID') ??
      validateChannelId(values.race_channel_id, 'Race channel ID') ??
      validateChannelId(values.team_role_id, 'Team role ID')
    if (!name || channelError) {
      setFeedback({ tone: 'red', text: channelError ?? 'Enter a team name.' })
      return
    }

    setBusy('team-save')
    try {
      const supabase = createClient()
      const guildId = String(guild.guild_id)
      if (editor.team) {
        await saveTeam(supabase, editor.team, { ...values, name })
      } else {
        await createTeam(supabase, guildId, { ...values, name })
      }
      setEditor(null)
      await reload()
      setFeedback({ tone: 'green', text: `Team “${name}” saved.` })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not save the team.',
      })
    } finally {
      setBusy(null)
    }
  }

  const removeTeam = async (team: Team) => {
    if (
      !window.confirm(
        `Delete “${team.name}”? Its war and race data is kept — only the team and its captains are removed.`,
      )
    ) {
      return
    }
    setBusy(`delete-${team.id}`)
    setFeedback(null)
    try {
      await deleteTeam(createClient(), team.id)
      setEditor(null)
      await reload()
      setFeedback({ tone: 'green', text: `Team “${team.name}” deleted.` })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not delete the team.',
      })
    } finally {
      setBusy(null)
    }
  }

  const addCaptain = async (value: string) => {
    if (!editor?.team) return
    setBusy('captain-add')
    setFeedback(null)
    try {
      await addTeamCaptain(createClient(), String(guild.guild_id), editor.team.id, value)
      setCaptainAlias('')
      setCaptainId('')
      await reload()
      setFeedback({ tone: 'green', text: 'Captain added. They can now manage this team’s channels.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not add the captain.',
      })
    } finally {
      setBusy(null)
    }
  }

  const removeCaptain = async (captain: TeamCaptain) => {
    if (!editor?.team) return
    setBusy(`captain-${captain.discord_id}`)
    setFeedback(null)
    try {
      await removeTeamCaptain(createClient(), editor.team.id, String(captain.discord_id))
      await reload()
      setFeedback({ tone: 'green', text: 'Captain removed.' })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not remove the captain.',
      })
    } finally {
      setBusy(null)
    }
  }

  const renderEditor = (current: EditorState, isNew: boolean) => {
    const team = current.team
    const drafts = current.draft
    const captains = team ? captainsByTeam[team.id] ?? [] : []

    return (
      <div className="mt-4 space-y-4 border border-white/[0.1] bg-ink-950/50 p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="mono-label text-accent-400">{isNew ? 'New team' : 'Edit team'}</p>
          <button
            type="button"
            onClick={() => setEditor(null)}
            className="p-1 text-slate-500 transition-colors hover:text-slate-100"
            aria-label="Close team editor"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team name" hint="Shown on the Overview cards.">
            <TextInput
              value={drafts.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
              placeholder="e.g. Alpha"
            />
          </Field>
          <Field
            label="Team role ID"
            hint="Role pinged by this team's war announcements. Leave empty for @here."
          >
            <TextInput
              value={drafts.team_role_id}
              onChange={(event) => updateDraft({ team_role_id: event.target.value })}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
          <Field label="War channel ID" hint="The channel where the bot tracks this team's war.">
            <TextInput
              value={drafts.war_channel_id}
              onChange={(event) => updateDraft({ war_channel_id: event.target.value })}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
          <Field label="Race channel ID" hint="The channel where the bot tracks this team's race.">
            <TextInput
              value={drafts.race_channel_id}
              onChange={(event) => updateDraft({ race_channel_id: event.target.value })}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={saveEditor} loading={busy === 'team-save'}>
            <Save className="h-4 w-4" /> Save team
          </Button>
          <Button variant="secondary" onClick={() => setEditor(null)}>
            Cancel
          </Button>
          {team ? (
            <Button
              variant="ghost"
              onClick={() => removeTeam(team)}
              loading={busy === `delete-${team.id}`}
            >
              <Trash2 className="h-4 w-4" /> Delete team
            </Button>
          ) : null}
        </div>

        <Divider />

        {team ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">Captains</p>
              <p className="mt-0.5 text-xs text-slate-500">
                Captains can edit this team&apos;s war and race channels in the dashboard and the
                bot. They cannot change server settings, aliases, maze or other teams.
              </p>
            </div>

            {captains.length === 0 ? (
              <p className="text-xs text-slate-500">No captains yet.</p>
            ) : (
              <ul className="space-y-1.5">
                {captains.map((captain) => {
                  const alias = aliasForCaptain(aliases, captain)
                  return (
                    <li
                      key={String(captain.discord_id)}
                      className="flex items-center justify-between gap-3 border border-white/[0.06] bg-white/[0.02] px-3 py-1.5"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <UserRound className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                        <span className="truncate text-slate-200">{alias ?? 'No alias'}</span>
                        <span className="truncate font-mono text-[11px] text-slate-600">
                          {String(captain.discord_id)}
                        </span>
                      </span>
                      <button
                        type="button"
                        onClick={() => removeCaptain(captain)}
                        disabled={busy === `captain-${captain.discord_id}`}
                        className="p-1 text-slate-500 transition-colors hover:text-danger-300"
                        aria-label={`Remove captain ${alias ?? captain.discord_id}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Add captain by alias">
                <div className="flex gap-2">
                  <Select
                    value={captainAlias}
                    onChange={(event) => setCaptainAlias(event.target.value)}
                    aria-label="Captain alias"
                  >
                    <option value="">Select an alias…</option>
                    {availableCaptainAliases.map((alias) => (
                      <option key={alias.id} value={String(alias.discord_id)}>
                        {alias.alias_name}
                      </option>
                    ))}
                  </Select>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!captainAlias}
                    loading={busy === 'captain-add'}
                    onClick={() => void addCaptain(captainAlias)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              </Field>
              <Field label="Add by Discord user ID">
                <div className="flex gap-2">
                  <TextInput
                    value={captainId}
                    onChange={(event) => setCaptainId(event.target.value)}
                    placeholder="e.g. 123456789012345678"
                    inputMode="numeric"
                  />
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!captainId.trim()}
                    loading={busy === 'captain-add'}
                    onClick={() => void addCaptain(captainId)}
                  >
                    <Plus className="h-3.5 w-3.5" /> Add
                  </Button>
                </div>
              </Field>
            </div>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Save the team first to assign captains.</p>
        )}
      </div>
    )
  }

  return (
    <Card className="mb-6">
      <CardHeader
        title="Server & team setup"
        description="Staff only. Set the server roles, then pair a team's war and race channel and pick its captains."
        icon={<Settings className="h-5 w-5" />}
        action={<Badge tone="purple">{teams.length}/{maxTeams} teams</Badge>}
      />
      <CardBody className="space-y-5">
        {feedback ? (
          <Alert tone={feedback.tone} onDismiss={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Staff role ID"
            hint="Members with this role get staff commands in Discord. Leave empty to rely on Manage Server."
          >
            <TextInput
              value={staffRole}
              onChange={(event) => setStaffRole(event.target.value)}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
          <Field label="Maze channel ID" hint="Where the maze discount pings are sent.">
            <TextInput
              value={mazeChannel}
              onChange={(event) => setMazeChannel(event.target.value)}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-slate-500">
            Plan: <span className="font-semibold text-slate-300">{guild.premium_status ?? 'trial'}</span>{' '}
            · max {maxTeams} {maxTeams === 1 ? 'team' : 'teams'} on this plan
          </p>
          <Button onClick={saveServer} loading={busy === 'server'} size="sm">
            <Save className="h-3.5 w-3.5" /> Save server settings
          </Button>
        </div>

        <Divider />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-200">Teams</p>
            <p className="mt-0.5 text-xs text-slate-500">
              A team pairs one war channel with one race channel. Either half can be empty.
            </p>
          </div>
          <Button size="sm" onClick={() => openNew()} disabled={atTeamLimit || editor?.team === null}>
            <Plus className="h-3.5 w-3.5" /> Add team
          </Button>
        </div>

        {atTeamLimit ? (
          <p className="text-xs text-slate-500">
            Your plan allows {maxTeams} {maxTeams === 1 ? 'team' : 'teams'}. Delete one or upgrade
            to add more.
          </p>
        ) : null}

        {teams.length === 0 ? (
          <EmptyState
            icon={<Users className="h-7 w-7" />}
            title="No teams yet"
            description="Add the first team and point it at the war and race channels the bot already watches."
          />
        ) : (
          <div className="space-y-2.5">
            {teams.map((team) => {
              const captains = captainsByTeam[team.id] ?? []
              const isEditing = editor?.team?.id === team.id
              return (
                <div
                  key={team.id}
                  className="border border-white/[0.08] bg-white/[0.02] px-4 py-3"
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-slate-100">{team.name}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                        <span>
                          War:{' '}
                          {team.war_channel_id ? (
                            <span className="font-mono text-slate-400">
                              {String(team.war_channel_id)}
                            </span>
                          ) : (
                            <span className="text-warn-300">not linked</span>
                          )}
                        </span>
                        <span>
                          Race:{' '}
                          {team.race_channel_id ? (
                            <span className="font-mono text-slate-400">
                              {String(team.race_channel_id)}
                            </span>
                          ) : (
                            <span className="text-warn-300">not linked</span>
                          )}
                        </span>
                        <span>
                          Captains:{' '}
                          {captains.length === 0
                            ? 'none'
                            : captains
                                .map(
                                  (captain) =>
                                    aliasForCaptain(aliases, captain) ??
                                    `User ${captain.discord_id}`,
                                )
                                .join(', ')}
                        </span>
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => (isEditing ? setEditor(null) : openEdit(team))}
                      >
                        {isEditing ? 'Close' : 'Edit'}
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Delete ${team.name}`}
                        loading={busy === `delete-${team.id}`}
                        onClick={() => void removeTeam(team)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  {isEditing && editor ? renderEditor(editor, false) : null}
                </div>
              )
            })}
          </div>
        )}

        {editor && editor.team === null ? renderEditor(editor, true) : null}

        {detectedCount > 0 ? (
          <>
            <Divider />
            <div>
              <p className="text-sm font-semibold text-slate-200">Detected channels</p>
              <p className="mt-0.5 text-xs text-slate-500">
                The bot already tracks these channels but no team owns them yet.
              </p>
              <ul className="mt-2 space-y-1.5">
                {detectedWarChannels.map((channelId) => (
                  <li
                    key={`war-${channelId}`}
                    className="flex flex-wrap items-center justify-between gap-2 border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Badge tone="amber">War</Badge>
                      <span className="font-mono text-xs text-slate-400">{channelId}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={atTeamLimit}
                      onClick={() => openNew({ war: channelId })}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add as team
                    </Button>
                  </li>
                ))}
                {detectedRaceChannels.map((channelId) => (
                  <li
                    key={`race-${channelId}`}
                    className="flex flex-wrap items-center justify-between gap-2 border border-white/[0.06] bg-white/[0.02] px-3 py-1.5 text-sm"
                  >
                    <span className="flex items-center gap-2">
                      <Badge tone="green">Race</Badge>
                      <span className="font-mono text-xs text-slate-400">{channelId}</span>
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={atTeamLimit}
                      onClick={() => openNew({ race: channelId })}
                    >
                      <Plus className="h-3.5 w-3.5" /> Add as team
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
      </CardBody>
    </Card>
  )
}
