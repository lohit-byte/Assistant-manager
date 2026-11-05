import Link from 'next/link'

export default function AuthError() {
  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white p-6">
      <h1 className="text-4xl font-bold text-red-500 mb-4">Authentication Failed</h1>
      <p className="text-slate-400 mb-8 text-center max-w-md">
        An error occurred while trying to log you in with Discord. This usually happens if you cancelled the login or if there is a configuration issue.
      </p>
      <Link href="/" className="px-6 py-3 bg-purple-600 hover:bg-purple-500 rounded-lg font-bold transition-colors">
        Return to Login
      </Link>
    </div>
  )
}
