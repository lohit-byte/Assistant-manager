'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { StaffOnlyPanel } from '@/components/staff-only'
import { TeamSetup } from '@/components/team-setup'
import {
  Alert,
  Button,
  PageHeader,
  Spinner,
  buttonClass,
} from '@/components/ui'
import { getTeamsOverview } from '@/lib/data'
import { createClient } from '@/lib/supabase/client'
import type { Alias, TeamCaptain } from '@/lib/types'

/**
 * Staff-only Server setup page: the one place for per-subteam war/race channels, captains and
 * the guild-level roles the bot treats as staff. TeamSetup owns every write; this page only
 * loads the extra data it needs and keeps it fresh after each save.
 */
export default function SetupPage() {
  const { isStaff } = useGuild()
  if (!isStaff) return <StaffOnlyPanel area="Server setup" />
  return <SetupContent />
}

function SetupContent() {
  const { guildId, guild, teams, refresh } = useGuild()
  const [captainsByTeam, setCaptainsByTeam] = useState<Record<number, TeamCaptain[]>>({})
  const [aliases, setAliases] = useState<Alias[]>([])
  const [detectedWarChannels, setDetectedWarChannels] = useState<string[]>([])
  const [detectedRaceChannels, setDetectedRaceChannels] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (mode === 'refresh') setRefreshing(true)
      else setLoading(true)
      setError(null)

      try {
        const overview = await getTeamsOverview(createClient(), guildId)
        setCaptainsByTeam(
          Object.fromEntries(
            overview.teams.map((snapshot) => [snapshot.team.id, snapshot.captains]),
          ),
        )
        setAliases(overview.aliases)
        setDetectedWarChannels(overview.detectedWarChannels)
        setDetectedRaceChannels(overview.detectedRaceChannels)
      } catch (caught) {
        // A missing teams/team_captains migration (or any failed read) must not block the
        // role fields: keep the last snapshot and let TeamSetup show its empty state.
        setError(
          caught instanceof Error ? caught.message : 'Could not load the team snapshot.',
        )
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [guildId],
  )

  useEffect(() => {
    void load()
  }, [load])

  // TeamSetup calls this after every write: refresh the shell (guild row + teams) first, then
  // reload captains, aliases and detected channels so the same page reflects the change.
  const onChanged = useCallback(async () => {
    await refresh()
    await load('refresh')
  }, [load, refresh])

  return (
    <div>
      <PageHeader
        eyebrow="Manage"
        title="Server setup"
        description="Everything server-wide in one place: each subteam’s war and race channels, its captains, and the staff and helper roles the bot reads. Changes apply in Discord immediately."
        actions={
          <>
            <Link href={`/dashboard/${guildId}`} className={buttonClass('ghost', 'sm')}>
              <ArrowLeft className="h-3.5 w-3.5" />
              Overview
            </Link>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load('refresh')}
              loading={refreshing}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </>
        }
      />

      {error ? (
        <Alert tone="amber" className="mb-6" title="Could not load the team snapshot">
          {error} The staff role fields below still work — reload once the database is reachable.
        </Alert>
      ) : null}

      {loading ? (
        <Spinner label="Loading teams and channels…" />
      ) : (
        <TeamSetup
          guild={guild}
          teams={teams}
          captainsByTeam={captainsByTeam}
          aliases={aliases}
          detectedWarChannels={detectedWarChannels}
          detectedRaceChannels={detectedRaceChannels}
          onChanged={onChanged}
        />
      )}
    </div>
  )
}
