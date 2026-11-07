import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import crypto from 'crypto'

// Initialize Supabase with the Service Role Key to bypass RLS
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
)

export async function POST(request: Request) {
  try {
    // 1. Get the raw body and headers for security verification
    const rawBody = await request.text()
    const signature = request.headers.get('x-webhook-signature')
    const timestamp = request.headers.get('x-webhook-timestamp')
    
    // 2. VERIFY THE SECRET (Security Check)
    const secret = process.env.CASHFREE_WEBHOOK_SECRET!
    if (!signature || !timestamp || !secret) {
      console.error("Missing signature, timestamp, or secret.")
      return NextResponse.json({ status: "unauthorized" }, { status: 401 })
    }

    // Cashfree signature verification logic
    const payload = timestamp + rawBody
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(payload)
      .digest('base64')

    if (expectedSignature !== signature) {
      console.error("Invalid webhook signature. Blocking request.")
      return NextResponse.json({ status: "unauthorized" }, { status: 401 })
    }

    // 3. PROCESS THE PAYMENT (Only if the signature is valid)
    const body = JSON.parse(rawBody)
    
    // Use optional chaining (?.) to prevent crashes on Cashfree's test pings
    if (body?.data?.order?.order_status === "PAID") {
      // The order_id format is: guild_{guildId}_{planId}_{timestamp}
      const orderId = body.data.order.order_id 
      const parts = orderId.split('_')
      
      const guildId = parts[1] 
      const planId = parts[2]  
      
      // Determine the team limit based on the plan
      let maxTeams = 1
      if (planId.includes('pro')) maxTeams = 3
      if (planId.includes('elite')) maxTeams = 99
      
      // Upgrade the server in the database
      const { error } = await supabaseAdmin
        .from('guilds')
        .update({ 
          premium_status: 'premium',
          max_teams: maxTeams 
        })
        .eq('guild_id', guildId)

      if (error) {
        console.error("Database update failed:", error)
        throw error
      }
      
      console.log(`✅ Successfully upgraded guild ${guildId} to Premium (${planId}) with ${maxTeams} teams.`)
    }

    // Always return 200 so Cashfree knows we received it
    return NextResponse.json({ status: "ok" })
    
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}
