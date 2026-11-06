'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ShieldCheck, ArrowRight, Sparkles, Check, Mail, Loader2 } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { Card, CardBody, CardHeader, Badge, ProgressBar, Alert, PageHeader } from '@/components/ui'
import { formatDate, toDate } from '@/lib/format'
import { PRICING_PLANS, PLAN_FEATURES, formatPrice, detectCurrency, Currency } from '@/lib/pricing'

export default function BillingPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const guildId = params.guildId as string
  
  // useGuild gives us the data AND the refresh function to update the UI
  const { guild, refresh } = useGuild() 

  const [currency, setCurrency] = useState<Currency>('USD')
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  
  useEffect(() => {
    // Detect currency to prevent hydration mismatch
    setCurrency(detectCurrency())

    // If the URL has 'order_id', the user just returned from Cashfree.
    // We refresh the guild data to instantly unlock Premium on the dashboard.
    if (searchParams.get('order_id')) {
      refresh()
    }
  }, [searchParams, refresh])

  const status = guild?.premium_status ?? 'expired'
  const isPremium = status === 'premium'
  const trialEnd = toDate(guild?.trial_ends_at)
  
  let daysLeft = 0
  if (status === 'trial' && trialEnd) {
    daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000))
  }

  const supportEmail = 'warbot.support@gmail.com'
  const supportHref = `mailto:${supportEmail}?subject=Billing%20Enquiry%20for%20Server%20${guildId}`

  // --- CASHFREE PAYMENT LOGIC ---
  const handlePayment = async (planId: string, amount: number) => {
    setLoadingPlan(planId)
    try {
      const res = await fetch('/api/cashfree/create-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guildId, planId, amount, currency })
      })
      
      const data = await res.json()
      if (data.error) throw new Error(data.error)

      const cashfree = await (window as any).Cashfree({
        mode: "sandbox" // Change to "production" when ready
      })

      cashfree.checkout({
        paymentSessionId: data.payment_session_id,
        redirectTarget: "_modal",
      })
      
    } catch (error) {
      console.error("Payment failed:", error)
      alert("Could not initiate payment. Please ensure your Cashfree keys are set in Vercel.")
    } finally {
      setLoadingPlan(null)
    }
  }

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
                    
                    <button 
                      onClick={() => handlePayment(plan.id, plan.price[currency])}
                      disabled={loadingPlan === plan.id || isPremium}
                      className="w-full mt-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingPlan === plan.id ? (
                        <>
                          <Loader2 className="w-5 h-5 animate-spin" /> Processing...
                        </>
                      ) : isPremium ? (
                        'Current Plan'
                      ) : (
                        <>
                          Select Plan <ArrowRight className="w-4 h-4" />
                        </>
                      )}
                    </button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>

          <Alert tone="amber" title="Test Mode">
            Payments are currently running in sandbox mode. No real money will be deducted. 
            If you want to manually activate, email <strong>{supportEmail}</strong>.
          </Alert>
        </div>

        {/* Features List */}
        <div className="space-y-4">
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
          
          {/* CASHFREE LEGAL WARNING */}
          <p className="text-xs text-slate-500 px-2 text-center">
            By selecting a plan, you agree to our <a href="/legal" target="_blank" className="text-purple-400 hover:underline">Terms of Service</a>. All payments are strictly non-refundable.
          </p>
        </div>
      </div>
    </div>
  )
}
