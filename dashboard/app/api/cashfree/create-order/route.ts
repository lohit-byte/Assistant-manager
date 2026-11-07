import { NextResponse } from 'next/server'
import { Cashfree } from 'cashfree-pg'

Cashfree.XClientId = process.env.CASHFREE_APP_ID!
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY!
Cashfree.XEnvironment = Cashfree.Environment.SANDBOX // Change to PRODUCTION later

export async function POST(request: Request) {
  try {
    const { guildId, planId, amount, currency } = await request.json()

    // THE FIX: We now include the planId in the orderId
    // Format: guild_{guildId}_{planId}_{timestamp}
    const orderId = `guild_${guildId}_${planId}_${Date.now()}`

    const requestPayload = {
      order_amount: amount,
      order_currency: currency || "INR",
      order_id: orderId,
      customer_details: {
        customer_id: guildId, 
        customer_phone: "9999999999", 
      },
      order_meta: {
        return_url: `https://drlohithealth.com/dashboard/${guildId}/billing?order_id={order_id}`,
      }
    }

    const response = await Cashfree.PGCreateOrder("2023-08-01", requestPayload)
    
    return NextResponse.json({ payment_session_id: response.data.payment_session_id })

  } catch (error: any) {
    console.error("Cashfree Error:", error.response?.data || error.message)
    return NextResponse.json({ error: "Could not create order" }, { status: 500 })
  }
}
