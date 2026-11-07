import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use the service role key to bypass RLS and update the guild securely
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Check if the payment was successful
    if (body.data.order.order_status === "PAID") {
      // The order_id format we generate in create-order is: 
      // guild_{guildId}_{planId}_{timestamp}
      const orderId = body.data.order.order_id 
      const parts = orderId.split('_')
      
      const guildId = parts[1] // The Guild ID
      const planId = parts[2]  // e.g., 'starter_monthly', 'pro_monthly', 'elite_yearly'
      
      // Determine the max teams based on the plan they bought
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

    // Always return a 200 OK so Cashfree knows we received it
    return NextResponse.json({ status: "ok" })
    
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}
