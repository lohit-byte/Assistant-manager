import Link from 'next/link'
import type { Metadata } from 'next'
import { ArrowLeft } from 'lucide-react'
import { SUPPORT_EMAIL } from '@/lib/constants'

export const metadata: Metadata = {
  title: 'Legal and policies',
  description:
    'Terms, refund and cancellation rules, and the privacy policy for Legends Assistant.',
}

const sections = [
  {
    id: 'terms',
    tag: '01 / Terms',
    title: 'Terms of Service',
    body: [
      'By inviting the "Assistant Manager for Monster Legends" bot to your Discord server or using this dashboard, you agree to these terms.',
      '1. Non-affiliation: this is a third-party community tool. We are not affiliated, associated, authorized, endorsed by, or in any way officially connected with Socialpoint or Monster Legends.',
      '2. Acceptable use: you may not use this bot to spam, abuse Discord APIs, or attempt to exploit the dashboard. We reserve the right to blacklist any user or server that violates these terms without prior notice.',
      '3. Service availability: while we aim for high uptime, the bot and dashboard are provided "as is". We are not liable for missed war timers, race deadlines, or game consequences resulting from downtime.',
    ],
  },
  {
    id: 'refund',
    tag: '02 / Refunds',
    title: 'Refund and Cancellation Policy',
    body: [
      'All sales are final and non-refundable.',
      'We offer a 7-day free trial so you can test every premium feature before paying. By subscribing to a premium plan, you acknowledge that you have tested the service and agree to this no-refund policy.',
      '1. No refunds: we do not provide refunds or credits for partial subscription periods, unused time, accidental purchases, or if you forget to cancel.',
      '2. Cancellations: you may cancel at any time. If you cancel, you keep premium features until the end of the current billing cycle and will not be charged again.',
      '3. Disputes: if you open a chargeback or payment dispute, the server is permanently blacklisted from using the bot.',
    ],
  },
  {
    id: 'privacy',
    tag: '03 / Privacy',
    title: 'Privacy Policy',
    body: [
      '1. Data we collect: we store your Discord server ID, Discord user IDs for attack and alias tracking, and the data you enter (war timers, race nodes, maze schedules).',
      '2. Payments: all payment processing is handled by Cashfree. We do not store card, bank or UPI details on our servers.',
      '3. Data sharing: we do not sell your data. It is stored in our Supabase database.',
    ],
  },
]

export default function LegalPage() {
  return (
    <main id="main" className="min-h-screen bg-ink-950 text-slate-200">
      <div className="frame max-w-3xl py-12 lg:py-16">
        <Link
          href="/"
          className="inline-flex items-center gap-2 py-2.5 text-sm text-slate-400 underline-offset-4 transition-colors hover:text-accent-400 hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to the board
        </Link>

        <header className="mt-10 border-b border-white/[0.14] pb-8">
          <p className="mono-label text-accent-400">Legal / November 2026</p>
          <h1 className="display mt-3 text-[clamp(2.4rem,6vw,4rem)] text-slate-50">
            Legal and policies
          </h1>
          <p className="mt-4 max-w-[56ch] text-sm leading-relaxed text-slate-400">
            Questions about these policies can go to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="inline-block py-1.5 text-accent-400 underline decoration-accent-500/50 underline-offset-4 hover:text-accent-300">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        </header>

        <div className="mt-10 space-y-10">
          {sections.map((section) => (
            <section key={section.id} id={section.id} className="scroll-mt-10">
              <div className="flex items-baseline justify-between gap-4 border-t border-white/[0.14] pt-4">
                <h2 className="display text-2xl text-slate-50 sm:text-3xl">{section.title}</h2>
                <span className="mono-label text-slate-600">{section.tag}</span>
              </div>
              <div className="mt-4 space-y-3 text-sm leading-relaxed text-slate-400">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  )
}
