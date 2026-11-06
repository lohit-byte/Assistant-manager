'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Map, Shield, Sparkles, Swords, Trophy, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, Badge, Button, Card, CardBody, buttonClass } from '@/components/ui'

const FEATURES = [
  {
    icon: Swords,
    title: 'War tracking',
    description: 'Phase timers, missing attacks, excused players and warnings — all in one place.',
  },
  {
    icon: Trophy,
    title: 'Race nodes',
    description: 'Track OFA, DYP and JE progress with live lap and node status.',
  },
  {
    icon: Map,
    title: 'Maze discounts',
    description: 'Schedule events and see every discount moment in your local timezone.',
  },
  {
    icon: Users,
    title: 'Alias manager',
    description: 'Map in-game names to Discord members without accidental mentions.',
  },
]

export default function Landing() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error')) {
      setError('Discord sign-in did not complete. Please try again.')
    }
  }, [])

  const signIn = async () => {
    setLoading(true)
    setError(null)
    const supabase = createClient()
    const { error: authError } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        scopes: 'identify guilds',
      },
    })

    if (authError) {
      setError(authError.message)
      setLoading(false)
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-white">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-40 left-1/2 h-[480px] w-[720px] -translate-x-1/2 rounded-full bg-purple-600/20 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-[360px] w-[520px] rounded-full bg-sky-500/10 blur-3xl" />
      </div>

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-purple-600 shadow-lg shadow-purple-950">
              <Shield className="h-5 w-5" />
            </div>
            <span className="text-sm font-bold tracking-wide text-slate-200">
              MONSTER LEGENDS ASSISTANT
            </span>
          </div>
          <Badge tone="purple" dot>
            Discord bot + dashboard
          </Badge>
        </header>

        <main className="flex flex-1 flex-col justify-center py-16">
          <div className="grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
            <div>
              <p className="mb-4 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-purple-400">
                <Sparkles className="h-3.5 w-3.5" />
                Built for alliance leadership
              </p>
              <h1 className="max-w-2xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl lg:text-6xl">
                Run your alliance&apos;s{' '}
                <span className="bg-gradient-to-r from-purple-400 to-sky-400 bg-clip-text text-transparent">
                  wars, races and mazes
                </span>{' '}
                without spreadsheets.
              </h1>
              <p className="mt-6 max-w-xl text-lg text-slate-400">
                One dashboard for timers, missing attacks, race nodes, maze discounts and player
                aliases. Sign in with Discord to manage a server you own or administrate.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button size="lg" loading={loading} onClick={signIn} className="bg-[#5865F2] hover:bg-[#4752C4]">
                  <svg className="h-5 w-5 fill-current" viewBox="0 0 127.14 96.36" aria-hidden>
                    <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
                  </svg>
                  {loading ? 'Redirecting…' : 'Continue with Discord'}
                </Button>
                <a href="#features" className={buttonClass('secondary', 'lg')}>
                  See what&apos;s included
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>

              {error ? (
                <Alert tone="red" className="mt-6 max-w-xl" title="Sign-in failed">
                  {error}
                </Alert>
              ) : null}

              <p className="mt-6 text-xs text-slate-500">
                We request <span className="font-mono text-slate-400">identify</span> and{' '}
                <span className="font-mono text-slate-400">guilds</span> only. No messages or member
                data are read by the dashboard.
              </p>
            </div>

            <Card className="border-slate-800/80 bg-slate-900/70">
              <CardBody className="space-y-4">
                <div className="flex items-center justify-between rounded-xl border border-slate-800 bg-slate-950/70 px-4 py-3">
                  <div>
                    <p className="text-xs uppercase tracking-wider text-slate-500">Current phase</p>
                    <p className="mt-1 font-semibold text-white">Attack · 09h 42m left</p>
                  </div>
                  <Badge tone="amber">War</Badge>
                </div>
                <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-400">Missing attacks</span>
                    <span className="font-mono text-amber-300">3 / 24</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800">
                    <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-purple-500 to-sky-400" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-lg font-bold text-white">5</p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Lap</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-lg font-bold text-emerald-300">3/5</p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Node</p>
                  </div>
                  <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-3">
                    <p className="text-lg font-bold text-purple-300">20%</p>
                    <p className="text-[11px] uppercase tracking-wide text-slate-500">Next</p>
                  </div>
                </div>
                <p className="text-center text-[11px] text-slate-600">
                  Example data — sign in to see your server.
                </p>
              </CardBody>
            </Card>
          </div>

          <div id="features" className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon
              return (
                <Card key={feature.title} className="bg-slate-900/40">
                  <CardBody>
                    <div className="mb-3 inline-flex rounded-xl border border-purple-500/20 bg-purple-500/10 p-2.5 text-purple-300">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="font-semibold text-white">{feature.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-slate-400">
                      {feature.description}
                    </p>
                  </CardBody>
                </Card>
              )
            })}
          </div>
        </main>

        <footer className="border-t border-slate-900 py-6 text-xs text-slate-600">
          Monster Legends Assistant · Community project, not affiliated with Monster Legends.
        </footer>
      </div>
    </div>
  )
}
