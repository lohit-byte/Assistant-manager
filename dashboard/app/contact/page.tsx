export default function ContactPage() {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-2xl mx-auto space-y-8">
        <h1 className="text-3xl font-bold">Contact & Legal</h1>
        
        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
          <h2 className="text-xl font-bold text-purple-400">Contact Support</h2>
          <p className="text-slate-300">For billing inquiries or support, please email:</p>
          <p className="font-mono text-white bg-slate-950 p-2 rounded">warbot.support@gmail.com</p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
          <h2 className="text-xl font-bold text-purple-400">Terms of Service</h2>
          <p className="text-sm text-slate-400">
            By using this dashboard, you agree that this is a third-party management tool for Monster Legends. 
            We are not affiliated with Socialpoint. Subscriptions are billed monthly and can be cancelled at any time. 
            Abuse of the Discord bot or dashboard will result in a ban without refund.
          </p>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-6 rounded-xl space-y-4">
          <h2 className="text-xl font-bold text-purple-400">Privacy Policy</h2>
          <p className="text-sm text-slate-400">
            We collect your Discord User ID and Server ID to provide the bot's functionality. 
            We do not sell your data. All payment processing is handled securely by our third-party payment gateway.
          </p>
        </div>
        
        <a href="/" className="inline-block mt-8 text-purple-400 hover:text-white">← Back to Home</a>
      </div>
    </div>
  )
}
