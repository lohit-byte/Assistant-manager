'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation' // <-- ADDED
import { ShieldCheck, Calendar, ArrowRight, ShieldAlert } from 'lucide-react'
import { createClient } from '@/utils/supabase/client'

const supabase = typeof window !== 'undefined' ? createClient() : (null as any)

export default function BillingPage() {
  const params = useParams() // <-- ADDED
  const guildId = params.guildId as string // <-- ADDED

  const [loading, setLoading] = useState(true)
  const [guildData, setGuildData] = useState<any>(null)

  useEffect(() => {
    const fetchBilling = async () => {
      const { data } = await supabase
        .from('guilds')
        .select('premium_status, trial_ends_at')
        .eq('guild_id', guildId)
        .single()
        
      if (data) setGuildData(data)
      setLoading(false)
    }
    fetchBilling()
  }, [guildId]) // <-- Removed supabase from deps

  if (loading) return <div className="text-slate-400">Loading billing info...</div>
  
  if (!guildData) {
    return (
      <div className="max-w-2xl">
        <h1 className="text-3xl font-bold mb-8">Billing & Plan</h1>
        <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl text-center">
          <p className="text-red-400 mb-4">Server not found in the database.</p>
          <p className="text-slate-400">Make sure the bot has been invited to this server and has started up.</p>
        </div>
      </div>
    )
  }

  // Calculate days left in trial (Fixed the null check bug)
  const isTrial = guildData.premium_status === 'trial'
  const isPremium = guildData.premium_status === 'premium'
  
  let daysLeft = 0
  let isExpired = false
  
  if (isTrial) {
    if (guildData.trial_ends_at) {
      const end = new Date(guildData.trial_ends_at)
      const now = new Date()
      const diffTime = end.getTime() - now.getTime()
      daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
      if (daysLeft <= 0) isExpired = true
    } else {
      // If trial status but no end date, consider it expired/error state
      isExpired = true
    }
  }

  // If status isn't explicitly premium or trial expired
  if (!isPremium && (!isTrial || isExpired)) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold mb-8">Billing & Plan</h1>
        <div className="bg-slate-900 border border-red-900/50 p-8 rounded-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-red-500 to-orange-500" />
          <div className="flex items-start space-x-4 mb-6">
            <div className="p-3 bg-red-900/30 rounded-lg">
              <ShieldAlert className="w-8 h-8 text-red-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">Trial Expired</h2>
              <p className="text-slate-400 mt-1">Your 7-day free trial has ended. The bot is currently paused for this server.</p>
            </div>
          </div>
          <div className="bg-slate-950 rounded-lg p-6 border border-slate-800 mb-6">
            <h3 className="font-bold text-lg mb-2">Premium Features</h3>
            <ul className="space-y-2 text-slate-300 text-sm">
              <li>✓ Unlimited War Tracking & Auto-Pings</li>
              <li>✓ Race Node OCR & Task Management</li>
              <li>✓ Maze Discount Auto-Pings</li>
              <li>✓ Alias Manager</li>
            </ul>
          </div>
          <button className="w-full py-4 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold text-lg flex items-center justify-center space-x-2 transition-colors">
            <span>Upgrade to Premium</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl">
      <h1 className="text-3xl font-bold mb-8">Billing & Plan</h1>
      
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl relative overflow-hidden">
        {isPremium ? (
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-purple-500 to-blue-500" />
        ) : (
           <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-400 to-emerald-500" />
        )}
        
        <div className="flex items-start justify-between">
          <div className="flex items-start space-x-4">
            <div className={`p-3 rounded-lg ${isPremium ? 'bg-purple-900/30' : 'bg-green-900/30'}`}>
              <ShieldCheck className={`w-8 h-8 ${isPremium ? 'text-purple-400' : 'text-green-400'}`} />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-white">
                {isPremium ? 'Premium Plan' : 'Free Trial Active'}
              </h2>
              <p className="text-slate-400 mt-1">
                {isPremium ? 'Thank you for supporting the bot!' : `You have ${daysLeft} days left in your trial.`}
              </p>
            </div>
          </div>
        </div>

        {!isPremium && (
          <div className="mt-8 bg-slate-950 rounded-lg p-6 border border-slate-800 flex items-center justify-between">
            <div>
              <p className="font-bold text-white mb-1">Trial Ends On</p>
              <div className="flex items-center space-x-2 text-slate-400">
                <Calendar className="w-4 h-4" />
                <span>{new Date(guildData.trial_ends_at).toLocaleDateString()}</span>
              </div>
            </div>
            <button className="px-6 py-2 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-lg transition-colors">
              Upgrade Now
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
