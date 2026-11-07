import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const rawBody = await request.text()
    const signature = request.headers.get('x-webhook-signature')
    const timestamp = request.headers.get('x-webhook-timestamp')
    const secret = process.env.CASHFREE_SECRET_KEY!
    
    if (!signature || !timestamp || !secret) {
      return NextResponse.json({ status: "ignored" }, { status: 200 })
    }

    const payload = timestamp + rawBody
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64')

    if (expectedSignature !== signature) {
      return NextResponse.json({ status: "ignored" }, { status: 200 })
    }

    const body = JSON.parse(rawBody)
    
    if (body?.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const orderId = body.data.order.order_id 
      const parts = orderId.split('_')
      
      const guildId = parts[0].replace('g', '')
      const planCode = parts[1]  
      
      let maxTeams = 1
      let planDays = 30 // Default to monthly
      if (planCode === 'p') maxTeams = 3
      if (planCode === 'e') { maxTeams = 99; planDays = 365 }
      
      // 1. Fetch current guild to check for early renewal
      const { data: existing } = await supabaseAdmin
        .from('guilds')
        .select('premium_ends_at, last_order_id')
        .eq('guild_id', guildId)
        .single()

      // 2. Prevent duplicate webhook deliveries
      if (existing?.last_order_id === orderId) {
        return NextResponse.json({ status: "ok" })
      }

      // 3. Calculate new end date
      const now = new Date()
      const currentEnd = existing?.premium_ends_at ? new Date(existing.premium_ends_at) : null
      
      // If they still have time left, add to it. Otherwise, start from today.
      const baseDate = (currentEnd && currentEnd > now) ? currentEnd : now
      const premiumEndsAt = new Date(baseDate.getTime() + planDays * 24 * 60 * 60 * 1000)
      
      // 4. Update database
      const { error } = await supabaseAdmin
        .from('guilds')
        .update({ 
          premium_status: 'premium',
          max_teams: maxTeams,
          premium_ends_at: premiumEndsAt.toISOString(),
          last_order_id: orderId
        })
        .eq('guild_id', guildId)

      if (error) throw error
      console.log(`✅ Upgraded guild ${guildId} to Premium until ${premiumEndsAt.toISOString()}`)
    }

    return NextResponse.json({ status: "ok" })
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}
