'use client'

import { useEffect, useState } from 'react'
import { Save, AlertCircle } from 'lucide-react'
import { useParams } from '@utils/supabase/client'
import { createClient } from '@/utils/supabase/client'

const supabase = createClient()

export default function MazeSettingsPage({ params }: { params: { guildId: string } }) {
  const params = useParams ()
  const guildId = params.guildId as string
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [mazeSettings, setMazeSettings] = useState({
    maze_type: '7d',
    event_start: new Date().toISOString().split('T')[0],
    event_end: new Date(Date.now() + 7 * 86400000).toISOString().split('T')[0],
    ping_enabled_global: true,
    channel_id: ''
  })

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await supabase.from('maze_schedules').select('*').eq('guild_id', guildId).single()
      if (data && data.event_start) {
        setMazeSettings({
          maze_type: data.maze_type || '7d',
          event_start: new Date(data.event_start).toISOString().split('T')[0],
          event_end: new Date(data.event_end).toISOString().split('T')[0],
          ping_enabled_global: data.ping_enabled_global ?? true,
          channel_id: data.channel_id || ''
        })
      }
      setLoading(false)
    }
    fetchData()
  }, [guildId])

  const saveMaze = async () => {
    setSaving(true)
    const startObj = new Date(`${mazeSettings.event_start}T11:00:00Z`)
    const endObj = new Date(`${mazeSettings.event_end}T11:00:00Z`)
    
    // BIGINT FIX: Just pass the string directly, Supabase handles it.
    const { error } = await supabase.from('maze_schedules').upsert({
      guild_id: guildId, maze_type: mazeSettings.maze_type,
      event_start: startObj.toISOString(), event_end: endObj.toISOString(),
      ping_enabled_global: mazeSettings.ping_enabled_global,
      channel_id: mazeSettings.channel_id ? mazeSettings.channel_id : null 
    }, { onConflict: 'guild_id' })
    
    if (error) setMessage({ text: `Failed: ${error.message}`, type: 'error' })
    else {
      setMessage({ text: 'Maze schedule saved!', type: 'success' })
      setTimeout(() => setMessage({ text: '', type: '' }), 3000)
    }
    setSaving(false)
  }

  if (loading) return <div className="text-slate-400">Loading Maze settings...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Maze Settings</h1>
      {message.text && (
        <div className={`p-4 mb-6 rounded-lg flex items-center space-x-3 ${message.type === 'error' ? 'bg-red-900/50 text-red-200 border border-red-800' : 'bg-green-900/50 text-green-200 border border-green-800'}`}>
          <AlertCircle className="w-5 h-5" /><span>{message.text}</span>
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl space-y-6">
        <div>
          <label className="block text-lg font-bold mb-2">Event Type</label>
          <select value={mazeSettings.maze_type} onChange={(e) => setMazeSettings({...mazeSettings, maze_type: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white">
            <option value="7d">7-Day Maze</option>
            <option value="3d">3-Day Maze</option>
          </select>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold mb-2">Start Date</label>
            <input type="date" value={mazeSettings.event_start} onChange={(e) => setMazeSettings({...mazeSettings, event_start: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white" />
          </div>
          <div>
            <label className="block text-sm font-bold mb-2">End Date</label>
            <input type="date" value={mazeSettings.event_end} onChange={(e) => setMazeSettings({...mazeSettings, event_end: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white" />
          </div>
        </div>
        <div>
          <label className="block text-sm font-bold mb-2">Discord Channel ID</label>
          <input type="text" placeholder="e.g. 123456789012345678" value={mazeSettings.channel_id} onChange={(e) => setMazeSettings({...mazeSettings, channel_id: e.target.value})} className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-3 text-white" />
        </div>
        <div className="flex items-center justify-between pt-6 border-t border-slate-800">
          <div>
            <label className="block text-lg font-bold mb-1">Auto-Ping Discounts</label>
            <p className="text-sm text-slate-400">Automatically ping @everyone.</p>
          </div>
          <button onClick={() => setMazeSettings({...mazeSettings, ping_enabled_global: !mazeSettings.ping_enabled_global})} className={`w-14 h-8 rounded-full transition-colors relative ${mazeSettings.ping_enabled_global ? 'bg-green-500' : 'bg-slate-700'}`}>
            <div className={`w-6 h-6 rounded-full bg-white absolute top-1 transition-transform ${mazeSettings.ping_enabled_global ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
        <button onClick={saveMaze} disabled={saving} className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold flex items-center justify-center space-x-2">
          <Save className="w-5 h-5" /><span>{saving ? 'Saving...' : 'Save Maze Settings'}</span>
        </button>
      </div>
    </div>
  )
}
