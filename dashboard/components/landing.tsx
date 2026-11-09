'use client'

import { useEffect, useState } from 'react'
import { ArrowRight, Check, Map, Shield, Sparkles, Swords, Trophy, Users } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, Badge, Button, buttonClass } from '@/components/ui'

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

const HIGHLIGHTS = ['7-day free trial', 'No card required', 'One dashboard per server']

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
    <div className="relative min-h-screen overflow-hidden bg-ink-950 text-white">
      <div className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-[560px] opacity-70" aria-hidden />
      <div
        className="pointer-events-none absolute -top-64 left-1/2 h-[520px] w-[820px] -translate-x-1/2 rounded-full bg-indigo-600/[0.14] blur-[120px]"
        aria-hidden
      />

      <div className="relative mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-7">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-gradient-to-b from-indigo-400/25 to-indigo-600/10 text-indigo-200 shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
              <Shield className="h-4 w-4" />
            </div>
            <span className="text-sm font-semibold tracking-tight text-slate-200">
              Legends Assistant
            </span>
          </div>
          <Badge tone="purple" dot>
            Discord bot + dashboard
          </Badge>
        </header>

        <main className="flex flex-1 flex-col justify-center py-14">
          <div className="grid items-center gap-12 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">
                <Sparkles className="h-3.5 w-3.5 text-indigo-300" />
                Built for alliance leadership
              </p>
              <h1 className="max-w-xl text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-5xl">
                Run your alliance&apos;s{' '}
                <span className="text-gradient">wars, races and mazes</span> without spreadsheets.
              </h1>
              <p className="mt-5 max-w-lg text-base leading-relaxed text-slate-400">
                One dashboard for timers, missing attacks, race nodes, maze discounts and player
                aliases. Sign in with Discord to manage a server you own or administrate.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button
                  size="lg"
                  loading={loading}
                  onClick={signIn}
                  className="bg-[#5865F2] hover:bg-[#4752C4] shadow-[0_16px_40px_-16px_rgba(88,101,242,0.9)]"
                >
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
                <Alert tone="red" className="mt-6 max-w-lg" title="Sign-in failed">
                  {error}
                </Alert>
              ) : null}

              <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                {HIGHLIGHTS.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                    {item}
                  </li>
                ))}
              </ul>

              <p className="mt-3 text-xs text-slate-600">
                We request <span className="font-mono text-slate-500">identify</span> and{' '}
                <span className="font-mono text-slate-500">guilds</span> only. No messages or member
                data are read by the dashboard.
              </p>
            </div>

            <div className="relative">
              <div
                className="absolute -inset-4 rounded-[28px] bg-gradient-to-b from-indigo-500/10 to-transparent blur-2xl"
                aria-hidden
              />
              <div className="relative overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900/90 shadow-panel backdrop-blur">
                <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-2.5">
                  <span className="h-2 w-2 rounded-full bg-rose-500/70" />
                  <span className="h-2 w-2 rounded-full bg-amber-500/70" />
                  <span className="h-2 w-2 rounded-full bg-emerald-500/70" />
                  <span className="ml-3 flex-1 truncate text-center font-mono text-[11px] text-slate-600">
                    assistant / overview
                  </span>
                </div>

                <div className="grid grid-cols-[104px_1fr]">
                  <div className="space-y-1 border-r border-white/[0.06] p-3">
                    {['Overview', 'War', 'Race', 'Maze', 'Aliases'].map((item, index) => (
                      <div
                        key={item}
                        className={`rounded-md px-2 py-1.5 text-[11px] font-medium ${
                          index === 0 ? 'bg-white/[0.07] text-white' : 'text-slate-500'
                        }`}
                      >
                        {item}
                      </div>
                    ))}
                  </div>

                  <div className="space-y-3 p-4">
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: 'Phase', value: 'Attack' },
                        { label: 'Missing', value: '3' },
                        { label: 'Next', value: '20%' },
                      ].map((stat) => (
                        <div
                          key={stat.label}
                          className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5"
                        >
                          <p className="text-[9px] uppercase tracking-wider text-slate-500">
                            {stat.label}
                          </p>
                          <p className="mt-1 text-sm font-bold tracking-tight text-white">
                            {stat.value}
                          </p>
                        </div>
                      ))}
                    </div>

                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between text-[10px] text-slate-500">
                        <span>Phase timer</span>
                        <span className="font-mono text-slate-400">09h 42m</span>
                      </div>
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                        <div className="h-full w-[72%] rounded-full bg-gradient-to-r from-indigo-400 to-cyan-400" />
                      </div>
                    </div>

                    <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
                      <div className="flex items-end justify-between gap-1.5">
                        {[38, 62, 46, 78, 55, 88, 70, 94].map((height, index) => (
                          <span
                            key={index}
                            style={{ height: `${height * 0.4}px` }}
                            className={`w-full rounded-sm ${
                              index > 5 ? 'bg-gradient-to-t from-indigo-500 to-cyan-400' : 'bg-white/[0.1]'
                            }`}
                          />
                        ))}
                      </div>
                      <p className="mt-2 text-[10px] text-slate-600">Race progress · last 8 laps</p>
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-3 text-center text-[11px] text-slate-600">
                Example data — sign in to see your server.
              </p>
            </div>
          </div>

          <div id="features" className="mt-20 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => {
              const Icon = feature.icon
              return (
                <div
                  key={feature.title}
                  className="surface group p-5 transition-colors hover:border-white/[0.12]"
                >
                  <div className="mb-3 inline-flex rounded-xl border border-indigo-400/20 bg-indigo-500/10 p-2.5 text-indigo-300">
                    <Icon className="h-4 w-4" />
                  </div>
                  <h3 className="text-sm font-semibold text-white">{feature.title}</h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-400">
                    {feature.description}
                  </p>
                </div>
              )
            })}
          </div>
        </main>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] py-6 text-xs text-slate-600">
          <span>Monster Legends Assistant · Community project, not affiliated with Monster Legends.</span>
          <nav className="flex items-center gap-4">
            <a href="/legal" className="transition-colors hover:text-slate-300">
              Terms of Service
            </a>
            <a href="/legal#refund" className="text-rose-400/80 transition-colors hover:text-rose-300">
              Refund Policy
            </a>
            <a href="/legal" className="transition-colors hover:text-slate-300">
              Privacy Policy
            </a>
          </nav>
        </footer>
      </div>
    </div>
  )
}
