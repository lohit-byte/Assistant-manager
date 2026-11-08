import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { Paddle, EventName } from '@paddle/paddle-node-sdk'

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  try {
    const signature = request.headers.get('paddle-signature') || ''
    const rawBody = await request.text()

    const paddle = new Paddle(process.env.PADDLE_API_KEY!)
    const event = await paddle.webhooks.unmarshal(
      rawBody,
      process.env.PADDLE_WEBHOOK_SECRET!,
      signature
    )

    if (event && event.eventType === EventName.TransactionCompleted) {
      const transaction = event.data
      
      // FIXED: Casting customData so TypeScript allows accessing guildId
      const guildId = (transaction.customData as { guildId?: string })?.guildId;
      
      if (guildId) {
        let maxTeams = 1
        const items = transaction.items
        if (items && items[0] && items[0].price && items[0].price.id) {
          const priceId = items[0].price.id
          if (priceId.includes('pro')) maxTeams = 3
          if (priceId.includes('elite')) maxTeams = 99
        }

        await supabaseAdmin
          .from('guilds')
          .update({ 
            premium_status: 'premium',
            max_teams: maxTeams,
          })
          .eq('guild_id', guildId)
          
        console.log(`✅ Paddle Payment Success: Upgraded guild ${guildId}`)
      }
    }

    return NextResponse.json({ received: true })
  } catch (error) {
    console.error('Paddle Webhook Error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}
