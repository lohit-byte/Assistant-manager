'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/utils/supabase/client'
import { useRouter } from 'next/navigation'
import { Server, Plus } from 'lucide-react'

export default function Dashboard() {
  const [guilds, setGuilds] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const supabase = createClient()
  const router = useRouter()

  useEffect(() => {
    const fetchGuilds = async () => {
      // 1. Get current session
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        router.push('/') // Kick back to login if no session
        return
      }

      // 2. Get provider token (Discord Access Token)
      const providerToken = session.provider_token
      if (!providerToken) {
        console.error("No provider token found")
        setLoading(false)
        return
      }

      // 3. Fetch user's Discord guilds using the token
      const res = await fetch('https://discord.com/api/users/@me/guilds', {
        headers: { Authorization: `Bearer ${providerToken}` }
      })
      const data = await res.json()

      // 4. Filter guilds where user has MANAGE_GUILD (0x20) or ADMINISTRATOR (0x8)
      const adminGuilds = data.filter((g: any) => {
        const permissions = BigInt(g.permissions)
        return (permissions & BigInt(0x20)) === BigInt(0x20) || (permissions & BigInt(0x8)) === BigInt(0x8)
      })

      setGuilds(adminGuilds)
      setLoading(false)
    }

    fetchGuilds()
  }, [router, supabase.auth])

  if (loading) {
    return <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">Loading servers...</div>
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-5xl mx-auto">
        <header className="mb-12">
          <h1 className="text-3xl font-bold">Select a Server</h1>
          <p className="text-slate-400 mt-2">Choose a server to manage the bot settings.</p>
        </header>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {guilds.map((guild) => (
            <button 
              key={guild.id}
              onClick={() => { window.location.href = `/dashboard/${guild.id}` }}
              className="p-6 bg-slate-900 border border-slate-800 rounded-xl hover:border-purple-500 hover:bg-slate-800 transition-all flex items-center space-x-4 text-left"
            >
              {guild.icon ? (
                <img src={`https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png`} alt="icon" className="w-12 h-12 rounded-full" />
              ) : (
                <div className="w-12 h-12 rounded-full bg-slate-700 flex items-center justify-center">
                  <Server className="w-6 h-6 text-slate-400" />
                </div>
              )}
              <div>
                <h3 className="font-bold text-lg">{guild.name}</h3>
                <p className="text-sm text-slate-400">Click to manage</p>
              </div>
            </button>
          ))}

          {/* Invite Bot Card */}
          <a 
            href="https://discord.com/oauth2/authorize?client_id=1567228271915962499&permissions=257088&integration_type=0&scope=bot" 
            target="_blank" 
            rel="noopener noreferrer"
            className="p-6 bg-slate-900 border border-dashed border-slate-700 rounded-xl hover:border-green-500 hover:bg-slate-800 transition-all flex items-center space-x-4 text-left text-slate-400 hover:text-green-400"
          >
            <div className="w-12 h-12 rounded-full bg-slate-800 flex items-center justify-center">
              <Plus className="w-6 h-6" />
            </div>
            <div>
              <h3 className="font-bold text-lg">Invite Bot</h3>
              <p className="text-sm">Add to a new server</p>
            </div>
          </a>
        </div>
      </div>
    </div>
  )
}
