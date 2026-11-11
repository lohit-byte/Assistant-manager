'use client'

import { useEffect, useMemo, useState } from 'react'
import { Plus, Save, ServerCog, Trash2, UserRound, Users, X } from 'lucide-react'
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
import {
  GUILD_SETUP_LABELS,
  validateGuildSetup,
  type GuildSetupErrors,
  type GuildSetupField,
  type GuildSetupValues,
} from '@/lib/setup'
import { useToast } from '@/lib/toast'
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

/** Only validation and write errors stay inline; successes are confirmed with a toast. */
type Feedback = { tone: 'red'; text: string } | null

/** Guild-row ids rendered in the text inputs; empty string means "not set". */
function guildSetupValues(row: Guild): GuildSetupValues {
  const id = (value: Guild['leader_role_id']) =>
    value !== null && value !== undefined ? String(value) : ''
  return {
    leader_role_id: id(row.leader_role_id),
    colead_role_id: id(row.colead_role_id),
    staff_role_id: id(row.staff_role_id),
    maze_channel_id: id(row.maze_channel_id),
  }
}

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
  const [server, setServer] = useState<GuildSetupValues>(() => guildSetupValues(guild))
  const [serverErrors, setServerErrors] = useState<GuildSetupErrors>({})
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [captainAlias, setCaptainAlias] = useState('')
  const [captainId, setCaptainId] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<Feedback>(null)
  const toast = useToast()

  // The parent refreshes the guild row after a save; keep the server fields in sync with it.
  useEffect(() => {
    setServer(guildSetupValues(guild))
  }, [
    guild.guild_id,
    guild.leader_role_id,
    guild.colead_role_id,
    guild.staff_role_id,
    guild.maze_channel_id,
  ])

  /** Editing a field clears its inline error; the next save re-validates everything. */
  const updateServer = (field: GuildSetupField, value: string) => {
    setServer((current) => ({ ...current, [field]: value }))
    setServerErrors((current) => ({ ...current, [field]: undefined }))
  }

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
    const result = validateGuildSetup(server)
    if (!result.ok) {
      setServerErrors(result.errors)
      setFeedback({ tone: 'red', text: 'Check the highlighted IDs, then save again.' })
      return
    }
    setServerErrors({})

    setBusy('server')
    try {
      // One write for all four fields: the role ids and the maze channel travel together.
      const { error } = await createClient()
        .from('guilds')
        .update(result.update)
        .eq('guild_id', guild.guild_id)
      if (error) throw new Error(error.message)
      await reload()
      toast.success(
        'Server setup saved.',
        'The bot now uses these staff roles and the maze channel.',
      )
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
      toast.success(
        `Team “${name}” saved.`,
        'Overview cards and the bot now use these channels.',
      )
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
      toast.success(`Team “${team.name}” deleted.`, 'Its war and race history is kept.')
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
      toast.success('Captain added.', 'They can now manage this team’s war and race channels.')
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
      toast.success('Captain removed.', 'They can no longer manage this team.')
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
          <Field
            label="Team name"
            hint="Shown on the Overview cards. Use the name your staff know this team by."
          >
            <TextInput
              value={drafts.name}
              onChange={(event) => updateDraft({ name: event.target.value })}
              placeholder="e.g. Alpha"
            />
          </Field>
          <Field
            label="Team role ID"
            hint="Discord role ID (17–20 digits) that this team’s war announcements ping. Leave it empty to ping @here instead."
          >
            <TextInput
              value={drafts.team_role_id}
              onChange={(event) => updateDraft({ team_role_id: event.target.value })}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
          <Field
            label="War channel ID"
            hint="Discord channel ID (17–20 digits) where the bot tracks this team’s war. Leave it empty if the team only races."
          >
            <TextInput
              value={drafts.war_channel_id}
              onChange={(event) => updateDraft({ war_channel_id: event.target.value })}
              placeholder="e.g. 123456789012345678"
              inputMode="numeric"
            />
          </Field>
          <Field
            label="Race channel ID"
            hint="Discord channel ID (17–20 digits) where the bot tracks this team’s race. Leave it empty if the team only wars."
          >
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

        {team ? (
          <p className="text-xs leading-relaxed text-slate-500">
            Deleting removes the team and its captains. Its war and race history stays with the
            channels, so you can link them again later.
          </p>
        ) : null}

        <Divider />

        {team ? (
          <div className="space-y-3">
            <div>
              <p className="text-sm font-semibold text-slate-200">Captains</p>
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                Captains can edit this team’s war and race channels in the dashboard and the bot.
                They cannot change server settings, billing, aliases, the maze or other teams.
              </p>
            </div>

            {captains.length === 0 ? (
              <p className="text-xs text-slate-500">
                No captains yet. Add one below by alias or by Discord user ID.
              </p>
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
              <Field
                label="Add captain by alias"
                hint="Pick a player who already has an alias here — the bot already knows their Discord ID."
              >
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
              <Field
                label="Add by Discord user ID"
                hint="Paste a Discord user ID (17–20 digits) when the player has no alias yet."
              >
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
        title="Server setup"
        description="Staff only. Each subteam pairs one war channel with one race channel — link them, add captains, and set the roles the bot treats as staff."
        icon={<ServerCog className="h-5 w-5" />}
        action={<Badge tone="purple">{teams.length}/{maxTeams} teams</Badge>}
      />
      <CardBody className="space-y-5">
        <div className="border border-white/[0.08] bg-white/[0.02] px-4 py-3.5">
          <p className="mono-label text-accent-400">How setup works</p>
          <ol className="mt-2 list-decimal space-y-1.5 pl-4 text-xs leading-relaxed text-slate-500">
            <li>
              <span className="font-semibold text-slate-300">Link a team.</span> Give it a name and
              paste the war and race channel IDs the bot watches. A team pairs one war channel with
              one race channel; either half can stay empty.
            </li>
            <li>
              <span className="font-semibold text-slate-300">Add captains.</span> Captains manage
              their own team’s war and race channels in the dashboard and the bot. They cannot change
              server settings, billing or other teams.
            </li>
            <li>
              <span className="font-semibold text-slate-300">Verify on Overview.</span> Open the
              team cards to check the war, race and activity numbers the bot records.
            </li>
          </ol>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            The role IDs and maze channel below are Discord IDs the bot reads — paste the ID, not
            the name. Leader, Helper and Staff all unlock the same staff commands; the tiers only
            decide who you give them to.
          </p>
        </div>

        {feedback ? (
          <Alert tone={feedback.tone} onDismiss={() => setFeedback(null)}>
            {feedback.text}
          </Alert>
        ) : null}

        <div>
          <p className="text-sm font-semibold text-slate-200">Staff roles</p>
          <p className="mt-0.5 max-w-2xl text-xs leading-relaxed text-slate-500">
            The bot gives its staff commands to anyone holding <span className="font-semibold text-slate-300">any</span> of these
            three roles. Helper staff is the co-lead tier: same commands as Leader and Staff, kept
            separate so you can hand out the middle rank. Empty fields are simply not set.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field
              label={GUILD_SETUP_LABELS.leader_role_id}
              hint="Discord role ID (17–20 digits) for the server leader. The bot treats it as staff."
              error={serverErrors.leader_role_id}
            >
              <TextInput
                value={server.leader_role_id}
                onChange={(event) => updateServer('leader_role_id', event.target.value)}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
              />
            </Field>
            <Field
              label={`${GUILD_SETUP_LABELS.colead_role_id} (co-lead)`}
              hint="Discord role ID for helpers. The bot treats it as staff — the co-lead tier, below Leader and above Staff."
              error={serverErrors.colead_role_id}
            >
              <TextInput
                value={server.colead_role_id}
                onChange={(event) => updateServer('colead_role_id', event.target.value)}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
              />
            </Field>
            <Field
              label={GUILD_SETUP_LABELS.staff_role_id}
              hint="Discord role ID whose members get the bot’s staff commands. Leave it empty to rely on Manage Server."
              error={serverErrors.staff_role_id}
            >
              <TextInput
                value={server.staff_role_id}
                onChange={(event) => updateServer('staff_role_id', event.target.value)}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
              />
            </Field>
            <Field
              label={GUILD_SETUP_LABELS.maze_channel_id}
              hint="Discord channel ID (17–20 digits) where the bot sends maze discount pings. Leave it empty if you do not use maze alerts."
              error={serverErrors.maze_channel_id}
            >
              <TextInput
                value={server.maze_channel_id}
                onChange={(event) => updateServer('maze_channel_id', event.target.value)}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
              />
            </Field>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs leading-relaxed text-slate-500">
            Plan:{' '}
            <span className="font-semibold text-slate-300">{guild.premium_status ?? 'trial'}</span> ·
            up to {maxTeams} {maxTeams === 1 ? 'team' : 'teams'} on this plan, and each team pairs one
            war channel with one race channel.
          </p>
          <Button onClick={saveServer} loading={busy === 'server'} size="sm">
            <Save className="h-3.5 w-3.5" /> Save server setup
          </Button>
        </div>

        <Divider />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-slate-200">Subteams</p>
            <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
              One team = one war channel + one race channel. Either half can be empty, and the bot
              uses these channels for its war and race commands.
            </p>
          </div>
          <Button size="sm" onClick={() => openNew()} disabled={atTeamLimit || editor?.team === null}>
            <Plus className="h-3.5 w-3.5" /> Add team
          </Button>
        </div>

        {atTeamLimit ? (
          <p className="text-xs leading-relaxed text-slate-500">
            You’ve reached the {maxTeams}-team limit on your plan. Delete a team or upgrade to add
            more.
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
              <p className="mt-0.5 text-xs leading-relaxed text-slate-500">
                The bot has already recorded war or race activity in these channels, but no team
                owns them yet. “Add as team” starts a new team with that channel filled in — add the
                other channel, then save it.
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
