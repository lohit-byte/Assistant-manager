'use client'

import { use, useEffect, useState } from 'react'
import { Swords, Trophy, Map, Settings, ArrowLeft, Save, AlertCircle } from 'lucide-react'
import Link from 'next/link'
import { createClient } from '@/utils/supabase/client'

export default function ServerDashboard({ params }: { params: Promise<{ guildId: string }> }) {
  const resolvedParams = use(params)
  const guildId = resolvedParams.guildId
  const supabase = createClient()

  const [activeTab, setActiveTab] = useState<'overview' | 'war' | 'race' | 'maze'>('overview')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState({ text: '', type: '' })

  // War Settings State
  const [warSettings, setWarSettings] = useState({
    attacks_required: 6,
    exempt_absent: true
  })

  // Fetch Settings on Load
  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true)
      const { data, error } = await supabase
        .from('war_settings')
        .select('*')
        .eq('guild_id', guildId)
        .single()

      if (data) {
        setWarSettings({
          attacks_required: data.attacks_required || 6,
          exempt_absent: data.exempt_absent ?? true
        })
      }
      setLoading(false)
    }

    fetchSettings()
  }, [guildId, supabase])

  // Save War Settings
  const saveWarSettings = async () => {
    setSaving(true)
    setMessage({ text: '', type: '' })

    const { error } = await supabase
      .from('war_settings')
      .upsert({
        guild_id: guildId,
        attacks_required: warSettings.attacks_required,
        exempt_absent: warSettings.exempt_absent
      }, { onConflict: 'guild_id' })

    if (error) {
      setMessage({ text: 'Failed to save settings: ' + error.message, type: 'error' })
    } else {
      setMessage({ text: 'Settings saved successfully! The bot is now updated.', type: 'success' })
      setTimeout(() => setMessage({ text: '', type: '' }), 3000)
    }
    setSaving(false)
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex">
      
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col">
        <Link href="/dashboard" className="text-slate-400 hover:text-white flex items-center space-x-2 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to servers</span>
        </Link>

        <nav className="space-y-2 flex-1">
          <NavItem 
            icon={<Settings />} label="Overview" 
            active={activeTab === 'overview'} onClick={() => setActiveTab('overview')} 
          />
          <NavItem 
            icon={<Swords />} label="War Settings" 
            active={activeTab === 'war'} onClick={() => setActiveTab('war')} 
          />
          <NavItem 
            icon={<Trophy />} label="Race Settings" 
            active={activeTab === 'race'} onClick={() => setActiveTab('race')} 
          />
          <NavItem 
            icon={<Map />} label="Maze Settings" 
            active={activeTab === 'maze'} onClick={() => setActiveTab('maze')} 
          />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-12">
        {loading ? (
          <div className="text-slate-400">Loading server settings...</div>
        ) : (
          <>
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <div>
                <h1 className="text-3xl font-bold mb-8">Server Overview</h1>
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl max-w-2xl">
                  <h2 className="text-xl font-bold mb-4">Welcome to your Dashboard</h2>
                  <p className="text-slate-400 mb-6">
                    Select a tab on the left to configure the bot for this server.
                  </p>
                  <div className="p-4 bg-slate-950 rounded border border-slate-800 text-sm text-slate-500 font-mono">
                    Guild ID: {guildId}
                  </div>
                </div>
              </div>
            )}

            {/* WAR TAB */}
            {activeTab === 'war' && (
              <div className="max-w-2xl">
                <h1 className="text-3xl font-bold mb-8">War Settings</h1>
                
                {message.text && (
                  <div className={`p-4 mb-6 rounded-lg flex items-center space-x-3 ${message.type === 'error' ? 'bg-red-900/50 text-red-200 border border-red-800' : 'bg-green-900/50 text-green-200 border border-green-800'}`}>
                    <AlertCircle className="w-5 h-5" />
                    <span>{message.text}</span>
                  </div>
                )}

                <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl space-y-8">
                  
                  {/* Required Attacks */}
                  <div>
                    <label className="block text-lg font-bold mb-2">Required Attacks</label>
                    <p className="text-sm text-slate-400 mb-4">
                      The number of attacks each player must complete. Max is 6.
                    </p>
                    <input 
                      type="range" min="1" max="6" 
                      value={warSettings.attacks_required}
                      onChange={(e) => setWarSettings({...warSettings, attacks_required: parseInt(e.target.value)})}
                      className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
                    />
                    <div className="text-center mt-4 text-2xl font-bold text-purple-400">
                      {warSettings.attacks_required} / 6
                    </div>
                  </div>

                  {/* Exempt Absent */}
                  <div className="flex items-center justify-between pt-6 border-t border-slate-800">
                    <div>
                      <label className="block text-lg font-bold mb-1">Exempt Excused Players</label>
                      <p className="text-sm text-slate-400">
                        If enabled, players on the excused list won't appear in the "below required attacks" report.
                      </p>
                    </div>
                    <button 
                      onClick={() => setWarSettings({...warSettings, exempt_absent: !warSettings.exempt_absent})}
                      className={`w-14 h-8 rounded-full transition-colors relative ${warSettings.exempt_absent ? 'bg-green-500' : 'bg-slate-700'}`}
                    >
                      <div className={`w-6 h-6 rounded-full bg-white absolute top-1 transition-transform ${warSettings.exempt_absent ? 'translate-x-7' : 'translate-x-1'}`} />
                    </button>
                  </div>

                  {/* Save Button */}
                  <div className="pt-6">
                    <button 
                      onClick={saveWarSettings}
                      disabled={saving}
                      className="w-full py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold flex items-center justify-center space-x-2 transition-colors disabled:opacity-50"
                    >
                      <Save className="w-5 h-5" />
                      <span>{saving ? 'Saving...' : 'Save War Settings'}</span>
                    </button>
                  </div>

                </div>
              </div>
            )}

            {/* RACE & MAZE TABS (Placeholders for now) */}
            {(activeTab === 'race' || activeTab === 'maze') && (
              <div className="max-w-2xl">
                <h1 className="text-3xl font-bold mb-8 capitalize">{activeTab} Settings</h1>
                <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl">
                  <p className="text-slate-400">This section is coming soon!</p>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function NavItem({ icon, label, active = false, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) {
  return (
    <button 
      onClick={onClick}
      className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${active ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}
    >
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  )
}
