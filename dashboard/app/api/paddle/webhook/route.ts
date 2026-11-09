import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Paddle, Environment, EventName } from '@paddle/paddle-node-sdk'
import { PRICING_PLANS } from '@/lib/pricing'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('paddle-signature') || ''
    const rawBody = await request.text()

    const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
      environment:
        process.env.PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox,
    })

    const event = await paddle.webhooks.unmarshal(
      rawBody,
      process.env.PADDLE_WEBHOOK_SECRET!,
      signature,
    )

    if (event && event.eventType === EventName.TransactionCompleted) {
      const transaction = event.data
      const customData = transaction.customData as { guildId?: string; planId?: string } | null
      const guildId = customData?.guildId
      const planId = customData?.planId

      if (!guildId || !/^\d+$/.test(String(guildId))) {
        console.warn('Paddle webhook: transaction has no valid guildId, ignoring', transaction.id)
        return NextResponse.json({ received: true })
      }

      const plan =
        PRICING_PLANS.find((item) => item.id === planId) ??
        PRICING_PLANS.find((item) => item.id === 'starter_monthly')

      if (!plan) {
        console.error('Paddle webhook: no plan metadata available')
        return NextResponse.json({ received: true })
      }

      const planDays = plan.cadence === 'year' ? 365 : 30

      // Paddle retries webhooks, so make delivery idempotent.
      const { data: existing } = await supabaseAdmin
        .from('guilds')
        .select('premium_ends_at, last_order_id')
        .eq('guild_id', guildId)
        .maybeSingle()

      if (existing?.last_order_id === transaction.id) {
        return NextResponse.json({ received: true })
      }

      const now = new Date()
      const currentEnd = existing?.premium_ends_at ? new Date(existing.premium_ends_at) : null
      const baseDate = currentEnd && currentEnd > now ? currentEnd : now
      const premiumEndsAt = new Date(baseDate.getTime() + planDays * 24 * 60 * 60 * 1000)

      // Upsert so a payment still activates a guild whose row was never created.
      const { error } = await supabaseAdmin.from('guilds').upsert(
        {
          guild_id: guildId,
          premium_status: 'premium',
          max_teams: plan.max_teams,
          premium_ends_at: premiumEndsAt.toISOString(),
          last_order_id: transaction.id,
          // Let the bot send fresh renewal reminders for the new period.
          last_renewal_ping: 0,
        },
        { onConflict: 'guild_id' },
      )

      if (error) throw error

      console.log(
        `✅ Paddle Payment Success: upgraded guild ${guildId} (${plan.id}) until ${premiumEndsAt.toISOString()}`,
      )
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Paddle Webhook Error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
