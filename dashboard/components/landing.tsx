'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import {
  ArrowDown,
  ArrowUpRight,
  Check,
  LogIn,
  Menu,
  Moon,
  Sun,
  X,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useTheme } from '@/lib/theme'
import { BOT_INVITE_URL, SUPPORT_EMAIL, TRIAL_DAYS } from '@/lib/constants'
import { Alert, Button, buttonClass } from '@/components/ui'
import { Wordmark } from '@/components/brand'
import { WarBoard } from '@/components/war-board'
import { TiltSurface, WarTable3D } from '@/components/board-3d'
import {
  clock,
  faq,
  features,
  finale,
  footer,
  hero,
  sampleBoard,
  start,
} from '@/lib/marketing'

const NAV = [
  { label: 'The clock', href: '#clock' },
  { label: 'What it tracks', href: '#board' },
  { label: 'Start', href: '#start' },
  { label: 'Questions', href: '#questions' },
]

function DiscordIcon({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 127.14 96.36" aria-hidden>
      <path d="M107.7,8.07A105.15,105.15,0,0,0,81.47,0a72.06,72.06,0,0,0-3.36,6.83A97.68,97.68,0,0,0,49,6.83,72.37,72.37,0,0,0,45.64,0,105.89,105.89,0,0,0,19.39,8.09C2.79,32.65-1.71,56.6.54,80.21h0A105.73,105.73,0,0,0,32.71,96.36,77.7,77.7,0,0,0,39.6,85.25a68.42,68.42,0,0,1-10.85-5.18c.91-.66,1.8-1.34,2.66-2a75.57,75.57,0,0,0,64.32,0c.87.71,1.76,1.39,2.66,2a68.68,68.68,0,0,1-10.87,5.19,77,77,0,0,0,6.89,11.1A105.25,105.25,0,0,0,126.6,80.22h0C129.24,52.84,122.09,29.11,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53s5-12.74,11.43-12.74S54,46,53.89,53,48.84,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.25,60,73.25,53s5-12.74,11.44-12.74S96.23,46,96.12,53,91.08,65.69,84.69,65.69Z" />
    </svg>
  )
}

export default function Landing() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const { resolved, setTheme } = useTheme()
  const menuRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('error')) {
      setError('Discord sign-in did not complete. Please try again.')
    }
  }, [])

  useEffect(() => {
    if (!menuOpen) return
    const previous = document.activeElement as HTMLElement | null
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        return
      }
      if (event.key !== 'Tab') return
      const nodes = menuRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled])',
      )
      if (!nodes || nodes.length === 0) return
      const focusable = Array.from(nodes)
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
      previous?.focus?.()
    }
  }, [menuOpen])

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
    <div className="relative min-h-screen overflow-x-clip bg-ink-950">
      <div
        className="bg-blueprint pointer-events-none absolute inset-x-0 top-0 h-[680px] opacity-70"
        aria-hidden
      />

      <header className="frame relative z-30 flex items-center justify-between gap-4 py-5">
        <Wordmark />
        <nav className="hidden items-center gap-7 lg:flex" aria-label="Main">
          {NAV.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="relative py-2.5 text-[13px] font-medium text-slate-400 transition-colors after:absolute after:inset-x-0 after:bottom-0 after:h-px after:origin-left after:scale-x-0 after:bg-accent-500 after:transition-transform after:duration-200 hover:text-slate-50 hover:after:scale-x-100"
            >
              {item.label}
            </a>
          ))}
        </nav>
        <div className="hidden items-center gap-2 lg:flex">
          <button
            type="button"
            onClick={signIn}
            disabled={loading}
            className={buttonClass('secondary', 'sm')}
            title="Already have a dashboard? Sign in with Discord"
          >
            <LogIn className="h-3.5 w-3.5" aria-hidden />
            {hero.loginCta}
          </button>
          <button
            type="button"
            onClick={signIn}
            disabled={loading}
            className={buttonClass('primary', 'sm')}
          >
            <DiscordIcon className="h-3.5 w-3.5" />
            {loading ? 'Redirecting…' : 'Start free trial'}
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTheme(resolved === 'dark' ? 'light' : 'dark')}
            className="border border-white/[0.14] p-2 text-slate-300 transition-colors hover:border-white/[0.24] hover:text-slate-50"
            aria-label={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            title={resolved === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            {resolved === 'dark' ? (
              <Sun className="h-4 w-4" aria-hidden />
            ) : (
              <Moon className="h-4 w-4" aria-hidden />
            )}
          </button>
          <button
            type="button"
            className="border border-white/[0.14] p-2 text-slate-300 lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label="Open menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </header>

      {menuOpen ? (
        <div
          id="mobile-nav"
          ref={menuRef}
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className="fixed inset-0 z-50 flex flex-col bg-ink-950 px-6 pb-8 pt-5"
        >
          <div className="flex items-center justify-between">
            <Wordmark />
            <button
              type="button"
              ref={closeRef}
              className="border border-white/[0.14] p-2 text-slate-300"
              aria-label="Close menu"
              onClick={() => setMenuOpen(false)}
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <nav className="mt-14 flex flex-col" aria-label="Mobile">
            {NAV.map((item) => (
              <a
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                className="display border-b border-white/[0.1] py-5 text-4xl text-slate-100"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="mt-auto space-y-3 pt-10">
            <Button size="lg" onClick={signIn} loading={loading} className="w-full">
              <DiscordIcon className="h-4 w-4" />
              {hero.primaryCta}
            </Button>
            <Button
              size="lg"
              variant="secondary"
              onClick={signIn}
              loading={loading}
              className="w-full"
            >
              <LogIn className="h-4 w-4" aria-hidden />
              {hero.loginCta} to your dashboard
            </Button>
            <p className="text-xs leading-relaxed text-slate-500">{hero.loginNote}</p>
            <p className="mono-label text-slate-500">
              {TRIAL_DAYS}-day trial / no card required
            </p>
          </div>
        </div>
      ) : null}

      <main id="main">
        {/* 01 / hero */}
        <section className="frame pb-16 pt-6 sm:pt-10 lg:pb-24">
          <div className="grid items-start gap-12 lg:grid-cols-[1.02fr_0.98fr] lg:gap-14">
            <div>
              <p className="mono-label flex items-center gap-2 text-accent-400">
                <span className="live-dot" aria-hidden />
                {hero.stamp}
              </p>
              <h1 className="display mt-5 text-[clamp(2.2rem,4.4vw,3.6rem)] text-slate-50">
                {hero.title.replace(hero.titleAccent, '')}
                <span className="block text-accent-500">{hero.titleAccent}</span>
              </h1>
              <p className="mt-6 max-w-[46ch] text-[17px] leading-relaxed text-slate-400">
                {hero.lede}
              </p>
              <div className="mt-8 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
                <Button size="lg" loading={loading} onClick={signIn} className="w-full sm:w-auto">
                  <DiscordIcon className="h-4 w-4" />
                  {hero.primaryCta}
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  loading={loading}
                  onClick={signIn}
                  className="w-full sm:w-auto"
                >
                  <LogIn className="h-4 w-4" aria-hidden />
                  {hero.loginCta}
                </Button>
              </div>
              <p className="mt-3 max-w-[48ch] text-[13px] leading-relaxed text-slate-500">
                {hero.loginNote}
              </p>
              {error ? (
                <Alert tone="red" className="mt-6 max-w-xl" title="Sign-in failed">
                  {error}
                </Alert>
              ) : null}
              <p className="mt-4 text-[13px] leading-relaxed text-slate-500">{hero.effortNote}</p>
              <a
                href="#board"
                className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-slate-400 transition-colors hover:text-accent-300"
              >
                {hero.secondaryCta}
                <ArrowDown className="h-3.5 w-3.5" aria-hidden />
              </a>
              <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-slate-500">
                {hero.highlights.map((item) => (
                  <li key={item} className="inline-flex items-center gap-1.5">
                    <Check className="h-3.5 w-3.5 text-sage-400" aria-hidden />
                    {item}
                  </li>
                ))}
              </ul>
              <p className="mt-3 max-w-[52ch] text-xs leading-relaxed text-slate-600">
                {hero.scopeNote}
              </p>
            </div>
            <div className="lg:pt-1">
              {/* One motion-safe 3D tilt for the hero board, nothing more. */}
              <TiltSurface>
                <WarBoard />
              </TiltSurface>
            </div>
          </div>

          {/* The board as an object. Same sample data as the panel above, clearly labelled and
              turned with a drag or the arrow keys; fully static under reduced motion. */}
          <div className="mt-12 lg:mt-16">
            <WarTable3D
              className="war-table3d--wide"
              sample
              label="Sample war table"
              phase="attack"
              phaseLabel="Attack"
              active
              timeLeft="21:48:21"
              warLeft="21h 48m"
              progress={54.6}
              counts={sampleBoard.counts}
              race={{ lap: 4, node: 7, target: 20 }}
              maze={{ label: '30% off', detail: 'next ping 18:20' }}
              onSelect={() => {
                void signIn()
              }}
            />
            <p className="mono-label mt-3 flex flex-wrap items-baseline justify-between gap-2 text-slate-600">
              <span>Fig. 02 / sample war table. Turn it.</span>
              <span>Sample data. Illustrative only.</span>
            </p>
          </div>
        </section>

        {/* 02 / clock */}
        <section id="clock" className="border-t border-white/[0.1]">
          <div className="frame py-16 lg:py-24">
            <div className="section-head">
              <span className="mono-label text-accent-400">{clock.stamp}</span>
              <span className="mono-label hidden sm:block">48h / 24h / 24h / 0h</span>
            </div>
            <div className="grid gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
              <div>
                <h2 className="display text-[clamp(2rem,4vw,3.5rem)] text-slate-50">
                  {clock.title}
                </h2>
                <p className="mt-5 max-w-[58ch] text-[15px] leading-relaxed text-slate-400">
                  {clock.body}
                </p>
              </div>
              <div className="border border-white/[0.14] p-5">
                <div className="flex items-center justify-between">
                  <span className="mono-label text-steel-400">{clock.rail.defence}</span>
                  <span className="mono-label text-accent-400">{clock.rail.attack}</span>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-1" aria-hidden>
                  <div className="flex h-12 items-end border border-steel-500/30 bg-steel-500/[0.08] p-2">
                    <span className="mono-label text-steel-500">24h</span>
                  </div>
                  <div className="flex h-12 items-end border border-accent-500/40 bg-accent-500/[0.1] p-2">
                    <span className="mono-label text-accent-400">24h</span>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="mono-label text-slate-600">{clock.rail.start}</span>
                  <span className="mono-label text-slate-600">{clock.rail.mid}</span>
                  <span className="mono-label text-slate-600">{clock.rail.end}</span>
                </div>
                <dl className="mt-6 space-y-0">
                  {[
                    ['Phase switch', 'Automatic at 24h left'],
                    ['Channel ping', 'At the switch and the last hour'],
                    ['Missing list', 'Carried into attack, not reset'],
                  ].map(([term, detail]) => (
                    <div
                      key={term}
                      className="flex items-baseline justify-between gap-4 border-t border-white/[0.08] py-2.5"
                    >
                      <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-slate-500">
                        {term}
                      </dt>
                      <dd className="text-right text-xs text-slate-300">{detail}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>

            <dl className="mt-14 grid grid-cols-2 gap-px border-t border-white/[0.14] bg-white/[0.08] lg:grid-cols-4">
              {clock.facts.map((fact) => (
                <div key={fact.label} className="bg-ink-950 py-6 pr-4">
                  <dt className="sr-only">{fact.label}</dt>
                  <dd>
                    <span className="block font-display text-[clamp(2rem,3.4vw,3rem)] font-extrabold leading-none tracking-tight text-slate-100">
                      {fact.value}
                    </span>
                    <span className="mono-label mt-2 block text-slate-500">{fact.label}</span>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* 03 / board */}
        <section id="board" className="border-t border-white/[0.1]">
          <div className="frame py-16 lg:py-24">
            <div className="section-head">
              <span className="mono-label text-accent-400">{features.stamp}</span>
              <span className="mono-label hidden sm:block">Six tools, one board</span>
            </div>
            <div className="max-w-[62ch]">
              <h2 className="display text-[clamp(2rem,4vw,3.5rem)] text-slate-50">
                {features.title}
              </h2>
              <p className="mt-5 text-[15px] leading-relaxed text-slate-400">{features.lede}</p>
            </div>

            <ul className="mt-12 border-t border-white/[0.14]">
              {features.items.map((item) => (
                <li
                  key={item.id}
                  className="group -mx-2 border-b border-white/[0.08] px-2 transition-colors duration-200 hover:bg-white/[0.025]"
                >
                  <div className="grid gap-3 py-6 sm:grid-cols-[60px_1fr_auto] sm:items-baseline sm:gap-8">
                    <span className="font-mono text-[11px] tracking-[0.12em] text-slate-600 transition-colors group-hover:text-accent-400">
                      {item.id}
                    </span>
                    <div>
                      <h3 className="font-display text-xl font-bold tracking-tight text-slate-100 sm:text-2xl">
                        {item.name}
                      </h3>
                      <p className="mt-1.5 max-w-[56ch] text-sm leading-relaxed text-slate-500">
                        {item.description}
                      </p>
                    </div>
                    <span className="mono-label text-slate-600 sm:text-right">{item.tag}</span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 04 / start */}
        <section id="start" className="border-t border-white/[0.1]">
          <div className="frame py-16 lg:py-24">
            <div className="grid gap-12 lg:grid-cols-[0.75fr_1.25fr] lg:gap-16">
              <div className="lg:sticky lg:top-10 lg:self-start">
                <div className="section-head">
                  <span className="mono-label text-accent-400">{start.stamp}</span>
                </div>
                <h2 className="display text-[clamp(2rem,4vw,3.5rem)] text-slate-50">
                  {start.title}
                </h2>
                <p className="mt-5 max-w-[42ch] text-[15px] leading-relaxed text-slate-400">
                  The board comes up empty. The first war command fills it. If tracking starts
                  mid-war, name the time left in the phase and the bot back-dates the war clock.
                </p>
                <a
                  href={BOT_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={buttonClass('secondary', 'md', 'mt-7')}
                >
                  Add the bot
                  <ArrowUpRight className="h-4 w-4" />
                </a>
              </div>

              <ol className="border-t border-white/[0.14]">
                {start.steps.map((step) => (
                  <li
                    key={step.id}
                    className="grid grid-cols-[40px_1fr] gap-5 border-b border-white/[0.08] py-7 sm:gap-8"
                  >
                    <span className="font-display text-lg font-extrabold text-slate-600">
                      {step.id}
                    </span>
                    <div>
                      <h3 className="font-display text-xl font-bold tracking-tight text-slate-100">
                        {step.title}
                      </h3>
                      <p className="mt-2 max-w-[58ch] text-sm leading-relaxed text-slate-500">
                        {step.body}
                      </p>
                      {step.command ? (
                        <div className="mt-4 space-y-1.5">
                          <pre className="overflow-x-auto border border-white/[0.12] bg-ink-950 px-3 py-2 font-mono text-xs text-accent-300">
                            <code>{step.command}</code>
                          </pre>
                          <p className="mono-label text-slate-600">
                            Or mid-war: {step.altCommand}
                          </p>
                        </div>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </section>

        {/* 05 / questions */}
        <section id="questions" className="border-t border-white/[0.1]">
          <div className="frame py-16 lg:py-24">
            <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:gap-16">
              <div>
                <div className="section-head">
                  <span className="mono-label text-accent-400">{faq.stamp}</span>
                </div>
                <h2 className="display text-[clamp(2rem,3.6vw,3.1rem)] text-slate-50">
                  {faq.title}
                </h2>
              </div>
              <div className="border-t border-white/[0.14]">
                {faq.items.map((item) => (
                  <details key={item.q} className="group border-b border-white/[0.08] py-5">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-sm font-semibold text-slate-200">
                      {item.q}
                      <span
                        aria-hidden
                        className="font-mono text-lg font-normal leading-none text-accent-400 transition-transform duration-200 group-open:rotate-45"
                      >
                        +
                      </span>
                    </summary>
                    <p className="mt-3 max-w-[62ch] pr-8 text-sm leading-relaxed text-slate-500">
                      {item.a}
                    </p>
                  </details>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* finale */}
        <section className="border-t border-white/[0.1]">
          <div className="frame py-20 lg:py-28">
            <div className="grid items-end gap-10 lg:grid-cols-[1.2fr_0.8fr]">
              <div>
                <h2 className="display display-wide text-[clamp(2.6rem,7.4vw,6rem)] text-slate-50">
                  {finale.title}
                </h2>
                <p className="mt-5 max-w-[46ch] text-[15px] leading-relaxed text-slate-400">
                  {finale.body}
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 lg:items-end">
                <Button size="lg" loading={loading} onClick={signIn}>
                  <DiscordIcon className="h-4 w-4" />
                  {finale.cta}
                </Button>
                <Button size="lg" variant="secondary" loading={loading} onClick={signIn}>
                  <LogIn className="h-4 w-4" aria-hidden />
                  {finale.secondaryCta}
                </Button>
                <span className="mono-label text-slate-500">
                  {TRIAL_DAYS}-day trial / no card required
                </span>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/[0.14]">
        <div className="frame py-12">
          <div className="grid gap-10 lg:grid-cols-[1.3fr_0.7fr]">
            <div>
              <p className="display text-[clamp(2.2rem,5.4vw,4.4rem)] text-slate-200">
                Legends
                <br />
                Assistant
              </p>
              <p className="mt-4 max-w-[44ch] text-sm leading-relaxed text-slate-500">
                The alliance board for Monster Legends staff. Built to replace the pinned
                spreadsheet, not the conversation.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-x-8 gap-y-6 text-sm">
              <div>
                <p className="mono-label mb-3 text-slate-600">Board</p>
                <ul className="space-y-2">
                  <li>
                    <button
                      type="button"
                      onClick={signIn}
                      className="py-1.5 text-left text-slate-300 hover:text-accent-400"
                    >
                      Sign in with Discord
                    </button>
                  </li>
                  <li>
                    <a
                      href={BOT_INVITE_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block py-2.5 text-slate-300 hover:text-accent-400"
                    >
                      Add the bot
                    </a>
                  </li>
                  <li>
                    <a
                      href="#clock"
                      className="inline-block py-2.5 text-slate-300 hover:text-accent-400"
                    >
                      War clock
                    </a>
                  </li>
                </ul>
              </div>
              <div>
                <p className="mono-label mb-3 text-slate-600">Support</p>
                <ul className="space-y-2">
                  <li>
                    <a
                      href={`mailto:${SUPPORT_EMAIL}`}
                      className="inline-block py-2.5 text-slate-300 hover:text-accent-400"
                    >
                      {SUPPORT_EMAIL}
                    </a>
                  </li>
                  {footer.links.map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        className="inline-block py-2.5 text-slate-300 hover:text-accent-400"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="mt-12 flex flex-col justify-between gap-3 border-t border-white/[0.08] pt-4 sm:flex-row">
            <p className="mono-label text-slate-600">
              {footer.disclaimer} © {new Date().getFullYear()}
            </p>
            <p className="mono-label text-slate-600">{footer.colophon}</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
