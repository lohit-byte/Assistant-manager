'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Trash2, UserRound, Users } from 'lucide-react'
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
  Spinner,
  TextInput,
} from '@/components/ui'
import { addAlias, deleteAlias, listAliases } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { isSnowflake } from '@/lib/format'
import type { Alias } from '@/lib/types'

export default function AliasesPage() {
  const { guildId } = useGuild()
  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null)

  const [query, setQuery] = useState('')
  const [aliasName, setAliasName] = useState('')
  const [discordId, setDiscordId] = useState('')

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'initial') setLoading(true)
      try {
        setAliases(await listAliases(createClient(), guildId))
      } catch (caught) {
        setFeedback({
          tone: 'red',
          text: caught instanceof Error ? caught.message : 'Could not load aliases.',
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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return aliases
    return aliases.filter(
      (alias) =>
        alias.alias_name.toLowerCase().includes(needle) ||
        String(alias.discord_id).includes(needle),
    )
  }, [aliases, query])

  const submit = async () => {
    const name = aliasName.trim().toLowerCase()
    if (!name) {
      setFeedback({ tone: 'red', text: 'Enter an alias.' })
      return
    }
    if (!isSnowflake(discordId)) {
      setFeedback({ tone: 'red', text: 'Enter a valid Discord user ID (17–20 digits).' })
      return
    }
    setBusy('add')
    setFeedback(null)
    try {
      await addAlias(createClient(), guildId, discordId, name)
      setAliases(await listAliases(createClient(), guildId))
      setAliasName('')
      setDiscordId('')
      setFeedback({ tone: 'green', text: `Alias “${name}” saved.` })
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text:
          caught instanceof Error
            ? caught.message
            : 'Could not save the alias. Check that the bot has created the users table row.',
      })
    } finally {
      setBusy(null)
    }
  }

  const remove = async (alias: Alias) => {
    if (!window.confirm(`Delete the alias “${alias.alias_name}”?`)) return
    setBusy(`delete-${alias.id}`)
    setFeedback(null)
    try {
      await deleteAlias(createClient(), alias.id)
      setAliases((current) => current.filter((item) => item.id !== alias.id))
    } catch (caught) {
      setFeedback({
        tone: 'red',
        text: caught instanceof Error ? caught.message : 'Could not delete the alias.',
      })
    } finally {
      setBusy(null)
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Aliases" description="Player name mappings." />
        <Spinner label="Loading aliases…" />
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        eyebrow="Roster"
        title="Aliases"
        description="Aliases let the bot resolve player names in war, race and maze commands. Saving an existing alias reassigns it to the new Discord user."
        actions={
          <Button variant="secondary" onClick={() => load('refresh')}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        }
      />

      {feedback ? (
        <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>
          {feedback.text}
        </Alert>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[0.8fr_1.2fr]">
        <Card>
          <CardHeader
            title="Add or update alias"
            description="Aliases are unique per server"
            icon={<UserRound className="h-5 w-5" />}
          />
          <CardBody className="space-y-4">
            <Field label="Alias" hint="Stored lowercased, matching the bot.">
              <TextInput
                value={aliasName}
                onChange={(event) => setAliasName(event.target.value)}
                placeholder="e.g. lohit"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit()
                }}
              />
            </Field>
            <Field label="Discord user ID" hint="Right-click a user in Discord → Copy User ID.">
              <TextInput
                value={discordId}
                onChange={(event) => setDiscordId(event.target.value)}
                placeholder="e.g. 123456789012345678"
                inputMode="numeric"
                onKeyDown={(event) => {
                  if (event.key === 'Enter') void submit()
                }}
              />
            </Field>
            <Button
              onClick={submit}
              loading={busy === 'add'}
              disabled={!aliasName.trim() || !discordId.trim()}
              className="w-full"
            >
              <Plus className="h-4 w-4" />
              Save alias
            </Button>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Server aliases"
            description={`${aliases.length} ${aliases.length === 1 ? 'alias' : 'aliases'} recorded`}
            icon={<Users className="h-5 w-5" />}
            action={<Badge tone="purple">{filtered.length} shown</Badge>}
          />
          <CardBody className="space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by alias or Discord ID"
                className="pl-9"
              />
            </div>

            {filtered.length === 0 ? (
              <EmptyState
                icon={<Users className="h-7 w-7" />}
                title={aliases.length === 0 ? 'No aliases yet' : 'No matches'}
                description={
                  aliases.length === 0
                    ? 'Add the first alias on the left, or use !alias add in Discord.'
                    : 'Try a different search term.'
                }
              />
            ) : (
              <div className="max-h-[560px] overflow-y-auto">
                <table className="w-full text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-slate-900 text-xs uppercase tracking-wider text-slate-500">
                    <tr>
                      <th className="px-3 py-2 font-medium">Alias</th>
                      <th className="px-3 py-2 font-medium">Discord ID</th>
                      <th className="px-3 py-2 text-right font-medium">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {filtered.map((alias) => (
                      <tr key={alias.id} className="hover:bg-slate-800/30">
                        <td className="px-3 py-2.5">
                          <span className="font-medium text-slate-200">{alias.alias_name}</span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="font-mono text-xs text-slate-400">
                            {String(alias.discord_id)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <button
                            type="button"
                            onClick={() => remove(alias)}
                            disabled={busy === `delete-${alias.id}`}
                            className="rounded p-1.5 text-slate-500 transition-colors hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
                            aria-label={`Delete alias ${alias.alias_name}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <p className="mt-6 text-xs text-slate-600">
        Bot command equivalents: <span className="font-mono">!alias add &lt;alias&gt; @user</span>,{' '}
        <span className="font-mono">!alias remove &lt;alias&gt;</span>. Alias changes take effect
        immediately for future commands.
      </p>
    </div>
  )
}
