'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Plus, RefreshCw, Search, Trash2, UserRound, Users } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { Alert, Badge, Button, Card, CardBody, CardHeader, EmptyState, Field, PageHeader, Spinner, TextInput } from '@/components/ui'
import { StaffOnlyPanel } from '@/components/staff-only'
import { addAlias, deleteAlias, listAliases } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import { isSnowflake } from '@/lib/format'
import type { Alias } from '@/lib/types'

export default function AliasesPage() {
  const { readOnly } = useGuild()
  if (readOnly) return <StaffOnlyPanel area="Alias management" />
  return <AliasesContent />
}

function AliasesContent() {
  const { guildId } = useGuild()
  const [aliases, setAliases] = useState<Alias[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<{ tone: 'green' | 'red'; text: string } | null>(null)

  const [query, setQuery] = useState('')
  const [aliasName, setAliasName] = useState('')
  const [discordId, setDiscordId] = useState('')

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true)
    try { setAliases(await listAliases(createClient(), guildId)) } 
    catch (caught) { setFeedback({ tone: 'red', text: 'Could not load aliases.' }) } 
    finally { setLoading(false) }
  }, [guildId])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return aliases
    return aliases.filter((alias) => alias.alias_name.toLowerCase().includes(needle) || String(alias.discord_id).includes(needle))
  }, [aliases, query])

  const submit = async () => {
    const name = aliasName.trim().toLowerCase()
    if (!name) return setFeedback({ tone: 'red', text: 'Enter an alias.' })
    if (!isSnowflake(discordId)) return setFeedback({ tone: 'red', text: 'Enter a valid Discord ID (17–20 digits).' })
    
    setBusy('add'); setFeedback(null)
    try {
      await addAlias(createClient(), guildId, discordId, name)
      setAliases(await listAliases(createClient(), guildId))
      setAliasName(''); setDiscordId('')
      setFeedback({ tone: 'green', text: `Alias “${name}” saved.` })
    } catch (caught) { setFeedback({ tone: 'red', text: 'Could not save alias.' }) } 
    finally { setBusy(null) }
  }

  const remove = async (alias: Alias) => {
    if (!window.confirm(`Delete “${alias.alias_name}”?`)) return
    setBusy(`delete-${alias.id}`); setFeedback(null)
    try {
      await deleteAlias(createClient(), alias.id)
      setAliases((current) => current.filter((item) => item.id !== alias.id))
    } catch (caught) { setFeedback({ tone: 'red', text: 'Could not delete alias.' }) } 
    finally { setBusy(null) }
  }

  if (loading) return <div><PageHeader title="Aliases" /><Spinner label="Loading…" /></div>

  return (
    <div>
      <PageHeader
        eyebrow="Roster"
        title="Aliases"
        description="Map in-game names to Discord users. The bot uses these instead of pinging users."
        actions={<Button variant="secondary" onClick={() => load('refresh')}><RefreshCw className="h-4 w-4" /> Refresh</Button>}
      />

      {feedback && <Alert tone={feedback.tone} className="mb-6" onDismiss={() => setFeedback(null)}>{feedback.text}</Alert>}

      <Card className="mb-6">
        <CardHeader title="Add or update alias" description="Enter the user's ID and their alias." icon={<UserRound className="h-5 w-5" />} />
        <CardBody>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <Field label="Discord user ID" hint="Right-click user → Copy ID.">
              <TextInput value={discordId} onChange={(event) => setDiscordId(event.target.value)} placeholder="e.g. 123456789012345678" inputMode="numeric" />
            </Field>
            <Field label="Alias" hint="The name they use in-game.">
              <TextInput value={aliasName} onChange={(event) => setAliasName(event.target.value)} placeholder="e.g. lohit" />
            </Field>
            <Button onClick={submit} loading={busy === 'add'} disabled={!aliasName.trim() || !discordId.trim()} className="mb-0.5">
              <Plus className="h-4 w-4" /> Save
            </Button>
          </div>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Server aliases" description={`${aliases.length} recorded`} icon={<Users className="h-5 w-5" />} action={<Badge tone="purple">{filtered.length} shown</Badge>} />
        <CardBody className="space-y-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
            <TextInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search..." className="pl-9" />
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={<Users className="h-7 w-7" />} title="No aliases found" description="Add the first alias above." />
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
                      <td className="px-3 py-2.5"><span className="font-medium text-slate-200">{alias.alias_name}</span></td>
                      <td className="px-3 py-2.5"><span className="font-mono text-xs text-slate-400">{String(alias.discord_id)}</span></td>
                      <td className="px-3 py-2.5 text-right">
                        <button type="button" onClick={() => remove(alias)} disabled={busy === `delete-${alias.id}`} className="rounded p-1.5 text-slate-500 hover:bg-danger-500/10 hover:text-danger-300">
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
  )
}
