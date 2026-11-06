import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Use the service role key here to bypass RLS and update the guild
const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! 
)

export async function POST(request: Request) {
  try {
    const body = await request.json()
    
    // Check if payment was successful
    if (body.data.order.order_status === "PAID") {
      const customerId = body.data.customer_details.customer_id // This is the guildId
      
      // Upgrade the server to premium
      const { error } = await supabaseAdmin
        .from('guilds')
        .update({ premium_status: 'premium' })
        .eq('guild_id', customerId)

      if (error) throw error
      
      console.log(`Successfully upgraded guild ${customerId} to Premium!`)
    }

    return NextResponse.json({ status: "ok" })
  } catch (error) {
    console.error("Webhook Error:", error)
    return NextResponse.json({ status: "error" }, { status: 500 })
  }
}
