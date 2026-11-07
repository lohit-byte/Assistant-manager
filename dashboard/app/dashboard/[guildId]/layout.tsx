'use client'

import { Swords, Trophy, Map, Settings, ArrowLeft, Users, CreditCard, X, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { usePathname, useParams } from 'next/navigation'
import { useState, useEffect } from 'react'
import { Badge, Button } from '@/components/ui'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const params = useParams()
  const guildId = params.guildId as string
  const pathname = usePathname()

  const navItems = [
    { name: 'Overview', href: `/dashboard/${guildId}`, icon: <Settings className="w-5 h-5" /> },
    { name: 'War Settings', href: `/dashboard/${guildId}/war`, icon: <Swords className="w-5 h-5" /> },
    { name: 'Race Settings', href: `/dashboard/${guildId}/race`, icon: <Trophy className="w-5 h-5" /> },
    { name: 'Maze Settings', href: `/dashboard/${guildId}/maze`, icon: <Map className="w-5 h-5" /> },
    { name: 'Alias Manager', href: `/dashboard/${guildId}/aliases`, icon: <Users className="w-5 h-5" /> },
    { name: 'Billing & Plan', href: `/dashboard/${guildId}/billing`, icon: <CreditCard className="w-5 h-5" /> },
  ]

  return (
    <div className="min-h-screen bg-slate-950 text-white flex">
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
      <main className="flex-1 p-12 overflow-y-auto">
        {children}
      </main>
      
      <OnboardingTour />
    </div>
  )
}

// --- ONBOARDING TOUR COMPONENT ---
function OnboardingTour() {
  const [step, setStep] = useState(0)
  const [isVisible, setIsVisible] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('ml_tour_seen')) {
      setIsVisible(true)
    }
  }, [])

  if (!isVisible) return null

  const steps = [
    { title: "Welcome to your Dashboard!", text: "This is your command center. The bot does the heavy lifting in Discord, and this website gives you a live view of your server." },
    { title: "Live War Tracking", text: "Click 'War' on the left to see your 48-hour timers, who missed attacks, and attack logs updated in real-time." },
    { title: "Race & Maze Automation", text: "Upload community JSON sheets for the Race, or schedule Maze events so the bot auto-pings your team." }
  ]

  const handleNext = () => {
    if (step < steps.length - 1) setStep(step + 1)
    else {
      localStorage.setItem('ml_tour_seen', 'true')
      setIsVisible(false)
    }
  }

  return (
    <div className="fixed bottom-8 right-8 z-50 w-80 bg-slate-900 border border-purple-500/50 shadow-2xl rounded-2xl p-6">
      <button onClick={() => { localStorage.setItem('ml_tour_seen', 'true'); setIsVisible(false) }} className="absolute top-4 right-4 text-slate-500 hover:text-white">
        <X className="w-4 h-4" />
      </button>
      <Badge tone="purple" className="mb-3">Step {step + 1} of {steps.length}</Badge>
      <h3 className="text-lg font-bold text-white mb-2">{steps[step].title}</h3>
      <p className="text-sm text-slate-400 mb-6">{steps[step].text}</p>
      <div className="flex justify-between items-center">
        <button onClick={() => { localStorage.setItem('ml_tour_seen', 'true'); setIsVisible(false) }} className="text-xs text-slate-500 hover:text-white">Skip Tour</button>
        <Button size="sm" onClick={handleNext}>
          {step === steps.length - 1 ? 'Finish' : 'Next'} <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  )
}
