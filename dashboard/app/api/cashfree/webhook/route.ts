import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    if (body.data.order.order_status === "PAID") {
      const orderId = body.data.order.order_id // e.g. guild_12345_pro_monthly_169...
      
      // We passed the guildId and planId in the orderId. Let's parse it.
      // Format: guild_{guildId}_{planId}_{timestamp}
      const parts = orderId.split('_')
      const customerId = parts[1] // The guild ID
      
      // Find the plan in our pricing data (or just hardcode the logic here)
      let teams = 1;
      if (orderId.includes('pro')) teams = 3;
      if (orderId.includes('elite')) teams = 999;
      
      const { error } = await supabaseAdmin
        .from('guilds')
        .update({ 
          premium_status: 'premium',
          max_teams: teams // <--- Upgrades their limit
        })
        .eq('guild_id', customerId)

      if (error) throw error
    }

    return NextResponse.json({ status: "ok" })
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}
