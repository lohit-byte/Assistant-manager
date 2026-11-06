'use client'

import { createClient } from '@/utils/supabase/client'
import { Shield, Swords, Trophy, Map } from 'lucide-react'

const supabase = createClient()

export default function LandingPage() {
  const handleDiscordLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'identify guilds' 
      },
    })
  }

  return (
    <div className="min-h-screen bg-slate-950 text-white flex flex-col items-center justify-center p-6">
      
      {/* Hero Section */}
      <div className="max-w-3xl text-center space-y-6 mt-12">
        <h1 className="text-5xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-purple-400 to-blue-500">
          Monster Legends Assistant
        </h1>
        <p className="text-xl text-slate-400">
          The ultimate Discord bot for War, Race, and Maze tracking. 
          Automate your alliance, track missing attacks, and never miss a discount again.
        </p>

        {/* Login Button */}
        <button
          onClick={handleDiscordLogin}
          className="mt-8 px-8 py-4 bg-[#5865F2] hover:bg-[#4752C4] text-white font-bold rounded-lg transition-all flex items-center justify-center mx-auto space-x-2 shadow-lg"
        >
          <svg className="w-6 h-6 fill-current" viewBox="0 0 127.14 96.36">
            <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z"/>
          </svg>
          <span>Login with Discord</span>
        </button>
      </div>

      {/* Features Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mt-20 max-w-5xl w-full">
        <FeatureCard icon={<Swords />} title="War" desc="Track timers and missing attacks" />
        <FeatureCard icon={<Trophy />} title="Race" desc="OCR nodes and DYP tracking" />
        <FeatureCard icon={<Map />} title="Maze" desc="Auto-ping discounts" />
        <FeatureCard icon={<Shield />} title="Aliases" desc="Manage player names" />
      </div>

      {/* FOOTER - Correctly placed at the bottom of the page */}
      <footer className="mt-auto pt-16 pb-8 text-center text-sm text-slate-500 w-full max-w-4xl flex justify-center space-x-6">
        <a href="/contact" className="hover:text-white transition-colors">Contact Us</a>
        <a href="/contact" className="hover:text-white transition-colors">Terms of Service</a>
        <a href="/contact" className="hover:text-white transition-colors">Privacy Policy</a>
      </footer>

    </div>
  )
}

function FeatureCard({ icon, title, desc }: { icon: React.ReactNode, title: string, desc: string }) {
  return (
    <div className="p-6 bg-slate-900 rounded-xl border border-slate-800 flex flex-col items-center text-center">
      <div className="text-purple-400 mb-3">{icon}</div>
      <h3 className="font-bold text-lg mb-1">{title}</h3>
      <p className="text-sm text-slate-400">{desc}</p>
    </div>
  )
}
