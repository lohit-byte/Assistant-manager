'use client'

import { use } from 'react'
import { Swords, Trophy, Map, Settings, ArrowLeft } from 'lucide-react'
import Link from 'next/link'

export default function ServerDashboard({ params }: { params: Promise<{ guildId: string }> }) {
  // Unwrap the params using React.use() for Next.js 15+ compatibility
  const resolvedParams = use(params)
  const guildId = resolvedParams.guildId

  return (
    <div className="min-h-screen bg-slate-950 text-white flex">
      
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col">
        <Link href="/dashboard" className="text-slate-400 hover:text-white flex items-center space-x-2 mb-8">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to servers</span>
        </Link>

        <nav className="space-y-2 flex-1">
          <NavItem icon={<Settings />} label="Overview" active />
          <NavItem icon={<Swords />} label="War Settings" />
          <NavItem icon={<Trophy />} label="Race Settings" />
          <NavItem icon={<Map />} label="Maze Settings" />
        </nav>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-12">
        <h1 className="text-3xl font-bold mb-8">Server Settings</h1>
        
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl max-w-2xl">
          <h2 className="text-xl font-bold mb-4">Welcome to your Dashboard</h2>
          <p className="text-slate-400 mb-6">
            Select a tab on the left to configure the bot for this server. 
            You will be able to set War attack requirements, map Race targets, and schedule Maze events here.
          </p>
          
          <div className="p-4 bg-slate-950 rounded border border-slate-800 text-sm text-slate-500">
            Server ID: {guildId}
          </div>
        </div>
      </main>
    </div>
  )
}

function NavItem({ icon, label, active = false }: { icon: React.ReactNode, label: string, active?: boolean }) {
  return (
    <button className={`w-full flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${active ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}`}>
      {icon}
      <span className="font-medium">{label}</span>
    </button>
  )
}
