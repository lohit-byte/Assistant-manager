'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { Save, AlertCircle } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const supabase = typeof window !== 'undefined' ? createClient() : (null as any)

export default function WarSettingsPage() {
  const params = useParams()
  const guildId = params.guildId as string

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })
  const [warSettings, setWarSettings] = useState({ attacks_required: 6, exempt_absent: true })

  useEffect(() => {
    const fetchData = async () => {
      const { data } = await supabase.from('war_settings').select('*').eq('guild_id', guildId).single()
      if (data) {
        setWarSettings({ attacks_required: data.attacks_required || 6, exempt_absent: data.exempt_absent ?? true })
      }
      setLoading(false)
    }
    fetchData()
  }, [guildId])

  const saveWar = async () => {
    setSaving(true)
    const { error } = await supabase.from('war_settings').upsert({
      guild_id: guildId,
      attacks_required: warSettings.attacks_required,
      exempt_absent: warSettings.exempt_absent
    }, { onConflict: 'guild_id' })
    
    if (error) {
      setMessage({ text: `Failed: ${error.message}`, type: 'error' })
    } else {
      setMessage({ text: 'War settings saved successfully!', type: 'success' })
      setTimeout(() => setMessage({ text: '', type: '' }), 3000)
    }
    setSaving(false)
  }

  if (loading) return <div className="text-slate-400">Loading War settings...</div>

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">War Settings</h1>
      {message.text && (
        <div className={`p-4 mb-6 rounded-lg flex items-center space-x-3 ${message.type === 'error' ? 'bg-red-900/50 text-red-200 border border-red-800' : 'bg-green-900/50 text-green-200 border border-green-800'}`}>
          <AlertCircle className="w-5 h-5" />
          <span>{message.text}</span>
        </div>
      )}
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl space-y-8">
        <div>
          <label className="block text-lg font-bold mb-2">Required Attacks</label>
          <input type="range" min="1" max="6" value={warSettings.attacks_required} onChange={(e) => setWarSettings({...warSettings, attacks_required: parseInt(e.target.value)})} className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer" />
          <div className="text-center mt-4 text-2xl font-bold text-purple-400">{warSettings.attacks_required} / 6</div>
        </div>
        <div className="flex items-center justify-between pt-6 border-t border-slate-800">
          <div>
            <label className="block text-lg font-bold mb-1">Exempt Excused Players</label>
            <p className="text-sm text-slate-400">Don't penalize players on the excused list.</p>
          </div>
          <button onClick={() => setWarSettings({...warSettings, exempt_absent: !warSettings.exempt_absent})} className={`w-14 h-8 rounded-full transition-colors relative ${warSettings.exempt_absent ? 'bg-green-500' : 'bg-slate-700'}`}>
            <div className={`w-6 h-6 rounded-full bg-white absolute top-1 transition-transform ${warSettings.exempt_absent ? 'translate-x-7' : 'translate-x-1'}`} />
          </button>
        </div>
        <button onClick={saveWar} disabled={saving} className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold flex items-center justify-center space-x-2">
          <Save className="w-5 h-5" /><span>{saving ? 'Saving...' : 'Save War Settings'}</span>
        </button>
      </div>
    </div>
  )
}
