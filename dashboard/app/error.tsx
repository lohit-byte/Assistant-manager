'use client'

export default function Error({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen bg-slate-950 text-white p-8">
      <h1 className="text-xl font-bold mb-4">Something broke</h1>
      <pre className="text-red-300 text-sm whitespace-pre-wrap">{error.message}</pre>
      <button onClick={reset} className="mt-6 px-4 py-2 bg-purple-600 rounded">Try again</button>
    </div>
  )
}
