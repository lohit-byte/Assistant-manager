'use client'

import { use } from 'react'
import { Swords, Trophy, Map, Settings, ArrowLeft, Users, CreditCard } from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function DashboardLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ guildId: string }>
}) {
  // Unwrap params for Next.js 15+
  const resolvedParams = use(params)
  const guildId = resolvedParams.guildId
  const pathname = usePathname()

  const navItems = [
    { name: 'Overview', href: `/dashboard/${guildId}`, icon: <Settings className="w-5 h-5" /> },
    { name: 'War Settings', href: `/dashboard/${guildId}/war`, icon: <Swords className="w-5 h-5" /> },
    { name: 'Race Settings', href: `/dashboard/${guildId}/race`, icon: <Trophy className="w-5 h-5" /> },
    { name: 'Maze Settings', href: `/dashboard/${guildId}/maze`, icon: <Map className="w-5 h-5" /> },
    { name: 'Alias Manager', href: `/dashboard/${guildId}/aliases`, icon: <Users className="w-5 h=5" /> },
    { name: 'Billing & Plan', href: `/dashboard/${guildId}/billing`, icon: <CreditCard className="w-5 h=5" /> },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white flex">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 p-6 flex flex-col">
        <Link href="/dashboard" className="text-slate-400 hover:text-white flex items-center space-x-2 mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          <span>Back to servers</span>
        </Link>

        <nav className="space-y-2 flex-1">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                  isActive ? 'bg-purple-600 text-white' : 'text-slate-400 hover:bg-slate-800 hover:text-white'
                }`}
              >
                {item.icon}
                <span className="font-medium">{item.name}</span>
              </Link>
            )
          })}
        </nav>
      </aside>

      {/* Page Content */}
      <main className="flex-1 p-12 overflow-y-auto">
        {children}
      </main>
    </div>
  )
}
