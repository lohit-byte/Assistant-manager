'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Save, AlertCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const supabase = typeof window !== 'undefined' ? createClient() : (null as any)

export default function RaceSettingsPage() {
  const params = useParams()
  const guildId = params.guildId as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [raceSettings, setRaceSettings] = useState({ target_laps: 0, current_lap: 0, current_node: 0 })

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await supabase.from('race_state').select('*').eq('guild_id', guildId).single()
      if (data) {
        setRaceSettings({ target_laps: data.target_laps || 0, current_lap: data.current_lap || 0, current_node: data.current_node || 0 })
      }
      setLoading(false)
    }
    fetchData()
  }, [guildId])

  const saveRace = async () => {
    setSaving(true)
    const { error } = await supabase.from('race_state').upsert({
      guild_id: guildId, target_laps: raceSettings.target_laps
    }, { onConflict: 'guild_id' })
    
    if (error) setMessage({ text: `Failed: ${error.message}`, type: 'error' })
    else {
      setMessage({ text: 'Race target saved!', type: 'success' })
      setTimeout(() => setMessage({ text: '', type: '' }), 3000)
    }
    setSaving(false)
  }

  if (loading) return <div className="text-slate-400">Loading Race settings...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Race Settings</h1>
      {message.text && (
        <div className={`p-4 mb-6 rounded-lg flex items-center space-x-3 ${message.type === 'error' ? 'bg-red-900/50 text-red-200 border border-red-800' : 'bg-green-900/50 text-green-200 border border-green-800'}`}>
          <AlertCircle className="w-5 h-5" /><span>{message.text}</span>
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl space-y-6">
        <div>
          <label className="block text-lg font-bold mb-2">Team Target Laps</label>
          <input type="number" value={raceSettings.target_laps} onChange={(e) => setRaceSettings({...raceSettings, target_laps: parseInt(e.target.value) || 0})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-green-500" />
        </div>
        <div className="p-4 bg-slate-950 rounded border border-slate-800 flex justify-between">
          <span className="text-slate-400">Current Progress:</span>
          <span className="font-bold">Lap {raceSettings.current_lap}.{raceSettings.current_node}</span>
        </div>
        <button onClick={saveRace} disabled={saving} className="w-full py-3 bg-green-600 hover:bg-green-500 rounded-lg font-bold flex items-center justify-center space-x-2">
          <Save className="w-5 h-5" /><span>{saving ? 'Saving...' : 'Save Race Settings'}</span>
        </button>
      </div>
    </div>
  )
}
