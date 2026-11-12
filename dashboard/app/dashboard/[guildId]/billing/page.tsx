'use client'

import { useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'next/navigation'
import { ShieldCheck, ArrowRight, Sparkles, Check, Mail, Loader2, ShieldAlert, X, Clock } from 'lucide-react'
import { useGuild } from '@/components/guild-shell'
import { useToast } from '@/lib/toast'
import { Card, CardBody, CardHeader, Badge, ProgressBar, Alert, PageHeader } from '@/components/ui'
import { StaffOnlyPanel } from '@/components/staff-only'
import { formatDate, toDate } from '@/lib/format'
import { PRICING_PLANS, PLAN_FEATURES, formatPrice, detectCurrency, perMonthPrice, yearlySavings, Currency } from '@/lib/pricing'
import { TRIAL_DAYS } from '@/lib/constants'
import { effectiveTeamLimit, isPremiumActive, planLabel, teamLimitLabel } from '@/lib/plans'
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
  const { isStaff } = useGuild()
  if (!isStaff) return <StaffOnlyPanel area="Billing" />
  return <BillingContent />
}

function BillingContent() {
  const params = useParams()
  const searchParams = useSearchParams()
  const guildId = params.guildId as string
  const { guild, refresh } = useGuild() 

  const [currency, setCurrency] = useState<Currency>('USD')
  const [loadingPlan, setLoadingPlan] = useState<string | null>(null)
  const [paddle, setPaddle] = useState<Paddle | null>(null)
  const [paymentError, setPaymentError] = useState<string | null>(null)
  const toast = useToast()
  // Keeps the checkout-return toast to one, even while the polling refresh re-renders.
  const paymentToastShown = useRef(false)
  
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
  const isPremium = isPremiumActive(guild ?? {})
  const isTrial = status === 'trial'
  const trialEnd = toDate(guild?.trial_ends_at)
  const teamLimit = effectiveTeamLimit(guild ?? {})
  const activePlanLabel = planLabel(guild ?? {})
  
  // Auto-polling for Cashfree webhook delay (only if returning from checkout)
  useEffect(() => {
    if (!searchParams.get('order_id') || isPremium) return
    const id = setInterval(() => { void refresh() }, 3000)
    const stop = setTimeout(() => { clearInterval(id) }, 30000)
    return () => { clearInterval(id); clearTimeout(stop) }
  }, [searchParams, isPremium, refresh])

  // Confirm the paid upgrade exactly once when the checkout redirect brings the user back.
  useEffect(() => {
    if (paymentToastShown.current) return
    if (!searchParams.get('order_id') || !isPremium) return
    paymentToastShown.current = true
    toast.success(
      'Payment received — premium is active.',
      'The bot keeps running — nothing else is needed.',
    )
  }, [isPremium, searchParams, toast])

  let daysLeft = 0
  let trialExpired = false
  if (isTrial && trialEnd) {
    daysLeft = Math.max(0, Math.ceil((trialEnd.getTime() - Date.now()) / 86_400_000))
    if (daysLeft <= 0) trialExpired = true
  }

  // Price-anchor baseline: what the same year would cost on the monthly plan.
  const proMonthlyPrice =
    PRICING_PLANS.find((plan) => plan.id === 'pro_monthly')?.price[currency] ?? 0

  const supportEmail = 'warbot.support@gmail.com'
  const supportHref = `mailto:${supportEmail}?subject=Billing%20Enquiry%20for%20Server%20${guildId}`

  // Checkout failures stay on the page: staff needs the next step, not a browser alert.
  const paymentErrorAlert = paymentError ? (
    <Alert
      tone="red"
      title="Checkout could not start"
      className="mb-6"
      onDismiss={() => setPaymentError(null)}
    >
      {paymentError} Try again in a moment. If it still fails, email{' '}
      <a
        href={supportHref}
        className="text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-300"
      >
        {supportEmail}
      </a>{' '}
      with your server ID ({guildId}) and we’ll sort it out.
    </Alert>
  ) : null

  const handlePayment = async (plan: typeof PRICING_PLANS[0]) => {
    setLoadingPlan(plan.id)
    setPaymentError(null)
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
          customData: { guildId: guildId, planId: plan.id } // Passes the server ID to the webhook
        })
      }
    } catch (error) {
      console.error("Payment failed:", error)
      setPaymentError(
        error instanceof Error ? error.message : 'Could not start checkout.',
      )
    } finally {
      setLoadingPlan(null)
    }
  }

  // --- LOSS AVERSION UI (EXPIRED) ---
  if (!isPremium && (!isTrial || trialExpired)) {
    return (
      <div className="max-w-3xl">
        <h1 className="text-3xl font-bold mb-3">Billing &amp; Plan</h1>
        <p className="mb-6 max-w-2xl text-sm leading-relaxed text-slate-400">
          Pick a plan to turn the bot back on for this server. Prices are charged in {currency}:
          USD goes through Paddle and INR goes through Cashfree.
        </p>
        {paymentErrorAlert}
        <div className="bg-slate-900 border border-danger-500/30 p-8 rounded-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-danger-500 to-accent-500" />
          <div className="flex items-start space-x-4 mb-6">
            <div className="p-3 bg-danger-500/10 rounded-lg">
              <ShieldAlert className="w-8 h-8 text-danger-400" />
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-50">Your Team is Flying Blind</h2>
              <p className="text-slate-400 mt-1">
                Your subscription has ended. The bot is now paused for this server. 
                <strong className="text-danger-300 ml-1">Your alliance is currently missing war timers, race tracking, and maze pings.</strong>
              </p>
              <p className="text-xs text-slate-500 mt-2">
                {premiumEnd ? `Tracking paused since ${formatDate(premiumEnd)}. ` : ''}
                Nothing was deleted: teams, aliases, settings and war/race/maze history are kept.
                Reactivating takes one click — no setup again.
              </p>
            </div>
          </div>
          <div className="bg-slate-950 rounded-lg p-6 border border-slate-800 mb-6">
            <h3 className="font-bold text-lg mb-2 text-slate-50">What you lose while paused:</h3>
            <ul className="space-y-2 text-slate-300 text-sm">
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-danger-400" /> No War phase timers or missing attack lists</li>
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-danger-400" /> No automated Race node tracking</li>
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-danger-400" /> No Maze discount pings</li>
              <li className="flex items-center gap-2"><X className="w-4 h-4 text-danger-400" /> Alias and warning data becomes inaccessible</li>
            </ul>
          </div>
          <div className="flex gap-4">
            <button onClick={() => document.getElementById('pricing-plans')?.scrollIntoView({ behavior: 'smooth' })} className="flex-1 py-4 bg-accent-600 hover:bg-accent-500 text-accent-ink rounded-lg font-bold text-lg flex items-center justify-center space-x-2 transition-colors">
              <span>Reactivate Bot & Save Team</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <p className="mt-8 text-xs leading-relaxed text-slate-500">
          Choose the plan that fits your team. Yearly plans cost less per month, and every plan
          opens a secure hosted checkout.
        </p>
        <div id="pricing-plans" className="mt-3 grid gap-4 sm:grid-cols-2">
          {PRICING_PLANS.map((plan) => (
            <Card key={plan.id} className={`relative overflow-hidden ${plan.highlight ? 'border-accent-500/50 shadow-lg shadow-accent-900/20' : ''}`}>
              {plan.highlight && <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-accent-500 to-steel-400" />}
              <CardBody className="p-6 flex flex-col h-full">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h4 className="text-lg font-bold text-slate-50">{plan.name}</h4>
                    <p className="text-xs text-slate-400 mt-1">{plan.description}</p>
                  </div>
                  {plan.badge && (
                    <Badge tone="purple" className="whitespace-nowrap">
                      {plan.id === 'elite_yearly' ? `Save ${yearlySavings(currency)}%` : plan.badge}
                    </Badge>
                  )}
                </div>
                <div className="mt-auto pt-6">
                  <p className="text-3xl font-extrabold text-slate-50">
                    {formatPrice(plan.price[currency], currency)}
                    <span className="text-sm font-normal text-slate-400"> / {plan.cadence}</span>
                  </p>
                  {plan.cadence === 'year' ? (
                    <p className="mt-1 text-xs text-slate-500">
                      <s className="text-slate-600">{formatPrice(proMonthlyPrice * 12, currency)}</s>{' '}
                      billed monthly · save {yearlySavings(currency)}% ·{' '}
                      {formatPrice(perMonthPrice(plan, currency), currency)}/month
                    </p>
                  ) : (
                    <p className="mt-1 text-xs text-slate-500">Billed monthly · cancel any time</p>
                  )}
                  <button 
                    onClick={() => handlePayment(plan)}
                    disabled={loadingPlan === plan.id}
                    className="w-full mt-4 py-3 bg-accent-600 hover:bg-accent-500 text-accent-ink font-bold rounded-xl transition-colors flex justify-center items-center gap-2"
                  >
                    {loadingPlan === plan.id ? <Loader2 className="w-5 h-5 animate-spin" /> : 'Select Plan'}
                  </button>
                </div>
              </CardBody>
            </Card>
          ))}
        </div>
        <p className="mt-4 text-xs leading-relaxed text-slate-500">
          Secure checkout via Paddle (USD) or Cashfree (INR); the provider follows the currency
          shown. Your card details stay with the payment provider and never touch our servers.
          Cancel any time; access continues to the end of the paid period. Payments are
          non-refundable, as described in the{' '}
          <a href="/legal#refund" className="inline-block py-1.5 text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-300">refund policy</a>.
        </p>
        <p className="mt-2 text-xs leading-relaxed text-slate-500">
          Paid but the plan still looks unchanged? Wait a few seconds for the payment provider to
          confirm, then refresh this page. If it still shows the old plan, email{' '}
          <a href={supportHref} className="inline-block py-1.5 text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-300">{supportEmail}</a>{' '}
          with your server ID ({guildId}) and we’ll fix it.
        </p>
      </div>
    )
  }

  // --- ACTIVE TRIAL / PREMIUM UI ---
  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Plan & Billing"
        title="Subscription"
        description={`Manage this server’s premium status. For billing help, email ${supportEmail} with your server ID (${guildId}).`}
        actions={
          <a href={supportHref} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800/80 px-4 py-2 text-sm font-semibold text-slate-50 transition-colors hover:bg-slate-700">
            <Mail className="h-4 w-4" /> Contact Support
          </a>
        }
      />

      {paymentErrorAlert}

      <Card className="mb-8">
        <CardBody className="flex flex-col sm:flex-row items-center justify-between gap-6 p-6">
          <div className="flex items-center gap-4">
            <div className={`p-3 rounded-2xl ${isPremium ? 'bg-accent-500/20 text-accent-400' : 'bg-sage-500/20 text-sage-400'}`}>
              <ShieldCheck className="w-8 h-8" />
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-50">
                {isPremium ? `${activePlanLabel} active` : 'Free Trial Active'}
              </h2>
              <p className="text-sm text-slate-400 mt-1">
                {isPremium
                  ? `Thank you for supporting the bot — all features are unlocked and this server has ${teamLimitLabel(teamLimit).toLowerCase()} team${teamLimit === 1 ? '' : 's'}.`
                  : `You have ${daysLeft} days left in your trial, which ends ${formatDate(trialEnd)}. Nothing is deleted when it ends — the board just pauses.`}
              </p>

              {/* EXPIRY / LIFETIME */}
              {isPremium && premiumEnd && (
                <div className="mt-3 inline-flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-300">
                  <Clock className="w-3.5 h-3.5" />
                  Premium expires in {formatRemainingTime(premiumEnd)} · {formatDate(premiumEnd)}
                </div>
              )}
              {isPremium && !premiumEnd && (
                <div className="mt-3 inline-flex items-center gap-2 bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-1.5 text-xs font-semibold text-accent-300">
                  <Check className="w-3.5 h-3.5" />
                  Lifetime access (manual grant)
                </div>
              )}
              {isPremium && premiumEnd && (
                <p className="mt-2 text-[11px] text-slate-500">
                  Reminders 3 days and 1 day before; tracking pauses on {formatDate(premiumEnd)}.
                  Renewing takes one click and nothing needs re-entering.
                </p>
              )}
            </div>
          </div>
          {!isPremium && (
            <div className="w-full sm:w-64">
               <ProgressBar value={daysLeft} max={TRIAL_DAYS} tone={daysLeft <= 2 ? 'red' : daysLeft <= 4 ? 'amber' : 'green'} label="Trial days left" />
            </div>
          )}
        </CardBody>
      </Card>

      {isTrial && !trialExpired && daysLeft <= 2 ? (
        <Alert
          tone="red"
          className="mb-6"
          title={`Trial ends in ${daysLeft} ${daysLeft === 1 ? 'day' : 'days'}`}
        >
          When the trial ends the board pauses and channel pings stop. Your war, race and maze
          history stays — pick a plan below to keep tracking without a gap.
        </Alert>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[1fr_300px]">
        <div className="space-y-6">
          <h3 className="text-lg font-bold text-slate-50 flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-accent-400" /> Upgrade / Renew
          </h3>

          <p className="text-xs leading-relaxed text-slate-500">
            Pick a plan to start premium or keep it running. Yearly plans cost less per month, and
            every plan opens a secure hosted checkout.
          </p>
          
          <div className="grid gap-4 sm:grid-cols-2">
            {PRICING_PLANS.map((plan) => (
              <Card key={plan.id} className={`relative overflow-hidden transition-all hover:border-accent-500/50 ${plan.highlight ? 'border-accent-500/30 shadow-lg shadow-accent-900/20' : ''}`}>
                {plan.highlight && <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-accent-500 to-steel-400" />}
                <CardBody className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h4 className="text-lg font-bold text-slate-50">{plan.name}</h4>
                      <p className="text-xs text-slate-400 mt-1">{plan.description}</p>
                    </div>
                    {plan.badge && (
                    <Badge tone="purple" className="whitespace-nowrap">
                      {plan.id === 'elite_yearly' ? `Save ${yearlySavings(currency)}%` : plan.badge}
                    </Badge>
                  )}
                  </div>
                  <div className="mt-auto pt-6">
                    <p className="text-3xl font-extrabold text-slate-50">
                      {formatPrice(plan.price[currency], currency)}
                      <span className="text-sm font-normal text-slate-400"> / {plan.cadence}</span>
                    </p>
                    {plan.cadence === 'year' ? (
                      <p className="mt-1 text-xs text-slate-500">
                        <s className="text-slate-600">{formatPrice(proMonthlyPrice * 12, currency)}</s>{' '}
                        billed monthly · save {yearlySavings(currency)}% ·{' '}
                        {formatPrice(perMonthPrice(plan, currency), currency)}/month
                      </p>
                    ) : (
                      <p className="mt-1 text-xs text-slate-500">Billed monthly · cancel any time</p>
                    )}
                    <button 
                      onClick={() => handlePayment(plan)}
                      disabled={loadingPlan === plan.id}
                      className="w-full mt-4 py-3 bg-accent-600 hover:bg-accent-500 text-accent-ink font-bold rounded-xl transition-colors flex justify-center items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingPlan === plan.id ? (
                        <><Loader2 className="w-5 h-5 animate-spin" /> Processing…</>
                      ) : (
                        <>{isPremium ? 'Extend' : 'Select'} · {formatPrice(plan.price[currency], currency)} <ArrowRight className="w-4 h-4" /></>
                      )}
                    </button>
                    {isPremium && plan.max_teams < teamLimit ? (
                      <p className="mt-2 text-[11px] leading-relaxed text-amber-300/80">
                        Switching to {plan.name} lowers this server to {teamLimitLabel(plan.max_teams)}{' '}
                        team{plan.max_teams === 1 ? '' : 's'} immediately; paid time still stacks.
                      </p>
                    ) : null}
                  </div>
                </CardBody>
              </Card>
            ))}
          </div>
          <p className="mt-4 text-xs leading-relaxed text-slate-500">
            Secure checkout via Paddle (USD) or Cashfree (INR); the provider follows the currency
            shown. Your card details stay with the payment provider and never touch our servers.
            Cancel any time; access continues to the end of the paid period. Payments are
            non-refundable, as described in the{' '}
            <a href="/legal#refund" className="inline-block py-1.5 text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-300">refund policy</a>.
          </p>
          <p className="mt-2 text-xs leading-relaxed text-slate-500">
            Paid but the plan still looks unchanged? Wait a few seconds for the payment provider to
            confirm, then refresh this page. If it still shows the old plan, email{' '}
            <a href={supportHref} className="inline-block py-1.5 text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-300">{supportEmail}</a>{' '}
            with your server ID ({guildId}) and we’ll fix it.
          </p>
        </div>

        <div className="space-y-4">
          {!isPremium ? (
            <Card>
              <CardHeader title="What happens next" icon={<Clock className="w-5 h-5" />} />
              <CardBody>
                <ol className="space-y-4 text-sm leading-relaxed text-slate-300">
                  <li>
                    <span className="mono-label block text-accent-400">Today</span>
                    <span className="mt-0.5 block">
                      {daysLeft} of {TRIAL_DAYS} trial days left. All six tools unlocked, no card
                      on file.
                    </span>
                  </li>
                  <li>
                    <span className="mono-label block text-steel-400">Day 5</span>
                    <span className="mt-0.5 block">
                      Reminder that the trial ends in 2 days. The bot keeps running until Day {TRIAL_DAYS}.
                    </span>
                  </li>
                  <li>
                    <span className="mono-label block text-steel-400">Day {TRIAL_DAYS}</span>
                    <span className="mt-0.5 block">
                      The trial ends and the board pauses. Nothing is deleted: war, race and maze
                      history stays.
                    </span>
                  </li>
                  <li>
                    <span className="mono-label block text-slate-500">Any time</span>
                    <span className="mt-0.5 block">
                      Pick a plan and the board keeps running without a gap.
                    </span>
                  </li>
                </ol>
              </CardBody>
            </Card>
          ) : null}
          <Card>
            <CardHeader title="What’s included" icon={<ShieldCheck className="w-5 h-5" />} />
            <CardBody>
              <ul className="space-y-3">
                {PLAN_FEATURES.map((feature, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check className="w-4 h-4 text-sage-400 shrink-0 mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
          <p className="text-xs text-slate-500 px-2 text-center">
            By selecting a plan, you agree to our <a href="/legal" target="_blank" className="inline-block py-1.5 text-accent-400 underline decoration-accent-500/40 underline-offset-4 hover:text-accent-300">Terms of Service</a>. All payments are strictly non-refundable.
          </p>
        </div>
      </div>
    </div>
  )
}
