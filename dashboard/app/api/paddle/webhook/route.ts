import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Paddle, Environment, EventName } from '@paddle/paddle-node-sdk' // <--- TYPO FIXED HERE

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('paddle-signature') || ''
    const rawBody = await request.text()

    // Initialize Paddle with the correct environment
    const paddle = new Paddle(process.env.PADDLE_API_KEY!, {
      environment: process.env.PADDLE_ENV === 'production' ? Environment.production : Environment.sandbox
    })

    const event = await paddle.webhooks.unmarshal(
      rawBody,
      process.env.PADDLE_WEBHOOK_SECRET!,
      signature
    )

    if (event && event.eventType === EventName.TransactionCompleted) {
      const transaction = event.data
      
      // Cast customData so TypeScript allows accessing guildId
      const customData = transaction.customData as { guildId?: string, planId?: string };
      const guildId = customData?.guildId;
      const planId = customData?.planId;
      
      if (guildId) {
        let maxTeams = 1
        let planDays = 30 
        
        if (planId === 'pro_monthly') {
          maxTeams = 3
        } else if (planId === 'elite_yearly') {
          maxTeams = 99
          planDays = 365
        }

        // Fetch existing guild to stack renewals
        const { data: existing } = await supabaseAdmin
          .from('guilds')
          .select('premium_ends_at')
          .eq('guild_id', guildId)
          .single()

        const now = new Date()
        const currentEnd = existing?.premium_ends_at ? new Date(existing.premium_ends_at) : null
        
        const baseDate = (currentEnd && currentEnd > now) ? currentEnd : now
        const premiumEndsAt = new Date(baseDate.getTime() + planDays * 24 * 60 * 60 * 1000)

        await supabaseAdmin
          .from('guilds')
          .update({ 
            premium_status: 'premium',
            max_teams: maxTeams,
            premium_ends_at: premiumEndsAt.toISOString()
          })
          .eq('guild_id', guildId)
          
        console.log(`✅ Paddle Payment Success: Upgraded guild ${guildId} by ${planDays} days.`)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Paddle Webhook Error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
