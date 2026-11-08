'use client'

import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ShieldCheck, ArrowRight, Sparkles, Check, Mail, Loader2, ShieldAlert, X, Clock } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { Card, CardBody, CardHeader, Badge, ProgressBar, Alert, PageHeader } from '@/components/ui'
import { formatDate, toDate } from '@/lib/format'
import { PRICING_PLANS, PLAN_FEATURES, formatPrice, detectCurrency, Currency } from '@/lib/pricing'
import { load as loadCashfree } from '@cashfreepayments/cashfree-js'
import { initializePaddle, Paddle } from '@paddle/paddle-js'

// Helper to format the remaining time beautifully
function formatRemainingTime(endDate: Date | null) {
  if (!endDate) return 'Unknown'
  const diff = endDate.getTime() - Date.now()
  if (diff <= 0) return 'Expired'
  
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days > 30) {
    const months = Math.floor(days / 30)
    return `${months} Month${months > 1 ? 's' : ''}`
  }
  return `${days} Day${days !== 1 ? 's' : ''}`
}

export default function BillingPage() {
  const params = useParams()
  const searchParams = useSearchParams()
  const guildId = params.guildId as string
  const { guild, refresh } = useGuild() 

  const [currency, setCurrency] = useState<Currency>('USD')
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  
  // Initialize Paddle for USD payments
  useEffect(() => {
    initializePaddle({
      environment: (process.env.NEXT_PUBLIC_PADDLE_ENV as 'sandbox' | 'production') || 'sandbox',
      token: process.env.NEXT_PUBLIC_PADDLE_CLIENT_TOKEN || '',
    }).then((paddleInstance) => {
      if (paddleInstance) setPaddle(paddleInstance)
    }).catch((err) => {
      console.error("Paddle failed to initialize:", err)
    })
  }, [])

  useEffect(() => {
    setCurrency(detectCurrency())
    if (searchParams.get('order_id')) {
      refresh()
    }
  }, [searchParams, refresh])

  const status = guild?.premium_status ?? 'expired'
  const premiumEnd = toDate(guild?.premium_ends_at)
  const isPremium = status === 'premium' && premiumEnd !== null && premiumEnd.getTime() > Date.now()
  const isTrial = status === 'trial'
  const trialEnd = toDate(guild?.trial_ends_at)
  
  // Auto-polling for Cashfree webhook delay (only if returning from checkout)
  useEffect(() => {
    if (!searchParams.get('order_id') || isPremium) return
    const id = setInterval(() => { void refresh() }, 3000)
    const stop = setTimeout(() => { clearInterval(id) }, 30000)
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [searchParams, isPremium, refresh])

  let daysLeft = 0
  let trialExpired = false
  if (isTrial && trialEnd) {
    daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000))
    if (daysLeft <= 0) trialExpired = true
  }

  const supportEmail = 'warbot.support@gmail.com'
  const supportHref = `mailto:${supportEmail}?subject=Billing%20Enquiry%20for%20Server%20${guildId}`

  const handlePayment = async (plan: typeof PRICING_PLANS[0]) => {
    setLoadingPlan(plan.id)
    try {
      if (currency === 'INR') {
        // --- CASHFREE FLOW (INDIA) ---
        const res = await fetch('/api/cashfree/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guildId, planId: plan.id, currency })
        })
        
        const data = await res.json()
        if (data.error) throw new Error(data.error)

        const cashfree = await loadCashfree({ mode: "production" })

        cashfree.checkout({
          paymentSessionId: data.payment_session_id,
          redirectTarget: "_modal",
        })
      } else {
        // --- PADDLE FLOW (GLOBAL) ---
        if (!paddle) throw new Error("Paddle is still loading. Please wait a moment and try again.")
        
        paddle.Checkout.open({
          items: [{ priceId: plan.paddlePriceId, quantity: 1 }],
          customData: { guildId: guildId } // Passes the server ID to the webhook
        })
      }
    } catch (error) {
      console.error("Payment failed:", error)
      alert(error instanceof Error ? error.message : "Could not initiate payment.")
    } finally {
      setLoadingPlan(null)
    }
  }

  // --- LOSS AVERSION UI (EXPIRED) ---
  if (!isPremium && (!isTrial || trialExpired)) {
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
              <h2 className="text-2xl font-bold text-white">Your Team is Flying Blind</h2>
              <p className="text-slate-400 mt-1">
                Your subscription has ended. The bot is now paused for this server. 
                <strong className="text-red-300 ml-1">Your alliance is currently missing war timers, race tracking, and maze pings.</strong>
              </p>
            </div>
          </div>
          <div className="bg-slate-950 rounded-lg p-6 border border-slate-800 mb-6">
            <h3 className="font-bold text-lg mb-2 text-white">What you lose while paused:</h3>
            <ul className="space-y-2 text-slate-300 text-sm">
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-red-400" /> No War phase timers or missing attack lists</li>
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-red-400" /> No automated Race node tracking</li>
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-red-400" /> No Maze discount pings</li>
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-red-400" /> Alias and warning data becomes inaccessible</li>
            </ul>
          </div>
          <div className="flex gap-4">
            <button onClick={() => document.getElementById('pricing-plans')?.scrollIntoView({ behavior: 'smooth' })} className="flex-1 py-4 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold text-lg flex items-center justify-center space-x-2 transition-colors">
              <span>Reactivate Bot & Save Team</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div id="pricing-plans" className="mt-8 grid gap-4 sm:grid-cols-2">
          {PRICING_PLANS.map((plan) => (
            <Card key={plan.id} className={`relative overflow-hidden ${plan.highlight ? 'border-purple-500/50 shadow-lg shadow-purple-900/20' : ''}`}>
              {plan.highlight && <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-sky-400" />}
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
                    onClick={() => handlePayment(plan)}
                    disabled={loadingPlan === plan.id}
                    className="w-full mt-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2"
                  >
                    {loadingPlan === plan.id ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Select Plan'}
                  </button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
      </div>
    )
  }

  // --- ACTIVE TRIAL / PREMIUM UI ---
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Plan & Billing"
        title="Subscription"
        description="Manage your server's premium status."
        actions={
          <a href={supportHref} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-slate-700">
            <Mail className="h-4 w-4" /> Contact Support
          </a>
        }
      />

      <Card className="mb-8">
        <CardBody className="flex flex-col sm:flex-row items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${isPremium ? 'bg-purple-500/20 text-purple-400' : 'bg-green-500/20 text-green-400'}`}>
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{isPremium ? 'Premium Active' : 'Free Trial Active'}</h2>
              <p className="text-sm text-slate-400 mt-1">
                {isPremium 
                  ? 'Thank you for supporting the bot! Your server has full access.' 
                  : `You have ${daysLeft} days left in your trial. (Ends ${formatDate(trialEnd)})`}
              </p>
              
              {/* EXPIRY BAR */}
              {isPremium && premiumEnd && (
                <div className="mt-3 inline-flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-purple-300">
                  <Clock className="w-3.5 h-3.5" />
                  Premium expires in {formatRemainingTime(premiumEnd)}
                </div>
              )}
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
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-purple-400" /> Upgrade / Renew
          </h3>
          
          <div className="grid gap-4 sm:grid-cols-2">
            {PRICING_PLANS.map((plan) => (
              <Card key={plan.id} className={`relative overflow-hidden transition-all hover:border-purple-500/50 ${plan.highlight ? 'border-purple-500/30 shadow-lg shadow-purple-900/20' : ''}`}>
                {plan.highlight && <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-purple-500 to-sky-400" />}
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
                      onClick={() => handlePayment(plan)}
                      disabled={loadingPlan === plan.id}
                      className="w-full mt-4 py-3 bg-purple-600 hover:bg-purple-500 text-white font-bold rounded-xl transition-colors flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingPlan === plan.id ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> Processing...</>
                      ) : (
                        <>{isPremium ? 'Extend Plan' : 'Select Plan'} <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
        </div>

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
          <p className="text-xs text-slate-500 px-2 text-center">
            By selecting a plan, you agree to our <a href="/legal" target="_blank" className="text-purple-400 hover:underline">Terms of Service</a>. All payments are strictly non-refundable.
          </p>
        </div>
      </div>
    </div>
  )
}
