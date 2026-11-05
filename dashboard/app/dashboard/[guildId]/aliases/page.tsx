'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation' // <-- ADDED
import { AlertCircle, Trash2, Plus } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const supabase = createClient() // <-- MOVED OUTSIDE COMPONENT

interface Alias {
  id: number;
  discord_id: string;
  alias_name: string;
}

export default function AliasManagerPage() {
  const params = useParams() // <-- ADDED
  const guildId = params.guildId as string // <-- ADDED

  const [loading, setLoading] = useState(true)
  const [aliases, setAliases] = useState<Alias[]>([])
  
  const [newDiscordId, setNewDiscordId] = useState('')
  const [newAliasName, setNewAliasName] = useState('')
  const [message, setMessage] = useState({ text: '', type: '' })

  const fetchAliases = async () => {
    const { data } = await supabase
      .from('aliases')
      .select('*')
      .eq('guild_id', guildId)
      .order('alias_name', { ascending: true })
      
    if (data) setAliases(data)
    setLoading(false)
  }

  useEffect(() => {
    fetchAliases()
  }, [guildId]) // <-- Removed supabase from deps

  const handleAddAlias = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newDiscordId || !newAliasName) return

    const cleanId = newDiscordId.replace(/\D/g, '')
    const cleanAlias = newAliasName.trim().toLowerCase()

    const { error } = await supabase.from('aliases').insert({
      guild_id: guildId,
      discord_id: cleanId,
      alias_name: cleanAlias
    })

    if (error) {
      setMessage({ text: `Failed to add alias: ${error.message}`, type: 'error' })
    } else {
      setMessage({ text: 'Alias added successfully!', type: 'success' })
      setNewDiscordId('')
      setNewAliasName('')
      fetchAliases()
    }
    setTimeout(() => setMessage({ text: '', type: '' }), 3000)
  }

  const handleDelete = async (id: number) => {
    const { error } = await supabase.from('aliases').delete().eq('id', id)
    if (!error) {
      setAliases(aliases.filter(a => a.id !== id))
    }
  }

  if (loading) return <div className="text-slate-400">Loading aliases...</div>

  return (
    <div className="max-w-4xl">
      <h1 className="text-3xl font-bold mb-8">Alias Manager</h1>
      
      {message.text && (
        <div className={`p-4 mb-6 rounded-lg flex items-center space-x-3 ${message.type === 'error' ? 'bg-red-900/50 text-red-200 border border-red-800' : 'bg-green-900/50 text-green-200 border border-green-800'}`}>
          <AlertCircle className="w-5 h-5" /><span>{message.text}</span>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Form Column */}
        <div className="md:col-span-1">
          <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl">
            <h2 className="text-xl font-bold mb-4">Add New Alias</h2>
            <form onSubmit={handleAddAlias} className="space-y-4">
              <div>
                <label className="block text-sm text-slate-400 mb-1">Discord User ID</label>
                <input 
                  type="text" 
                  placeholder="e.g. 704623764008075284"
                  value={newDiscordId}
                  onChange={(e) => setNewDiscordId(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <div>
                <label className="block text-sm text-slate-400 mb-1">Alias Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. sam"
                  value={newAliasName}
                  onChange={(e) => setNewAliasName(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
                />
              </div>
              <button type="submit" className="w-full py-2 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold flex items-center justify-center space-x-2">
                <Plus className="w-4 h-4" /><span>Add Alias</span>
              </button>
            </form>
          </div>
        </div>

        {/* List Column */}
        <div className="md:col-span-2">
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="px-6 py-4 font-medium">Alias</th>
                  <th className="px-6 py-4 font-medium">Discord ID</th>
                  <th className="px-6 py-4 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {aliases.length === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-6 py-8 text-center text-slate-500">
                      No aliases found for this server.
                    </td>
                  </tr>
                ) : (
                  aliases.map((alias) => (
                    <tr key={alias.id} className="hover:bg-slate-800/50 transition-colors">
                      <td className="px-6 py-4 font-bold text-purple-400">{alias.alias_name}</td>
                      <td className="px-6 py-4 font-mono text-slate-400">{alias.discord_id}</td>
                      <td className="px-6 py-4 text-right">
                        <button 
                          onClick={() => handleDelete(alias.id)}
                          className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-900/30 rounded transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
