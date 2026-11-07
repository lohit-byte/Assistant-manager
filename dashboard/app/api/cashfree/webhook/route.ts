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
    
    // Cashfree uses your MAIN SECRET KEY to sign the webhook
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
    
    // THE FIX: Use the webhook event type, not order_status
    if (body?.type === 'PAYMENT_SUCCESS_WEBHOOK') {
      const orderId = body.data.order.order_id 
      // Order ID is now: g123456789_p_lz8x1v
      const parts = orderId.split('_')
      
      const guildId = parts[0].replace('g', '') // Removes the 'g' to get pure ID
      const planCode = parts[1]  
      
      let maxTeams = 1
      if (planCode === 'p') maxTeams = 3
      if (planCode === 'e') maxTeams = 99
      
      const { error } = await supabaseAdmin
        .from('guilds')
        .update({ 
          premium_status: 'premium',
          max_teams: maxTeams 
        })
        .eq('guild_id', guildId)

      if (error) throw error
      console.log(`✅ Successfully upgraded guild ${guildId} to Premium (${planCode}) with ${maxTeams} teams.`)
    }

    return NextResponse.json({ status: "ok" })
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}
