import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Paddle, Environment, EventName } from '@paddle/paddle-node-sdk'
import { buildSubscriptionUpsert, planFromPaddleItems } from '@/lib/plans'
import { upsertGuildSubscription } from '@/lib/subscription'

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

      if (!guildId || !/^\d+$/.test(String(guildId))) {
        console.warn('Paddle webhook: transaction has no valid guildId, ignoring', transaction.id)
        return NextResponse.json({ received: true })
      }

      // The paid price is authoritative; customData is browser-supplied, so it is only a
      // fallback when Paddle sends a price id this build does not know yet.
      const paidPlan = planFromPaddleItems(transaction.items, null)
      const planId = paidPlan ?? planFromPaddleItems([], customData?.planId) ?? 'starter_monthly'
      if (!paidPlan) {
        console.error(
          'Paddle webhook: no known price on transaction',
          transaction.id,
          'falling back to',
          planId,
        )
      }

      // Paddle retries webhooks, so make delivery idempotent.
      const { data: existing } = await supabaseAdmin
        .from('guilds')
        .select('premium_ends_at, last_order_id')
        .eq('guild_id', guildId)
        .maybeSingle()

      if (existing?.last_order_id === transaction.id) {
        return NextResponse.json({ received: true })
      }

      const update = buildSubscriptionUpsert(existing ?? null, planId, transaction.id)
      await upsertGuildSubscription(supabaseAdmin, guildId, update)

      console.log(
        `✅ Paddle Payment Success: upgraded guild ${guildId} (${planId}) until ${update.premium_ends_at}`,
      )
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Paddle Webhook Error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
