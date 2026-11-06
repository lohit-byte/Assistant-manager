import { NextResponse } from 'next/server'
import { Cashfree } from 'cashfree-pg'

// Initialize Cashfree (These will be added to Vercel Environment Variables later)
Cashfree.XClientId = process.env.CASHFREE_APP_ID!
Cashfree.XClientSecret = process.env.CASHFREE_SECRET_KEY!
Cashfree.XEnvironment = Cashfree.Environment.SANDBOX // Change to PRODUCTION when ready

export async function POST(request: Request) {
  try {
    const { guildId, planId, amount, currency } = await request.json()

    // Create a unique order ID for this transaction
    const orderId = `guild_${guildId}_${Date.now()}`

    const requestPayload = {
      order_amount: amount,
      order_currency: currency || "INR",
      order_id: orderId,
      customer_details: {
        customer_id: guildId, // Using guild ID as customer ID
        customer_phone: "9999999999", // Cashfree requires a phone number
      },
      order_meta: {
        // Where Cashfree sends the user after payment
        return_url: `https://assistant-manager-tau.vercel.app/dashboard/${guildId}/billing?order_id={order_id}`,
      }
    }

    const response = await Cashfree.PGCreateOrder("2023-08-01", requestPayload)
    
    // Return the payment session ID to the frontend
    return NextResponse.json({ payment_session_id: response.data.payment_session_id })

  } catch (error: any) {
    console.error("Cashfree Error:", error.response?.data || error.message)
    return NextResponse.json({ error: "Could not create order" }, { status: 500 })
  }
}
