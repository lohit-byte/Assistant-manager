'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { ShieldCheck, Calendar, ArrowRight, ShieldAlert, Sparkles, Check, Mail } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { Card, CardBody, CardHeader, Badge, ProgressBar, Alert, Divider, PageHeader } from '@/components/ui'
import { createClient } from '@/lib/supabase/client' // <--- FIXED PATH
import { formatDate, toDate } from '@/lib/format'
import { PRICING_PLANS, PLAN_FEATURES, formatPrice, detectCurrency, Currency } from '@/lib/pricing'

const supabase = createClient()

export default function BillingPage() {
  const params = useParams()
  const guildId = params.guildId as string
  const { guild } = useGuild() // Get guild data from the shell to avoid extra fetches

  const [currency, setCurrency] = useState<Currency>('USD')
  
  // Prevent hydration mismatch by detecting currency after mount
  useEffect(() => {
    setCurrency(detectCurrency())
  }, [])

  const status = guild?.premium_status ?? 'expired'
  const isPremium = status === 'premium'
  const trialEnd = toDate(guild?.trial_ends_at)
  
  let daysLeft = 0
  let trialExpired = false
  
  if (status === 'trial' && trialEnd) {
    daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000))
    if (daysLeft <= 0) trialExpired = true
  }

  const supportEmail = 'warbot.support@gmail.com'
  const supportHref = `mailto:${supportEmail}?subject=Billing%20Enquiry%20for%20Server%20${guildId}`

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Plan & Billing"
        title="Subscription"
        description="Manage your server's premium status. All features are unlocked during your trial."
        actions={
          <a href={supportHref} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700">
            <Mail className="h-4 w-4" />
            Contact Support
          </a>
        }
      />

      {guild?.is_blacklisted && (
        <Alert tone="red" className="mb-6" title="This server is blacklisted">
          The bot will not respond in this server while the blacklist is active. Contact support if you believe this is a mistake.
        </Alert>
      )}

      {/* Current Status */}
      <Card className="mb-8">
        <CardBody className="flex flex-col sm:flex-row items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${isPremium ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'}`}>
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">
                {isPremium ? 'Premium Active' : 'Free Trial Active'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isPremium 
                  ? 'Thank you for supporting the bot! Your server has full access.' 
                  : `You have ${daysLeft} days left in your trial. (Ends ${formatDate(trialEnd)})`}
              </p>
            </div>
          </div>
          
          {!isPremium && (
            <div className="w-full sm:w-64">
               <ProgressBar value={daysLeft} max={7} tone={daysLeft <= 2 ? 'red' : daysLeft <= 4 ? 'amber' : 'green'} label="Trial Progress" />
            </div>
          )}
        </CardBody>
      </Card>

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        {/* Pricing Cards */}
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" />
            Upgrade to Premium
          </h3>
          
          <div className="grid gap-4 sm:grid-cols-2">
            {PRICING_PLANS.map((plan) => (
              <Card key={plan.id} className={`relative overflow-hidden transition-all hover:border-purple-500/50 ${plan.highlight ? 'border-purple-500/30 shadow-lg shadow-purple-900/20' : ''}`}>
                {plan.highlight && (
                  <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-sky-400" />
                )}
                <CardBody className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-white">{plan.name}</h4>
                      <p className="text-xs text-slate-400 mt-1">{plan.description}</p>
                    </div>
                    {plan.badge && <Badge tone="purple">{plan.badge}</Badge>}
                  </div>
                  
                  <div className="mt-auto pt-6">
                    <p className="text-3xl font-extrabold text-white">
                      {formatPrice(plan.price[currency], currency)}
                      <span className="text-sm font-normal text-slate-400"> / {plan.cadence}</span>
                    </p>
                    <button className="w-full mt-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2">
                      Select Plan <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          <Alert tone="blue" title="Payment Integration coming soon">
            We are currently finalizing our payment gateway. If you would like to upgrade right now, please email us at <strong>{supportEmail}</strong> and we will manually activate your premium plan.
          </Alert>
        </div>

        {/* Features List */}
        <div>
          <Card>
            <CardHeader title="What's included" icon={<ShieldCheck className="w-5 h-5" />} />
            <CardBody>
              <ul className="space-y-3">
                {PLAN_FEATURES.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      </div>
    </div>
  )
}
