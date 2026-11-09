import type { Metadata, Viewport } from 'next'
import { archivo, mono } from './fonts'
import { site } from '@/lib/marketing'
import './globals.css'

export const metadata: Metadata = {
  metadataBase: new URL(site.url),
  title: {
    default: 'Legends Assistant | War, race and maze tracking for Monster Legends alliances',
    template: '%s | Legends Assistant',
  },
  description: site.description,
  alternates: { canonical: './' },
  openGraph: {
    type: 'website',
    siteName: site.name,
    title: 'Legends Assistant | Wars, races and mazes without spreadsheets',
    description: site.description,
    url: '/',
    images: [{ url: '/og.png', width: 1200, height: 630, alt: 'Legends Assistant alliance board' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Legends Assistant | Wars, races and mazes without spreadsheets',
    description: site.description,
    images: ['/og.png'],
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  themeColor: '#0c0d0a',
  width: 'device-width',
  initialScale: 1,
  colorScheme: 'dark',
}

const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebApplication',
  name: site.name,
  url: site.url,
  applicationCategory: 'GameApplication',
  operatingSystem: 'Web',
  description: site.description,
  offers: {
    '@type': 'Offer',
    price: '0',
    priceCurrency: 'USD',
    description: '7-day free trial, no card required.',
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${archivo.variable} ${mono.variable} dark`}>
      <body className="min-h-screen bg-ink-950 font-sans text-slate-200 antialiased">
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
        />
      </body>
    </html>
  )
}
