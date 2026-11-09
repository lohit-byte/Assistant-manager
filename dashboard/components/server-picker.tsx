'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  ExternalLink,
  LogOut,
  Plus,
  RefreshCw,
  Search,
  Server,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { canManageGuild, DiscordApiError, discordIdFromSession, fetchDiscordGuilds, type DiscordGuild } from '@/lib/discord'
import { BOT_INVITE_URL, DISCORD_GUILD_ICON, PLAN_META } from '@/lib/constants'
import { Wordmark } from '@/components/brand'
import { getGuild, isAliasMember } from '@/lib/data'
import { toDate } from '@/lib/format'
import type { Guild } from '@/lib/types'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  PageHeader,
  Spinner,
  TextInput,
  buttonClass,
} from '@/components/ui'

interface GuildCard {
  guild: DiscordGuild
  row: Guild | null
  /** Alias member of a premium server: dashboard opens in read-only mode. */
  readOnly: boolean
}

type LoadError =
  | { kind: 'auth'; message: string }
  | { kind: 'discord'; message: string }
  | { kind: 'unknown'; message: string }

export default function ServerPicker() {
  const router = useRouter()
  const [cards, setCards] = useState<GuildCard[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<LoadError | null>(null)
  const [query, setQuery] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        router.replace('/')
        return
      }

      if (!session.provider_token) {
        setError({
          kind: 'discord',
          message: 'Discord access expired. Sign out and sign in again to refresh your server list.',
        })
        return
      }

      const guilds = (await fetchDiscordGuilds(session.provider_token))
        .sort((a, b) => a.name.localeCompare(b.name))
      const discordId = discordIdFromSession(session.user)

      const rows = await Promise.allSettled(
        guilds.map(async (guild) => ({ guild, row: await getGuild(supabase, guild.id) })),
      )

      const resolved = rows
        .filter((item): item is PromiseFulfilledResult<Omit<GuildCard, 'readOnly'>> => item.status === 'fulfilled')
        .map((item) => item.value)

      // Managers see their servers. A premium server's alias members also see it,
      // read-only — same rule as the guild dashboard itself.
      const visible: GuildCard[] = []
      for (const card of resolved) {
        if (canManageGuild(card.guild)) {
          visible.push({ ...card, readOnly: false })
          continue
        }
        if (!discordId || card.row?.premium_status !== 'premium') continue
        if (await isAliasMember(supabase, card.guild.id, discordId)) {
          visible.push({ ...card, readOnly: true })
        }
      }

      visible.sort((a, b) => {
        if (Boolean(a.row) !== Boolean(b.row)) return a.row ? -1 : 1
        return a.guild.name.localeCompare(b.guild.name)
      })

      setCards(visible)
    } catch (caught) {
      if (caught instanceof DiscordApiError) {
        setError({ kind: 'discord', message: caught.message })
      } else {
        setError({
          kind: 'unknown',
          message: caught instanceof Error ? caught.message : 'Could not load your servers.',
        })
      }
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return cards
    return cards.filter(
      (card) =>
        card.guild.name.toLowerCase().includes(needle) || card.guild.id.includes(needle),
    )
  }, [cards, query])

  const botServers = cards.filter((card) => card.row).length
  const memberViews = cards.filter((card) => card.readOnly).length

  const signOut = async () => {
    await createClient().auth.signOut()
    router.replace('/')
  }

  return (
    <div className="relative min-h-screen bg-ink-950 text-slate-100">
      <div className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-72 opacity-60" aria-hidden />
      <div className="relative mx-auto max-w-5xl px-4 py-10 sm:px-6 lg:py-14">
        <div className="mb-10 flex items-center justify-between border-b border-white/[0.1] pb-5">
          <Wordmark />
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={load} loading={loading}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="secondary" size="sm" onClick={signOut}>
              <LogOut className="h-4 w-4" />
              Sign out
            </Button>
          </div>
        </div>

        <main id="main">
        <PageHeader
          eyebrow="00 / Server selection"
          title="Choose a server"
          description={`You have access to ${cards.length} ${cards.length === 1 ? 'server' : 'servers'}${memberViews ? ` (${memberViews} read-only)` : ''}. ${botServers} ${botServers === 1 ? 'has' : 'have'} the bot installed.`}
          actions={
            <a
              href={BOT_INVITE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonClass('secondary')}
            >
              <Plus className="h-4 w-4" />
              Invite the bot
            </a>
          }
        />

        {error ? (
          <Alert tone={error.kind === 'discord' ? 'amber' : 'red'} className="mb-6" title="Could not load servers">
            <div className="flex flex-wrap items-center gap-3">
              <span>{error.message}</span>
              {error.kind === 'discord' ? (
                <Button size="sm" onClick={signOut}>
                  Sign in again
                </Button>
              ) : (
                <Button size="sm" variant="secondary" onClick={load}>
                  Try again
                </Button>
              )}
            </div>
          </Alert>
        ) : null}

        {loading ? (
          <Spinner label="Loading your servers…" />
        ) : (
          <>
            <div className="relative mb-5">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <TextInput
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search by name or ID…"
                className="pl-9"
                aria-label="Search servers"
              />
            </div>

            {filtered.length === 0 ? (
              <Card>
                <CardBody className="py-14 text-center">
                  <Server className="mx-auto mb-3 h-8 w-8 text-slate-600" />
                  <p className="font-semibold text-slate-300">
                    {cards.length === 0 ? 'No servers found' : 'No matching servers'}
                  </p>
                  <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                    {cards.length === 0
                      ? 'You need the Manage Server or Administrator permission, or an alias in a premium server, to see it here.'
                      : 'Try a different search term.'}
                  </p>
                  {cards.length === 0 ? (
                    <a
                      href={BOT_INVITE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={buttonClass('primary', 'md', 'mt-5')}
                    >
                      <ExternalLink className="h-4 w-4" />
                      Add the bot to a server
                    </a>
                  ) : null}
                </CardBody>
              </Card>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map(({ guild, row, readOnly }) => {
                  const meta = PLAN_META[row?.premium_status ?? ''] ?? null
                  const daysLeft =
                    row?.premium_status === 'trial' && row.trial_ends_at
                      ? Math.max(
                          0,
                          Math.ceil(
                            ((toDate(row.trial_ends_at)?.getTime() ?? Date.now()) - Date.now()) /
                              86_400_000,
                          ),
                        )
                      : null

                  return (
                    <button
                      key={guild.id}
                      type="button"
                      onClick={() => router.push(`/dashboard/${guild.id}`)}
                      className="surface group flex flex-col p-5 text-left transition-all hover:-translate-y-0.5 hover:border-white/[0.14]"
                    >
                      <div className="flex items-start gap-3">
                        {guild.icon ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={DISCORD_GUILD_ICON(guild.id, guild.icon)}
                            alt=""
                            className="h-12 w-12 rounded-xl border border-white/[0.08] object-cover"
                          />
                        ) : (
                          <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.04]">
                            <Server className="h-6 w-6 text-slate-400" />
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <p className="truncate font-semibold text-slate-50">{guild.name}</p>
                          <p className="truncate font-mono text-xs text-slate-500">{guild.id}</p>
                        </div>
                        <ArrowRight className="h-4 w-4 shrink-0 text-slate-600 transition-transform group-hover:translate-x-0.5 group-hover:text-accent-300" />
                      </div>

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        {!row ? (
                          <Badge tone="red">Bot not added</Badge>
                        ) : row.is_blacklisted ? (
                          <Badge tone="red">Blacklisted</Badge>
                        ) : meta ? (
                          <Badge tone={meta.tone} dot>
                            {meta.label}
                          </Badge>
                        ) : (
                          <Badge tone="slate">Unknown plan</Badge>
                        )}
                        {readOnly ? <Badge tone="slate">Read-only</Badge> : null}
                        {daysLeft !== null ? (
                          <span className="text-xs text-slate-500">{daysLeft}d left</span>
                        ) : null}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
        </main>
      </div>
    </div>
  )
}
