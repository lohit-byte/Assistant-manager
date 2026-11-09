import Link from 'next/link'
import { ArrowLeft, ShieldAlert, FileText, Scale } from 'lucide-react'

export default function LegalPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-6 md:p-12">
      <div className="max-w-3xl mx-auto space-y-12">
        
        <Link href="/" className="inline-flex items-center gap-2 text-slate-400 hover:text-white transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <header>
          <h1 className="text-4xl font-extrabold mb-2">Legal & Policies</h1>
          <p className="text-slate-400">Last updated: November 2026</p>
          <p className="mt-4 text-sm text-slate-500">
            For any questions regarding these policies, please contact <strong>warbot.support@gmail.com</strong>.
          </p>
        </header>

        {/* TERMS OF SERVICE */}
        <section className="bg-slate-900 border border-slate-800 p-8 rounded-2xl space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <Scale className="w-6 h-6 text-indigo-400" />
            <h2 className="text-2xl font-bold">Terms of Service</h2>
          </div>
          <div className="text-slate-300 space-y-3 text-sm leading-relaxed">
            <p>By inviting the "Assistant Manager for Monster Legends" bot to your Discord server or using this dashboard, you agree to these terms.</p>
            <p><strong>1. Non-Affiliation:</strong> This is a third-party community tool. We are not affiliated, associated, authorized, endorsed by, or in any way officially connected with Socialpoint or Monster Legends.</p>
            <p><strong>2. Acceptable Use:</strong> You may not use this bot to spam, abuse Discord APIs, or attempt to exploit the dashboard. We reserve the right to blacklist any user or server that violates these terms without prior notice.</p>
            <p><strong>3. Service Availability:</strong> While we strive for 100% uptime, the bot and dashboard are provided "as is". We are not liable for missed war timers, race deadlines, or game consequences resulting from bot downtime.</p>
          </div>
        </section>

        {/* REFUND POLICY (CRITICAL FOR CASHFREE) */}
        <section id="refund" className="bg-slate-900 border border-red-900/30 p-8 rounded-2xl space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <ShieldAlert className="w-6 h-6 text-red-400" />
            <h2 className="text-2xl font-bold text-red-400">Refund & Cancellation Policy</h2>
          </div>
          <div className="text-slate-300 space-y-3 text-sm leading-relaxed">
            <p className="font-bold text-white text-base">ALL SALES ARE FINAL AND NON-REFUNDABLE.</p>
            <p>We offer a 7-day free trial to allow you to fully test all premium features before making a purchase. By subscribing to a Premium plan, you acknowledge that you have tested the service and agree to our no-refund policy.</p>
            <p><strong>1. No Refunds:</strong> We do not provide refunds or credits for any partial subscription periods, unused time, accidental purchases, or if you simply forget to cancel.</p>
            <p><strong>2. Cancellations:</strong> You may cancel your subscription at any time. If you cancel, you will retain access to Premium features until the end of your current billing cycle, and you will not be charged again.</p>
            <p><strong>3. Disputes:</strong> If you initiate a chargeback or payment dispute, your server will be permanently blacklisted from using the bot.</p>
          </div>
        </section>

        {/* PRIVACY POLICY */}
        <section className="bg-slate-900 border border-slate-800 p-8 rounded-2xl space-y-4">
          <div className="flex items-center gap-3 border-b border-slate-800 pb-4">
            <FileText className="w-6 h-6 text-blue-400" />
            <h2 className="text-2xl font-bold">Privacy Policy</h2>
          </div>
          <div className="text-slate-300 space-y-3 text-sm leading-relaxed">
            <p><strong>1. Data We Collect:</strong> We store your Discord Server ID (Guild ID), Discord User IDs (for tracking war attacks and aliases), and the data you input (war timers, race nodes, maze schedules).</p>
            <p><strong>2. Payments:</strong> All payment processing is handled securely by Cashfree. We do not store your credit card, bank, or UPI information on our servers.</p>
            <p><strong>3. Data Sharing:</strong> We do not sell your data to third parties. Your data is securely stored in our Supabase database.</p>
          </div>
        </section>

      </div>
    </div>
  )
}
