'use client'

import { useState } from 'react'
import { useGuild } from '@/components/guild-shell'
import { createClient } from '@/lib/supabase/client'
import { PageHeader, Card, CardBody, CardHeader, Field, TextInput, Button, Alert } from '@/components/ui'
import { Save, Settings } from 'lucide-react'

export default function ServerSettingsPage() {
  const { guildId, guild, refresh } = useGuild()
  
  const [warChannel, setWarChannel] = useState(guild.war_channel_id?.toString() || '')
  const [raceChannel, setRaceChannel] = useState(guild.race_channel_id?.toString() || '')
  const [mazeChannel, setMazeChannel] = useState(guild.maze_channel_id?.toString() || '')
  const [staffRole, setStaffRole] = useState(guild.staff_role_id?.toString() || '')

  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const save = async () => {
    setSaving(true); setSuccess(false)
    const supabase = createClient()
    
  const { error } = await supabase.from('guilds').update({
    war_channel_id: warChannel || null,
    race_channel_id: raceChannel || null,
    maze_channel_id: mazeChannel || null,
    staff_role_id: staffRole || null,
  }).eq('guild_id', guildId)

  if (error) {
    console.error(error)
    alert('Save failed: ' + error.message)
    setSaving(false)
    return
  }

    await refresh()
    setSaving(false)
    setSuccess(true)
    setTimeout(() => setSuccess(false), 3000)
  }

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Configuration"
        title="Server Settings"
        description="Tell the bot where to send pings and read commands. Right-click a channel in Discord and select 'Copy ID'."
      />

      {success && <Alert tone="green" className="mb-6">Settings saved successfully! The bot is now updated.</Alert>}

      <Card>
        <CardHeader title="Channel & Role Setup" icon={<Settings className="h-5 w-5" />} />
        <CardBody className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="War Channel ID" hint="Where war statuses and attacks go.">
              <TextInput value={warChannel} onChange={(e) => setWarChannel(e.target.value)} placeholder="e.g. 123456789012345678" />
            </Field>
            <Field label="Race Channel ID" hint="Where race updates are tracked.">
              <TextInput value={raceChannel} onChange={(e) => setRaceChannel(e.target.value)} placeholder="e.g. 123456789012345678" />
            </Field>
            <Field label="Maze Channel ID" hint="Where discount pings are sent.">
              <TextInput value={mazeChannel} onChange={(e) => setMazeChannel(e.target.value)} placeholder="e.g. 123456789012345678" />
            </Field>
            <Field label="Staff Role ID" hint="The role that can use admin commands.">
              <TextInput value={staffRole} onChange={(e) => setStaffRole(e.target.value)} placeholder="e.g. 123456789012345678" />
            </Field>
          </div>

          <Button onClick={save} loading={saving} className="w-full">
            <Save className="h-4 w-4 mr-2" /> Save Settings
          </Button>
        </CardBody>
      </Card>
    </div>
  )
}
