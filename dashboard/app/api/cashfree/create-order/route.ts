import { NextResponse } from 'next/server'
import { Cashfree } from 'cashfree-pg'
import { PRICING_PLANS } from '@/lib/pricing'

const PLAN_CODES: Record<string, string> = { starter_monthly: 's', pro_monthly: 'p', elite_yearly: 'e', dev_test: 't' }

export async function POST(request: Request) {
  try {
    const appId = process.env.CASHFREE_APP_ID
    const secret = process.env.CASHFREE_SECRET_KEY
    
    if (!appId || !secret) {
      console.error('Missing CASHFREE_APP_ID or CASHFREE_SECRET_KEY')
      return NextResponse.json({ error: 'Server is missing Cashfree keys' }, { status: 500 })
    }
    
    Cashfree.XClientId = appId
    Cashfree.XClientSecret = secret
    Cashfree.XEnvironment = Cashfree.Environment.PRODUCTION

    const { guildId, planId, currency } = await request.json()
    const plan = PRICING_PLANS.find((p) => p.id === planId)
    
    if (!plan || !/^\d+$/.test(String(guildId))) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    
    const cur = currency === 'USD' ? 'USD' : 'INR'
    const orderId = `g${guildId}_${PLAN_CODES[plan.id]}_${Date.now().toString(36)}`
    const origin = new URL(request.url).origin

    const response = await Cashfree.PGCreateOrder('2023-08-01', {
      order_amount: plan.price[cur], 
      order_currency: cur,
      order_id: orderId,
      customer_details: { customer_id: `g${guildId}`, customer_phone: '9999999999' },
      order_meta: { return_url: `${origin}/dashboard/${guildId}/billing?order_id={order_id}` },
    })
    return NextResponse.json({ payment_session_id: response.data.payment_session_id })
  } catch (error: any) {
    const detail = error.response?.data
    console.error('Cashfree Error:', detail || error.message)
    return NextResponse.json({ error: detail?.message || 'Could not create order' }, { status: 500 })
  }
}
