'use client'

import { useParams } from 'next/navigation'

export default function OverviewPage() {
  const params = useParams()
  const guildId = params.guildId as string

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold mb-8">Server Overview</h1>
      <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl">
        <h2 className="text-xl font-bold mb-4">Welcome to your Dashboard</h2>
        <p className="text-slate-400 mb-6">
          Select a tab on the left to configure the bot for this server.
        </p>
        <div className="p-4 bg-slate-950 rounded border border-slate-800 text-sm text-slate-500 font-mono">
          Guild ID: {guildId}
        </div>
      </div>
    </div>
  )
}
